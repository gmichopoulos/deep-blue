/**
 * Unit system for everything the player reads.
 *
 * The physics is metric throughout — msw and bar are the units decompression
 * theory is written in, and `sim/` never sees this module. This is a presentation
 * layer only: it converts at the last moment, so there is exactly one place where
 * a unit bug can live.
 */
import { CONFIG } from '../config';

const KEY = 'deepblue.units.v1';

export type UnitSystem = 'metric' | 'imperial';

const FT_PER_M = 3.28084;
const PSI_PER_BAR = 14.5038;

/**
 * Imperial is the working system for recreational diving in the US and a handful
 * of places that trained on US agencies; everywhere else teaches metric.
 */
export function suggestedUnits(): UnitSystem {
  // `navigator` is not a given: it is absent under Node 20 and earlier, which is
  // where the test suite runs. Node 21+ happens to define it, so an unguarded
  // read passes locally and fails in CI.
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const langs = [
    ...(nav?.languages ?? []),
    nav?.language ?? '',
  ].map((l) => l.toLowerCase());
  const imperialRegions = ['-us', '-pr', '-gu', '-vi', '-as', '-mp'];
  return langs.some((l) => imperialRegions.some((r) => l.endsWith(r))) ? 'imperial' : 'metric';
}

let current: UnitSystem | null = null;

export function getUnits(): UnitSystem {
  if (current) return current;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'metric' || saved === 'imperial') return (current = saved);
  } catch {
    /* private mode */
  }
  return (current = suggestedUnits());
}

export function setUnits(u: UnitSystem): void {
  current = u;
  try {
    localStorage.setItem(KEY, u);
  } catch {
    /* private mode — the choice just will not persist */
  }
}

export function toggleUnits(): UnitSystem {
  const next: UnitSystem = getUnits() === 'metric' ? 'imperial' : 'metric';
  setUnits(next);
  return next;
}

// ---------------------------------------------------------------- depth

export function depthValue(m: number): number {
  return getUnits() === 'metric' ? m : m * FT_PER_M;
}

export function depthUnit(): string {
  return getUnits() === 'metric' ? 'm' : 'ft';
}

/**
 * Depths that teaching copy quotes as round metric numbers, mapped to the round
 * imperial numbers divers actually use. Converting 40 m gives 131 ft, but every
 * US table, course and dive computer says 130 ft — and 5 m is universally "15 ft"
 * even though it converts to 16.4. The differences are all well inside the
 * tolerances the game already allows, and using them keeps the copy idiomatic.
 *
 * Only exact matches are substituted, so live gauge readings are never affected.
 */
const CANONICAL_FT: Record<number, number> = {
  5: 15,
  10: 33,
  12: 40,
  18: 60,
  20: 66,
  25: 80,
  28: 90,
  30: 100,
  40: 130,
};

/** Depth with its unit, e.g. "18.2 m" or "60 ft". Feet are never shown fractional. */
export function depth(m: number, decimals?: number): string {
  const metric = getUnits() === 'metric';
  const d = decimals ?? (metric ? 1 : 0);
  return `${depthValue(m).toFixed(d)} ${depthUnit()}`;
}

/**
 * Depth for *teaching copy* — the wizard, the tooltips, the fixed ruler ticks —
 * where a round metric number should read as the round imperial number divers
 * actually use.
 *
 * Deliberately NOT the default: `ceilingDepth()` snaps to the 3 m stop grid, so a
 * live ceiling lands on 12/18/30 exactly and would be silently rewritten to
 * 40/60/100 ft, bending a uniform ladder by a few feet at three rungs. Anything
 * derived from live state must use `depth()`.
 */
export function teach(m: number, decimals?: number): string {
  if (getUnits() !== 'metric' && CANONICAL_FT[m] !== undefined) return `${CANONICAL_FT[m]} ft`;
  return depth(m, decimals);
}

/** Depth with no unit suffix, for gauges that label their own unit. */
export function depthNum(m: number, decimals?: number): string {
  const metric = getUnits() === 'metric';
  return depthValue(m).toFixed(decimals ?? (metric ? 1 : 0));
}

// ---------------------------------------------------------------- pressure

export function pressureValue(bar: number): number {
  return getUnits() === 'metric' ? bar : bar * PSI_PER_BAR;
}

export function pressureUnit(): string {
  return getUnits() === 'metric' ? 'bar' : 'psi';
}

/**
 * Tank pressure. psi is rounded to the nearest 50: a submersible pressure gauge
 * is a needle on a dial, and no diver reads or quotes it finer than that. Keeps a
 * full aluminium 80 at the familiar 2900 psi rather than 2901.
 */
export function tankPressureNum(bar: number): string {
  return getUnits() === 'metric'
    ? Math.round(bar).toString()
    : (Math.round(pressureValue(bar) / 50) * 50).toString();
}

export function tankPressure(bar: number): string {
  return `${tankPressureNum(bar)} ${pressureUnit()}`;
}

/**
 * Ambient pressure. Imperial divers still think in atmospheres for this — psi
 * absolute is not a number anyone uses underwater — so this stays as "ata",
 * which is numerically the same as bar for our purposes.
 */
export function ambientPressureLabel(bar: number): string {
  return getUnits() === 'metric' ? `${bar.toFixed(1)} bar` : `${bar.toFixed(1)} ata`;
}

// ---------------------------------------------------------------- rate

export function rateValue(mpm: number): number {
  return getUnits() === 'metric' ? mpm : mpm * FT_PER_M;
}

export function rateUnit(): string {
  return getUnits() === 'metric' ? 'm/min' : 'ft/min';
}

export function rate(mpm: number, decimals?: number): string {
  const metric = getUnits() === 'metric';
  return `${rateValue(mpm).toFixed(decimals ?? (metric ? 1 : 0))} ${rateUnit()}`;
}

// ---------------------------------------------------------------- rules

/**
 * The gas reserve the player's own training tradition would teach, in bar.
 *
 * This is the one place a unit choice changes the game rather than the wording:
 * 50 bar and 500 psi are different amounts of gas (~16 bar apart), so an imperial
 * diver may legitimately breathe a little deeper into the tank before the gauge
 * warns them. That asymmetry is real in the sport, and showing a metric diver a
 * "500 psi" rule they were never taught would be the bigger distortion.
 */
export function reserveBar(): number {
  return getUnits() === 'metric' ? CONFIG.tank.reserveBar : CONFIG.tank.reserveBarImperial;
}

/** The reserve, formatted — "50 bar" or "500 psi". */
export function reserveLabel(): string {
  return tankPressure(reserveBar());
}
