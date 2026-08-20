/**
 * sim/pressure.ts — the teaching anchors.
 *
 * Every number asserted in this file is a LAW (hydrostatics + Boyle), not a
 * tuning snapshot. If one of these breaks, the game is teaching something false.
 */
import { describe, expect, it } from 'vitest';
import {
  ambientPressure,
  depthForPressure,
  pressureMultiplier,
  relativeVolume,
} from '../src/sim/pressure';

describe('ambientPressure', () => {
  it('hits the exact anchors the game teaches', () => {
    // LAW (given the deliberate choice of a clean 1.0 bar surface):
    // these three are printed on the depth ruler.
    expect(ambientPressure(0)).toBeCloseTo(1, 12);
    expect(ambientPressure(10)).toBeCloseTo(2, 12);
    expect(ambientPressure(40)).toBeCloseTo(5, 12);
  });

  it('adds exactly 1 bar per 10 m, everywhere', () => {
    // LAW: the relationship is linear in depth even though the *multiplier* is not.
    for (let d = 0; d <= 45; d += 2.5) {
      expect(ambientPressure(d + 10) - ambientPressure(d)).toBeCloseTo(1, 12);
    }
  });

  it('is strictly increasing with depth', () => {
    for (let d = 0; d < 45; d++) {
      expect(ambientPressure(d + 1)).toBeGreaterThan(ambientPressure(d));
    }
  });
});

describe('depthForPressure', () => {
  it('inverts ambientPressure across the playable range', () => {
    for (let d = 0; d <= 46; d += 0.5) {
      expect(depthForPressure(ambientPressure(d))).toBeCloseTo(d, 10);
    }
  });

  it('clamps sub-surface pressures to the surface rather than a negative depth', () => {
    // Matters because rawCeiling() feeds tolerated ambient pressures straight in;
    // an un-clamped negative would make a clear diver look like they owed a stop.
    expect(depthForPressure(0.5)).toBe(0);
    expect(depthForPressure(1)).toBe(0);
    expect(depthForPressure(-3)).toBe(0);
  });
});

describe('pressureMultiplier', () => {
  it('reads 2x at 10 m, 4x at 30 m, 5x at 40 m', () => {
    // LAW. This is the ruler's "x2 / x3 / x4" annotation.
    expect(pressureMultiplier(0)).toBeCloseTo(1, 12);
    expect(pressureMultiplier(10)).toBeCloseTo(2, 12);
    expect(pressureMultiplier(30)).toBeCloseTo(4, 12);
    expect(pressureMultiplier(40)).toBeCloseTo(5, 12);
  });
});

describe('relativeVolume (Boyle)', () => {
  it('halves in the first 10 m', () => {
    // LAW: P.V constant. The bubble on the ruler.
    expect(relativeVolume(0)).toBeCloseTo(1, 12);
    expect(relativeVolume(10)).toBeCloseTo(0.5, 12);
    expect(relativeVolume(30)).toBeCloseTo(0.25, 12);
  });

  it('is exactly the reciprocal of the pressure multiplier', () => {
    for (let d = 0; d <= 45; d += 1.5) {
      expect(relativeVolume(d) * pressureMultiplier(d)).toBeCloseTo(1, 12);
    }
  });

  it('front-loads the shrink: 0-10 m costs more volume than 30-40 m', () => {
    // LAW, and the single most important intuition in the whole game: the first
    // 10 m halves the bubble, while 30 -> 40 m only takes another sixth off it.
    const first10 = relativeVolume(0) - relativeVolume(10);
    const last10 = relativeVolume(30) - relativeVolume(40);
    expect(first10).toBeCloseTo(0.5, 12);
    expect(last10).toBeCloseTo(0.05, 12);
    expect(first10).toBeGreaterThan(last10 * 5);
  });
});
