/**
 * Console-friendly sanity checks for the physics core.
 *
 * Pure functions, no DOM, no globals — call `runSelfTest()` from the browser
 * console (or from node) and read the table. These are the numbers that make the
 * model credible: if the ZH-L16C coefficients or the Haldane inversion were
 * wrong, the NDL rows below would be visibly off the published tables.
 */
import { CONFIG } from '../config';
import type { TissueState } from '../types';
import { ambientPressure, depthForPressure, pressureMultiplier, relativeVolume } from './pressure';
import { consumptionLpm, minutesOfGasLeft, minutesToReserve } from './gas';
import {
  TABLE_GF,
  ceilingDepth,
  initialTissues,
  loadFraction,
  ndlMinutes,
  updateTissues,
} from './buhlmann';

export interface Check {
  name: string;
  got: number;
  want: string;
  ok: boolean;
}

const near = (got: number, want: number, tol: number) => Math.abs(got - want) <= tol;

/** Run a fresh diver at a constant depth for `minutes` of dive time. */
function soak(ts: TissueState, depth: number, minutes: number, stepSec = 1): TissueState {
  const steps = Math.round((minutes * 60) / stepSec);
  for (let i = 0; i < steps; i++) updateTissues(ts, depth, stepSec);
  return ts;
}

export function runSelfTest(): Check[] {
  const c: Check[] = [];
  const push = (name: string, got: number, want: string, ok: boolean) =>
    c.push({ name, got: Number.isFinite(got) ? Math.round(got * 1000) / 1000 : got, want, ok });

  // ---------------------------------------------------------- pressure
  push('ambientPressure(0)', ambientPressure(0), '1', near(ambientPressure(0), 1, 1e-9));
  push('ambientPressure(10)', ambientPressure(10), '2', near(ambientPressure(10), 2, 1e-9));
  push('ambientPressure(40)', ambientPressure(40), '5', near(ambientPressure(40), 5, 1e-9));
  push('depthForPressure(5)', depthForPressure(5), '40', near(depthForPressure(5), 40, 1e-9));
  push('depthForPressure(0.5)', depthForPressure(0.5), '0 (clamped)', depthForPressure(0.5) === 0);
  push('pressureMultiplier(30)', pressureMultiplier(30), '4', near(pressureMultiplier(30), 4, 1e-9));
  push('relativeVolume(10)', relativeVolume(10), '0.5 (Boyle)', near(relativeVolume(10), 0.5, 1e-9));
  push('relativeVolume(30)', relativeVolume(30), '0.25 (Boyle)', near(relativeVolume(30), 0.25, 1e-9));

  // ---------------------------------------------------------- gas
  const surfLpm = consumptionLpm(0);
  const deepLpm = consumptionLpm(30);
  push('consumptionLpm(0)', surfLpm, `${CONFIG.sacLpm} L/min`, near(surfLpm, CONFIG.sacLpm, 1e-9));
  push('consumptionLpm(30) / (0)', deepLpm / surfLpm, '4x at 30 m', near(deepLpm / surfLpm, 4, 1e-9));
  const full = CONFIG.tank.startBar;
  push('minutesOfGasLeft(200 bar, 0 m)', minutesOfGasLeft(full, 0), '~139 min', near(minutesOfGasLeft(full, 0), 138.75, 1));
  push('minutesOfGasLeft(200 bar, 30 m)', minutesOfGasLeft(full, 30), '1/4 of surface', near(minutesOfGasLeft(full, 30) * 4, minutesOfGasLeft(full, 0), 1e-6));
  push('minutesToReserve(200 bar, 30 m)', minutesToReserve(full, 30), '< gas-to-zero', minutesToReserve(full, 30) < minutesOfGasLeft(full, 30));
  push('minutesToReserve(30 bar, 30 m)', minutesToReserve(30, 30), '0 (below reserve)', minutesToReserve(30, 30) === 0);

  // ---------------------------------------------------------- NDL, pure ZH-L16C
  // Asserted at TABLE_GF (= 1.0, raw M-values). These are the published
  // Buhlmann / PADI-ballpark no-stop limits and are the real check on the
  // coefficients and on the Haldane inversion.
  const fresh = () => initialTissues();
  const ndl12 = ndlMinutes(fresh(), 12, TABLE_GF);
  const ndl18 = ndlMinutes(fresh(), 18, TABLE_GF);
  const ndl30 = ndlMinutes(fresh(), 30, TABLE_GF);
  const ndl40 = ndlMinutes(fresh(), 40, TABLE_GF);
  push('NDL @ 12 m (GF 100)', ndl12, '> 100 min or Infinity', ndl12 > 100);
  push('NDL @ 18 m (GF 100)', ndl18, '50-70 min', ndl18 >= 50 && ndl18 <= 70);
  push('NDL @ 30 m (GF 100)', ndl30, '15-25 min', ndl30 >= 15 && ndl30 <= 25);
  push('NDL @ 40 m (GF 100)', ndl40, '6-12 min', ndl40 >= 6 && ndl40 <= 12);
  push('NDL monotonic in depth', ndl40, '12 > 18 > 30 > 40', ndl12 > ndl18 && ndl18 > ndl30 && ndl30 > ndl40);

  // Informational: the same limits with the game's configured conservatism.
  // A GF-high dive computer is legitimately tighter than the tables; these rows
  // are reported, not asserted, so the lead can see what CONFIG.gfHigh costs.
  const gfLabel = `info @ GF ${Math.round(CONFIG.gfHigh * 100)}`;
  push('NDL @ 12 m (config GF)', ndlMinutes(fresh(), 12), gfLabel, true);
  push('NDL @ 18 m (config GF)', ndlMinutes(fresh(), 18), gfLabel, true);
  push('NDL @ 30 m (config GF)', ndlMinutes(fresh(), 30), gfLabel, true);
  push('NDL @ 40 m (config GF)', ndlMinutes(fresh(), 40), gfLabel, true);

  // Shallow enough and no compartment can ever bust: NDL is genuinely infinite.
  const ndl6 = ndlMinutes(fresh(), 6, TABLE_GF);
  push('NDL @ 6 m (GF 100)', ndl6, 'Infinity', ndl6 === Infinity);

  // ---------------------------------------------------------- deco obligation
  // 25 dive-minutes at 30 m is well past any 30 m no-stop limit, so the diver
  // owes a stop: ceiling off the bottom, loading bar past full.
  const deco = soak(initialTissues(), 30, 25);
  const decoCeil = ceilingDepth(deco);
  const decoLoad = loadFraction(deco);
  push('ceiling after 25 min @ 30 m', decoCeil, '> 0 m', decoCeil > 0);
  push('ceiling is on the 3 m grid', decoCeil, 'multiple of 3', decoCeil % 3 === 0);
  push('loadFraction after 25 min @ 30 m', decoLoad, '> 1', decoLoad > 1);
  push('NDL after 25 min @ 30 m', ndlMinutes(deco, 30), '0', ndlMinutes(deco, 30) === 0);

  // ---------------------------------------------------------- off-gassing
  // Three hours breathing air on the boat clears the obligation entirely.
  const rested = soak(deco, 0, 180, 10);
  const restCeil = ceilingDepth(rested);
  const restLoad = loadFraction(rested);
  push('ceiling after 3 h at surface', restCeil, '0 m', restCeil === 0);
  push('loadFraction after 3 h at surface', restLoad, '< 0.4', restLoad < 0.4);
  push('NDL recovered @ 18 m (GF 100)', ndlMinutes(rested, 18, TABLE_GF), '> 0, < fresh NDL', ndlMinutes(rested, 18, TABLE_GF) > 0 && ndlMinutes(rested, 18, TABLE_GF) < ndl18);

  // A fresh diver on the surface owes nothing and reads empty.
  const f = initialTissues();
  push('fresh loadFraction', loadFraction(f), '0', near(loadFraction(f), 0, 1e-9));
  push('fresh ceiling', ceilingDepth(f), '0', ceilingDepth(f) === 0);

  if (typeof console !== 'undefined' && typeof console.table === 'function') {
    console.table(c);
    const failed = c.filter((x) => !x.ok);
    console.log(failed.length ? `selftest: ${failed.length} FAILED` : `selftest: all ${c.length} ok`);
  }
  return c;
}
