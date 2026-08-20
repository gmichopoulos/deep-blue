/**
 * Buhlmann ZH-L16C — nitrogen only.
 *
 * The model in three sentences:
 *  1. Your body is modelled as 16 independent "tissue compartments", each a
 *     well-stirred bucket that fills and empties exponentially with its own
 *     half-time (4 min for blood-rich tissue, 635 min for fat/bone).
 *  2. Each compartment loads toward the nitrogen pressure you are breathing,
 *     P_insp = (P_amb - P_H2O) x fN2, by the Haldane equation
 *     P += (P_insp - P) x (1 - 2^(-dt/T_half)).
 *  3. Each compartment tolerates a certain amount of supersaturation before it
 *     bubbles. Buhlmann expresses that as a straight line in ambient pressure:
 *     the lowest ambient pressure compartment i can be taken to is
 *     P_tol = (P_i - a_i) x b_i. Convert that to a depth and you have a ceiling.
 *
 * Everything the game shows the player — the loading bar, the NDL countdown, the
 * deco ceiling — falls out of those three equations.
 */
import { CONFIG } from '../config';
import type { Depth, Bar, TissueState } from '../types';
import { ambientPressure, depthForPressure } from './pressure';

// ---------------------------------------------------------------- the table

/**
 * ZH-L16C nitrogen compartments: half-time (minutes) and the a/b M-value
 * coefficients.
 *
 * Source: A. A. Buhlmann, "Tauchmedizin" (5th ed.), the ZH-L16C N2 set — the
 * same numbers used by Subsurface's deco.c and by every ZH-L16C dive computer.
 * The `b` values are shared by ZH-L16A/B/C; the `a` values below are the "C"
 * variant, which lowers `a` (i.e. is more conservative) for the medium and slow
 * compartments 5-15 relative to ZH-L16B.
 *
 * Note the first compartment is the 4.0 min one (some tables substitute a
 * 5.0 min "1b" compartment; we use the classic 4.0 min set).
 */
export const ZHL16C: ReadonlyArray<{ t: number; a: number; b: number }> = [
  { t: 4.0, a: 1.2599, b: 0.505 },
  { t: 8.0, a: 1.0, b: 0.6514 },
  { t: 12.5, a: 0.8618, b: 0.7222 },
  { t: 18.5, a: 0.7562, b: 0.7825 },
  { t: 27.0, a: 0.62, b: 0.8126 },
  { t: 38.3, a: 0.5043, b: 0.8434 },
  { t: 54.3, a: 0.441, b: 0.8693 },
  { t: 77.0, a: 0.4, b: 0.891 },
  { t: 109.0, a: 0.375, b: 0.9092 },
  { t: 146.0, a: 0.35, b: 0.9222 },
  { t: 187.0, a: 0.3295, b: 0.9319 },
  { t: 239.0, a: 0.3065, b: 0.9403 },
  { t: 305.0, a: 0.2835, b: 0.9477 },
  { t: 390.0, a: 0.261, b: 0.9544 },
  { t: 498.0, a: 0.248, b: 0.9602 },
  { t: 635.0, a: 0.2327, b: 0.9653 },
] as const;

/** Real deco stops live on a 3 m grid, so the displayed ceiling does too. */
const STOP_GRID_M = 3;

/**
 * Pure ZH-L16C, no added conservatism. Reproduces the published no-stop limits
 * (~9 min at 40 m, ~59 at 18 m), which is what the self-test checks the
 * coefficients against. The game itself runs at CONFIG.gfHigh.
 */
export const TABLE_GF = 1.0;

// ---------------------------------------------------------------- tissues

/** Inspired N2 partial pressure at a depth. The lungs are always saturated with
 *  water vapour, so that partial pressure is subtracted before taking the N2
 *  fraction — this is why you keep loading a little even at the surface. */
export function inspiredN2(depth: Depth): Bar {
  return (ambientPressure(depth) - CONFIG.waterVaporBar) * CONFIG.fN2;
}

/** N2 pressure of a diver who has been out of the water long enough to be in
 *  equilibrium with the air they are breathing. ~0.7405 bar. */
export function surfaceEquilibriumN2(): Bar {
  return inspiredN2(0);
}

/** A fresh, fully off-gassed diver: every compartment equilibrated at surface. */
export function initialTissues(): TissueState {
  const p0 = surfaceEquilibriumN2();
  return { pN2: ZHL16C.map(() => p0) };
}

/**
 * Haldane exponential loading / off-gassing, in place.
 *
 *   P_new = P + (P_insp - P) x (1 - 2^(-dt / T_half))
 *
 * The same equation runs both directions: if P_insp < P the compartment
 * off-gasses. `dtDiveSec` is in dive-seconds (game clock) and is converted to
 * the minutes the half-times are expressed in.
 */
export function updateTissues(ts: TissueState, depth: Depth, dtDiveSec: number): void {
  if (dtDiveSec <= 0) return;
  const pInsp = inspiredN2(depth);
  const dtMin = dtDiveSec / 60;
  for (let i = 0; i < ZHL16C.length; i++) {
    const k = 1 - Math.pow(2, -dtMin / ZHL16C[i].t);
    ts.pN2[i] += (pInsp - ts.pN2[i]) * k;
  }
}

// ---------------------------------------------------------------- M-values

/**
 * Lowest ambient pressure compartment `i` may be exposed to, given its current
 * loading, with gradient factor `gf` applied.
 *
 * gf = 1 is the raw Buhlmann M-value line, P_tol = (P - a) x b: the diver may be
 * taken right up to the point where the model says bubbles form. gf < 1
 * interpolates back toward P_tol = P (no supersaturation allowed at all), so a
 * smaller gf means a deeper, more conservative ceiling:
 *
 *   P_amb_tol = P - (P - P_tol) x gf
 */
function toleratedAmbient(i: number, p: Bar, gf: number): Bar {
  const { a, b } = ZHL16C[i];
  const pTol = (p - a) * b;
  return p - (p - pTol) * gf;
}

/**
 * The most nitrogen compartment `i` may hold and still be allowed to surface —
 * i.e. the loading at which `toleratedAmbient` equals surface pressure.
 * Solving P - (P - (P - a)b) x gf = P_surface for P:
 *
 *   Pmax = (P_surface + gf x a x b) / (1 - gf x (1 - b))
 *
 * At gf = 1 this collapses to the familiar table form Pmax = a + P_surface / b.
 * Using the same gf here as in ceilingDepth() is what makes NDL reach 0 at
 * exactly the moment the ceiling lifts off the surface.
 */
export function surfacingLimit(i: number, gf: number = CONFIG.gfHigh): Bar {
  const { a, b } = ZHL16C[i];
  return (CONFIG.surfacePressureBar + gf * a * b) / (1 - gf * (1 - b));
}

// ---------------------------------------------------------------- ceiling

/** Unrounded ceiling in metres — the renderer draws a smooth line with this. */
export function rawCeiling(ts: TissueState, gf: number = CONFIG.gfHigh): Depth {
  let worst = 0;
  for (let i = 0; i < ZHL16C.length; i++) {
    const d = depthForPressure(toleratedAmbient(i, ts.pN2[i], gf));
    if (d > worst) worst = d;
  }
  return worst;
}

/**
 * The shallowest depth the diver may legally ascend to, rounded UP to the 3 m
 * stop grid (a 1.2 m ceiling means a 3 m stop). Exactly 0 means clear to the
 * surface.
 */
export function ceilingDepth(ts: TissueState, gf: number = CONFIG.gfHigh): Depth {
  const raw = rawCeiling(ts, gf);
  if (raw <= 0) return 0;
  return Math.ceil(raw / STOP_GRID_M) * STOP_GRID_M;
}

/** Index into ZHL16C of the compartment currently setting the ceiling — the one
 *  the debrief blames ("your 12.5-minute tissue is what is holding you down"). */
export function leadingCompartment(ts: TissueState, gf: number = CONFIG.gfHigh): number {
  let best = 0;
  let bestP = -Infinity;
  for (let i = 0; i < ZHL16C.length; i++) {
    const p = toleratedAmbient(i, ts.pN2[i], gf);
    if (p > bestP) {
      bestP = p;
      best = i;
    }
  }
  return best;
}

// ---------------------------------------------------------------- NDL

/**
 * No-decompression limit at `depth`: how many more dive-minutes the diver may
 * stay here before some compartment passes its surfacing limit.
 *
 * Invert Haldane. Starting at P_now and loading toward P_insp, the time to reach
 * Pmax is
 *
 *   t = -T_half x log2( (P_insp - Pmax) / (P_insp - P_now) )
 *
 * If P_insp <= Pmax the compartment can never bust at this depth (the ratio is
 * <= 0 and there is no solution) — that compartment contributes Infinity. The
 * NDL is the minimum over all 16, and Infinity only if every one is unlimited,
 * which is what "you could stay here forever" means at shallow depth.
 */
export function ndlMinutes(ts: TissueState, depth: Depth, gf: number = CONFIG.gfHigh): number {
  const pInsp = inspiredN2(depth);
  let ndl = Infinity;
  for (let i = 0; i < ZHL16C.length; i++) {
    const pMax = surfacingLimit(i, gf);
    const pNow = ts.pN2[i];
    if (pNow >= pMax) return 0; // already past it: deco obligation exists now
    if (pInsp <= pMax) continue; // unreachable at this depth
    const t = -ZHL16C[i].t * Math.log2((pInsp - pMax) / (pInsp - pNow));
    if (t < ndl) ndl = t;
  }
  return ndl > 0 ? ndl : 0;
}

// ---------------------------------------------------------------- loading bar

/**
 * 0..1+ tissue saturation for the HUD bar. >= 1 means a deco obligation, which
 * by construction is the same instant that ceilingDepth() leaves 0.
 *
 * Normalisation: the naive `P_now / Pmax` never reads 0, because a diver who has
 * been breathing air on the beach all week still sits at ~0.74 bar of N2, which
 * is 45-60% of Pmax depending on the compartment. That would show a scary
 * half-full bar before the diver got wet. So we rescale each compartment onto
 * the span it can actually move through:
 *
 *   fraction_i = (P_i - P_surface_equilibrium) / (Pmax_i - P_surface_equilibrium)
 *
 * which is 0 for a fully off-gassed diver and exactly 1 at the surfacing limit.
 * The bar shows the max over compartments — the one closest to its own limit.
 */
export function loadFraction(ts: TissueState, gf: number = CONFIG.gfHigh): number {
  const p0 = surfaceEquilibriumN2();
  let worst = 0;
  for (let i = 0; i < ZHL16C.length; i++) {
    const span = surfacingLimit(i, gf) - p0;
    if (span <= 0) continue;
    const f = (ts.pN2[i] - p0) / span;
    if (f > worst) worst = f;
  }
  return worst;
}
