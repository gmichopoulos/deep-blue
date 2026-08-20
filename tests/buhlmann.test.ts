/**
 * sim/buhlmann.ts — the decompression model.
 *
 * Two kinds of assertion live here and they are labelled individually:
 *   LAW      — must hold for any correct ZH-L16C implementation.
 *   SNAPSHOT — a number that came out of *these* coefficients / config, kept as
 *              a regression guard rather than a statement about the universe.
 */
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import type { TissueState } from '../src/types';
import {
  TABLE_GF,
  ZHL16C,
  ceilingDepth,
  initialTissues,
  inspiredN2,
  leadingCompartment,
  loadFraction,
  ndlMinutes,
  rawCeiling,
  surfaceEquilibriumN2,
  surfacingLimit,
  updateTissues,
} from '../src/sim/buhlmann';

/** Hold a diver at a constant depth for `minutes` of dive time. */
function soak(ts: TissueState, depth: number, minutes: number, stepSec = 1): TissueState {
  const steps = Math.round((minutes * 60) / stepSec);
  for (let i = 0; i < steps; i++) updateTissues(ts, depth, stepSec);
  return ts;
}

// ---------------------------------------------------------------- the table

describe('ZH-L16C coefficient table', () => {
  it('has 16 nitrogen compartments', () => {
    expect(ZHL16C).toHaveLength(16);
  });

  it('half-times increase strictly, from the 4 min blood-rich tissue to 635 min', () => {
    // LAW: the compartments are ordered fast -> slow, and the engine's
    // "leading compartment" debrief text depends on that ordering.
    for (let i = 1; i < ZHL16C.length; i++) {
      expect(ZHL16C[i].t).toBeGreaterThan(ZHL16C[i - 1].t);
    }
    expect(ZHL16C[0].t).toBe(4);
    expect(ZHL16C[15].t).toBe(635);
  });

  it('a decreases and b increases monotonically', () => {
    // LAW of the Buhlmann M-value line: slower tissues tolerate less
    // supersaturation (smaller a) but scale it more gently (larger b).
    for (let i = 1; i < ZHL16C.length; i++) {
      expect(ZHL16C[i].a).toBeLessThan(ZHL16C[i - 1].a);
      expect(ZHL16C[i].b).toBeGreaterThan(ZHL16C[i - 1].b);
    }
  });

  it('keeps every b in (0, 1) and every a positive', () => {
    // LAW: b outside (0,1) makes the M-value line nonsensical and would make
    // surfacingLimit() divide by a non-positive number.
    for (const c of ZHL16C) {
      expect(c.a).toBeGreaterThan(0);
      expect(c.b).toBeGreaterThan(0);
      expect(c.b).toBeLessThan(1);
    }
  });

  it('fast compartments have a shallower surfacing limit headroom than slow ones', () => {
    // LAW: the fast tissue can hold far more N2 before it must stop, which is
    // exactly why short deep dives are survivable at all.
    for (let i = 1; i < ZHL16C.length; i++) {
      expect(surfacingLimit(i, TABLE_GF)).toBeLessThan(surfacingLimit(i - 1, TABLE_GF));
    }
  });
});

// ---------------------------------------------------------------- fresh diver

describe('initialTissues', () => {
  it('sits at surface equilibrium in every compartment', () => {
    // LAW: (P_amb - P_H2O) x fN2 at the surface. SNAPSHOT of the constants:
    // (1 - 0.0627) x 0.79 = 0.74047 bar.
    const ts = initialTissues();
    expect(ts.pN2).toHaveLength(16);
    for (const p of ts.pN2) expect(p).toBeCloseTo(surfaceEquilibriumN2(), 12);
    expect(surfaceEquilibriumN2()).toBeCloseTo(0.740467, 6);
  });

  it('reads exactly zero on the loading bar and owes no ceiling', () => {
    // The HUD would otherwise show a scary half-full bar before the diver got wet.
    const ts = initialTissues();
    expect(loadFraction(ts)).toBeCloseTo(0, 12);
    expect(ceilingDepth(ts)).toBe(0);
    expect(rawCeiling(ts)).toBe(0);
  });

  it('has unlimited no-stop time at shallow depth', () => {
    // LAW: at 6 m the inspired N2 never reaches any compartment's surfacing
    // limit, so no compartment can ever bust — "you could stay here forever".
    expect(ndlMinutes(initialTissues(), 0)).toBe(Infinity);
    expect(ndlMinutes(initialTissues(), 6)).toBe(Infinity);
  });

  it('returns an independent object each call', () => {
    const a = initialTissues();
    updateTissues(a, 40, 600);
    expect(initialTissues().pN2[0]).toBeCloseTo(surfaceEquilibriumN2(), 12);
  });
});

// ---------------------------------------------------------------- NDLs

describe('no-decompression limits', () => {
  // SNAPSHOT/REGRESSION GUARD on the coefficients: these bands are the published
  // recreational no-stop limits (PADI 56 / 20 / 9 min at 18 / 30 / 40 m). They
  // pass today; they exist so that a typo in the a/b table is caught loudly.
  it('lands in the published recreational ballpark', () => {
    expect(ndlMinutes(initialTissues(), 18, TABLE_GF)).toBeGreaterThanOrEqual(50);
    expect(ndlMinutes(initialTissues(), 18, TABLE_GF)).toBeLessThanOrEqual(70);

    expect(ndlMinutes(initialTissues(), 30, TABLE_GF)).toBeGreaterThanOrEqual(15);
    expect(ndlMinutes(initialTissues(), 30, TABLE_GF)).toBeLessThanOrEqual(25);

    expect(ndlMinutes(initialTissues(), 40, TABLE_GF)).toBeGreaterThanOrEqual(6);
    expect(ndlMinutes(initialTissues(), 40, TABLE_GF)).toBeLessThanOrEqual(12);
  });

  it('is the same at the configured gradient factor, because gfHigh is 1.0', () => {
    // Guards the tuning decision recorded in config.ts: GF was deliberately left
    // at 1.0 so the in-game NDLs match the tables the player will later be taught.
    // If someone dials gfHigh down, this fails and they have to notice.
    expect(CONFIG.gfHigh).toBe(1.0);
    expect(ndlMinutes(initialTissues(), 30)).toBeCloseTo(
      ndlMinutes(initialTissues(), 30, TABLE_GF),
      9,
    );
  });

  it('is strictly decreasing in depth wherever it is finite', () => {
    // LAW: deeper is always more punishing. Checked at 0.5 m resolution rather
    // than at three sample depths, so a non-monotonic kink cannot hide.
    let prev = Infinity;
    let sawFinite = false;
    for (let d = 6; d <= 45; d += 0.5) {
      const ndl = ndlMinutes(initialTissues(), d, TABLE_GF);
      if (Number.isFinite(prev)) expect(ndl).toBeLessThan(prev);
      if (Number.isFinite(ndl)) sawFinite = true;
      prev = ndl;
    }
    expect(sawFinite).toBe(true);
  });

  it('is strictly decreasing in depth for an already-loaded diver too', () => {
    // LAW. The fresh-diver case is the easy one; this is the case the HUD shows
    // mid-dive, when the leading compartment may have changed.
    const loaded = soak(initialTissues(), 30, 10);
    let prev = ndlMinutes(loaded, 12, TABLE_GF);
    for (let d = 13; d <= 45; d += 1) {
      const ndl = ndlMinutes(loaded, d, TABLE_GF);
      if (Number.isFinite(prev)) expect(ndl).toBeLessThan(prev);
      prev = ndl;
    }
  });

  it('shrinks as the diver accumulates bottom time at a fixed depth', () => {
    // LAW: sitting still at depth can only ever spend no-stop time.
    const ts = initialTissues();
    let prev = ndlMinutes(ts, 24, TABLE_GF);
    // 24 m has ~28 min of no-stop time (SNAPSHOT), so 40 minutes is enough to
    // watch the countdown run all the way to zero.
    for (let i = 0; i < 40; i++) {
      soak(ts, 24, 1);
      const now = ndlMinutes(ts, 24, TABLE_GF);
      expect(now).toBeLessThan(prev);
      prev = now;
      if (now === 0) break;
    }
    expect(prev).toBe(0);
  });
});

// ---------------------------------------------------------------- consistency

describe('mutual consistency of NDL, ceiling and load', () => {
  // This is the invariant the whole HUD rests on: the countdown reaching zero,
  // the loading bar filling, and the ceiling lifting off the surface are three
  // views of ONE event. Drive a diver at 30 m in 1 s steps and find the step at
  // which each of the three flips.
  const findCrossings = (gf: number) => {
    const ts = initialTissues();
    let ndlZeroAt = -1;
    let ceilingAt = -1;
    let loadAt = -1;
    for (let t = 1; t <= 60 * 60 && (ndlZeroAt < 0 || ceilingAt < 0 || loadAt < 0); t++) {
      updateTissues(ts, 30, 1);
      if (ndlZeroAt < 0 && ndlMinutes(ts, 30, gf) <= 0) ndlZeroAt = t;
      if (ceilingAt < 0 && ceilingDepth(ts, gf) > 0) ceilingAt = t;
      if (loadAt < 0 && loadFraction(ts, gf) >= 1) loadAt = t;
    }
    return { ndlZeroAt, ceilingAt, loadAt };
  };

  it('all three flip on the same 1-second step at GF 100', () => {
    const { ndlZeroAt, ceilingAt, loadAt } = findCrossings(TABLE_GF);
    expect(ndlZeroAt).toBeGreaterThan(0);
    expect(ceilingAt).toBe(ndlZeroAt);
    expect(loadAt).toBe(ndlZeroAt);
    // SNAPSHOT: 981 dive-seconds ~= 16.4 min, matching the 30 m NDL above.
    expect(ndlZeroAt / 60).toBeGreaterThan(15);
    expect(ndlZeroAt / 60).toBeLessThan(18);
  });

  it('still agree at a conservative gradient factor', () => {
    // LAW by construction: surfacingLimit() and toleratedAmbient() must stay
    // algebraically consistent for any gf, or a GF-85 build would show a ceiling
    // while the NDL still read minutes remaining.
    const { ndlZeroAt, ceilingAt, loadAt } = findCrossings(0.85);
    expect(ndlZeroAt).toBeGreaterThan(0);
    expect(ceilingAt).toBe(ndlZeroAt);
    expect(loadAt).toBe(ndlZeroAt);
  });

  it('a conservative gradient factor buys less bottom time', () => {
    // LAW: smaller gf == more conservative == the obligation arrives sooner.
    expect(ndlMinutes(initialTissues(), 30, 0.85)).toBeLessThan(
      ndlMinutes(initialTissues(), 30, TABLE_GF),
    );
  });
});

// ---------------------------------------------------------------- ceiling

describe('ceilingDepth', () => {
  it('rounds up onto the 3 m stop grid, and never past the raw ceiling', () => {
    // LAW of the presentation: real stops are on a 3 m grid, and rounding must
    // be UP (a 1.2 m obligation is a 3 m stop, never a "go to 0 m").
    const deco = soak(initialTissues(), 30, 25);
    const raw = rawCeiling(deco);
    const grid = ceilingDepth(deco);
    expect(raw).toBeGreaterThan(0);
    expect(grid % 3).toBe(0);
    expect(grid).toBeGreaterThanOrEqual(raw);
    expect(grid - raw).toBeLessThan(3);
  });

  it('deepens the longer the diver overstays', () => {
    // LAW: the obligation only grows while you keep breathing at depth.
    const ts = initialTissues();
    soak(ts, 30, 25);
    const first = rawCeiling(ts);
    soak(ts, 30, 10);
    expect(rawCeiling(ts)).toBeGreaterThan(first);
  });

  it('blames a compartment that is actually at the ceiling', () => {
    const deco = soak(initialTissues(), 30, 25);
    const i = leadingCompartment(deco);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(16);
    // SNAPSHOT: a 25 min square dive at 30 m is led by a medium-fast tissue.
    expect(ZHL16C[i].t).toBeLessThanOrEqual(38.3);
  });
});

// ---------------------------------------------------------------- off-gassing

describe('off-gassing', () => {
  it('clears a deco obligation after hours at the surface', () => {
    // LAW: the same Haldane equation runs backwards when P_insp < P_tissue.
    const ts = soak(initialTissues(), 30, 25);
    expect(ceilingDepth(ts)).toBeGreaterThan(0);
    expect(loadFraction(ts)).toBeGreaterThan(1);

    soak(ts, 0, 180, 10);
    expect(ceilingDepth(ts)).toBe(0);
    // SNAPSHOT: three hours on the boat takes the bar down under 0.4 — the slow
    // compartments are genuinely still holding gas, which is the whole reason
    // repetitive-dive tables exist.
    expect(loadFraction(ts)).toBeLessThan(0.4);
    expect(loadFraction(ts)).toBeGreaterThan(0);
  });

  it('leaves the diver measurably worse off than a fresh one', () => {
    // LAW: residual nitrogen shortens the next dive's no-stop time.
    const rested = soak(soak(initialTissues(), 30, 25), 0, 180, 10);
    const fresh = ndlMinutes(initialTissues(), 18, TABLE_GF);
    const after = ndlMinutes(rested, 18, TABLE_GF);
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(fresh);
  });

  it('every compartment monotonically off-gasses toward equilibrium', () => {
    // LAW: no compartment may overshoot below the inspired pressure.
    const ts = soak(initialTissues(), 40, 15);
    const before = [...ts.pN2];
    soak(ts, 0, 60, 10);
    const p0 = surfaceEquilibriumN2();
    for (let i = 0; i < 16; i++) {
      expect(ts.pN2[i]).toBeLessThan(before[i]);
      expect(ts.pN2[i]).toBeGreaterThanOrEqual(p0 - 1e-12);
    }
  });
});

// ---------------------------------------------------------------- integration

describe('updateTissues integration', () => {
  it('is deterministic: the same step sequence gives identical pressures', () => {
    // Guards against a stray Math.random / Date.now / module-level mutable state
    // creeping into the model. Bit-for-bit equality is the point.
    const run = () => {
      const ts = initialTissues();
      for (let i = 0; i < 400; i++) updateTissues(ts, 5 + (i % 30), 0.25);
      return ts.pN2;
    };
    expect(run()).toEqual(run());
  });

  it('ignores non-positive steps', () => {
    const ts = initialTissues();
    const before = [...ts.pN2];
    updateTissues(ts, 40, 0);
    updateTissues(ts, 40, -5);
    expect(ts.pN2).toEqual(before);
  });

  it('60 x 1 s equals 1 x 60 s at constant depth', () => {
    // LAW: the Haldane solution is exact for a constant P_insp, so sub-stepping
    // must not change the answer at all. Anything but ~1e-15 here means the
    // integrator has been swapped for something lossy.
    const many = initialTissues();
    for (let i = 0; i < 60; i++) updateTissues(many, 30, 1);
    const once = initialTissues();
    updateTissues(once, 30, 60);
    for (let i = 0; i < 16; i++) expect(many.pN2[i]).toBeCloseTo(once.pN2[i], 12);
  });

  it('is stable across every step size engine.ts actually uses', () => {
    // main.ts sub-steps at <= 0.25 dive-seconds; the sim never sees a bigger dt.
    // Integrating a full descend/hold/ascend profile at 0.05 / 0.25 / 1.0 s must
    // agree to well inside anything the HUD could render.
    const profile = (t: number) => (t < 90 ? t / 3 : t < 900 ? 30 : Math.max(0, 30 - (t - 900) / 8));
    const integrate = (dt: number) => {
      const ts = initialTissues();
      // Midpoint depth, so what is being compared is the solver's stability and
      // not the first-order error of sampling a ramp at the step boundary.
      for (let t = 0; t < 1200; t += dt) updateTissues(ts, profile(t + dt / 2), dt);
      return ts;
    };
    const fine = integrate(0.05);
    // dt = 0.25 is main.ts's actual maxStep; 1.0 is well past anything the game
    // uses and is included to show the error grows gracefully, not explosively.
    // Scale: 1e-3 bar of N2 works out at under a centimetre of ceiling, so the
    // user-visible quantities (loadFraction, the 3 m-grid ceiling) are asserted
    // to agree outright and the raw pressures only need a sanity net.
    for (const [dt, tol] of [[0.25, 1e-3], [1.0, 2e-3]] as const) {
      const coarse = integrate(dt);
      for (let i = 0; i < 16; i++) expect(Math.abs(coarse.pN2[i] - fine.pN2[i])).toBeLessThan(tol);
      expect(loadFraction(coarse)).toBeCloseTo(loadFraction(fine), 3);
      expect(ceilingDepth(coarse)).toBe(ceilingDepth(fine));
    }
  });

  it('never loads a compartment past the inspired pressure', () => {
    // LAW: a bucket cannot fill above its source. A sign error in the Haldane
    // step would show up here immediately.
    const ts = initialTissues();
    const pInsp = inspiredN2(40);
    const p0 = surfaceEquilibriumN2();
    let overshoot = 0;
    for (let i = 0; i < 5000; i++) {
      updateTissues(ts, 40, 0.25);
      for (const p of ts.pN2) overshoot = Math.max(overshoot, p - pInsp);
    }
    expect(overshoot).toBeLessThanOrEqual(1e-12);

    // LAW of the half-times, after ~21 min (5.2 half-times) at 40 m: the 4 min
    // compartment is all but saturated while the 635 min one has barely stirred.
    const fraction = (i: number) => (ts.pN2[i] - p0) / (pInsp - p0);
    expect(fraction(0)).toBeGreaterThan(0.95);
    expect(fraction(15)).toBeLessThan(0.05);
  });
});
