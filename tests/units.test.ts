/**
 * ui/units.ts — the presentation layer, and the one rule that is not purely
 * cosmetic (the gas reserve).
 *
 * The contract these tests defend:
 *   1. `sim/` never sees a unit. Nothing here may leak into the simulation.
 *   2. A value is converted exactly once.
 *   3. The canonical-figure table exists so teaching copy can say "130 ft"
 *      instead of "131 ft". It must never touch a live gauge reading.
 *   4. Every number the player is told about the reserve is the *same* number.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import * as U from '../src/ui/units';

const FT_PER_M = 3.28084;
const PSI_PER_BAR = 14.5038;

afterEach(() => U.setUnits('metric'));

// ------------------------------------------------------------------ conversion

describe('conversion happens exactly once', () => {
  it('round-trips depth and pressure through the display helpers', () => {
    U.setUnits('metric');
    expect(U.depthValue(30)).toBe(30);
    expect(U.pressureValue(200)).toBe(200);
    expect(U.rateValue(9)).toBe(9);

    U.setUnits('imperial');
    expect(U.depthValue(30)).toBeCloseTo(30 * FT_PER_M, 6);
    expect(U.pressureValue(200)).toBeCloseTo(200 * PSI_PER_BAR, 6);
    expect(U.rateValue(9)).toBeCloseTo(9 * FT_PER_M, 6);
  });

  /**
   * `depthNum` labels its own unit elsewhere, `depth` carries one. Both must
   * agree, or a gauge and its caption disagree by a conversion.
   */
  it('agrees between the bare-number and unit-suffixed forms', () => {
    for (const u of ['metric', 'imperial'] as const) {
      U.setUnits(u);
      for (const m of [7.3, 22.4, 41.9]) {
        expect(U.depth(m)).toBe(`${U.depthNum(m)} ${U.depthUnit()}`);
      }
    }
  });

  it('rounds psi to the needle resolution of a real SPG', () => {
    U.setUnits('imperial');
    // A full AL80 must read the familiar 2900 psi, not 2901.
    expect(U.tankPressureNum(CONFIG.tank.startBar)).toBe('2900');
    expect(Number(U.tankPressureNum(137)) % 50).toBe(0);
  });
});

// ------------------------------------------------------------------ canonical

describe('canonical imperial figures', () => {
  /**
   * LAW: substitution applies to the exact metric teaching values only. Wizard
   * and tooltip copy quoting "40 m" should read "130 ft" (what every US table
   * says), but a gauge reading 40.0001 m must convert honestly.
   */
  it('fires on exact teaching values and not on neighbours', () => {
    U.setUnits('imperial');
    expect(U.teach(40, 0)).toBe('130 ft');
    expect(U.teach(30, 0)).toBe('100 ft');
    expect(U.teach(5, 0)).toBe('15 ft');
    // One millimetre off and it is a measurement, not a teaching figure.
    expect(U.teach(40.001, 0)).toBe('131 ft');
    expect(U.teach(29.999, 0)).toBe('98 ft');
  });

  /**
   * LAW: `depth()` is the honest converter and never substitutes. Substitution is
   * opt-in via `teach()`, so a live reading cannot be quietly rewritten.
   */
  it('never substitutes in the plain converter', () => {
    U.setUnits('imperial');
    expect(U.depth(40, 0)).toBe('131 ft');
    expect(U.depth(30, 0)).toBe('98 ft');
    expect(U.depth(5, 0)).toBe('16 ft');
  });

  /**
   * REGRESSION GUARD — was a real defect in `src/ui/units.ts` `depth()`.
   *
   * The decompression ceiling is a live gauge reading: `ceilingDepth()` snaps it
   * to the 3 m stop grid, so it lands on 3, 6, 9, 12, 15, 18, 21 … and the
   * canonical table intercepts 12 and 18 (and 30) on the way through. The
   * imperial ceiling ladder therefore reads
   *
   *     10, 20, 30, 40, 49, 60, 69, 79, 89, 100 ft
   *
   * instead of the honest 10, 20, 30, 39, 49, 59, 69, 79, 89, 98 — two rungs of a
   * uniformly-spaced ladder are quietly nudged and the spacing stops being
   * uniform. The player reads this off `render.ts` drawCeilingLine ("DO NOT GO
   * ABOVE 60 ft") and off the HUD's "go no higher than" line.
   *
   * FIXED: substitution is now opt-in via `teach()`; `depth()` converts honestly,
   * and the ceiling — a live reading snapped to the 3 m grid — uses `depth()`.
   */
  it('does not fire on the decompression stop grid, which is a gauge', () => {
    U.setUnits('imperial');
    for (let m = 3; m <= 30; m += 3) {
      expect(U.depth(m, 0)).toBe(`${Math.round(m * FT_PER_M)} ft`);
    }
  });
});

// ------------------------------------------------------------------ the reserve

describe('the gas reserve is one number, told the same way everywhere', () => {
  it('is 50 bar metric and 34.5 bar (500 psi) imperial', () => {
    U.setUnits('metric');
    expect(U.reserveBar()).toBe(CONFIG.tank.reserveBar);
    expect(U.reserveLabel()).toBe('50 bar');

    U.setUnits('imperial');
    expect(U.reserveBar()).toBe(CONFIG.tank.reserveBarImperial);
    expect(U.reserveLabel()).toBe('500 psi');
  });

  /**
   * LAW: the reserve is a *rule*, not a conversion. `CONFIG.tank.reserveBar` is
   * the metric rule; an imperial player is taught 500 psi, which is a different
   * amount of gas. Formatting the metric constant for an imperial player quotes a
   * reserve nobody is taught — this test pins the size of that trap so it is
   * obvious in review why every consumer must go through `reserveBar()`.
   *
   * (The wizard's "Depth eats your air" slide did exactly this and told imperial
   * players "750 psi is your reserve" while the HUD warned at 500.)
   */
  it('is not the metric constant re-expressed in psi', () => {
    U.setUnits('imperial');
    expect(U.tankPressure(CONFIG.tank.reserveBar)).toBe('750 psi');
    expect(U.reserveLabel()).toBe('500 psi');
    expect(U.tankPressure(CONFIG.tank.reserveBar)).not.toBe(U.reserveLabel());
  });

  /**
   * The two traditions really are different amounts of gas — this is the point of
   * the asymmetry, and the test that stops someone "fixing" it into one number.
   */
  it('is a genuinely different amount of gas in each tradition', () => {
    expect(CONFIG.tank.reserveBar - CONFIG.tank.reserveBarImperial).toBeGreaterThan(10);
  });
});

// ------------------------------------------------------------------ containment

describe('the simulation stays unit-agnostic', () => {
  /**
   * LAW: nothing under `src/sim/` imports the unit layer. If it ever does, the
   * physics starts depending on a display preference and every result in the
   * suite becomes conditional on localStorage.
   */
  it('has no import of ui/units from src/sim', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(import.meta.dirname, '..', 'src', 'sim');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, `${f} must not import the unit layer`).not.toMatch(/from\s+'\.\.\/ui\//);
    }
  });
});

// ------------------------------------------------------- environment safety

describe('unit detection does not assume a browser', () => {
  /**
   * REGRESSION GUARD. `suggestedUnits()` read `navigator` unguarded. Node 21+
   * defines a `navigator` global and Node 20 does not, so this passed locally
   * and broke the CI build — the kind of bug that only shows up on someone
   * else's machine.
   */
  it('falls back to metric when navigator is absent', () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    // @ts-expect-error deliberately removing a global for the duration of the test
    delete globalThis.navigator;
    try {
      expect(() => U.suggestedUnits()).not.toThrow();
      expect(U.suggestedUnits()).toBe('metric');
    } finally {
      if (saved) Object.defineProperty(globalThis, 'navigator', saved);
    }
  });
});
