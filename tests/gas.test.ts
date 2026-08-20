/**
 * sim/gas.ts — "gas planning scales with depth".
 */
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import {
  barPerSecond,
  consumptionLpm,
  minutesOfGasLeft,
  minutesToReserve,
} from '../src/sim/gas';

describe('consumptionLpm', () => {
  it('is the SAC rate at the surface', () => {
    // LAW given the model definition (consumption = SAC x P_amb x exertion).
    expect(consumptionLpm(0)).toBeCloseTo(CONFIG.sacLpm, 12);
  });

  it('scales linearly with ambient pressure — 4x at 30 m', () => {
    // LAW. This is the lesson the failure state "out of air" exists to teach.
    expect(consumptionLpm(30) / consumptionLpm(0)).toBeCloseTo(4, 12);
    expect(consumptionLpm(10) / consumptionLpm(0)).toBeCloseTo(2, 12);
    expect(consumptionLpm(40) / consumptionLpm(0)).toBeCloseTo(5, 12);
  });

  it('scales linearly with exertion, independently of depth', () => {
    const e = CONFIG.exertion.ascend;
    expect(consumptionLpm(30, e) / consumptionLpm(30)).toBeCloseTo(e, 12);
    expect(consumptionLpm(0, e) / consumptionLpm(0)).toBeCloseTo(e, 12);
  });
});

describe('barPerSecond', () => {
  it('is consumption converted through the tank volume', () => {
    // LAW: an ideal tank holds volumeL x tankBar surface-litres.
    expect(barPerSecond(30)).toBeCloseTo(consumptionLpm(30) / 60 / CONFIG.tank.volumeL, 12);
  });

  it('drains 4x faster at 30 m than at the surface', () => {
    expect(barPerSecond(30) / barPerSecond(0)).toBeCloseTo(4, 12);
  });
});

describe('minutesOfGasLeft', () => {
  it('gives a plausible AL80 run time at 10 m', () => {
    // SNAPSHOT of the configured AL80 (11.1 L @ 200 bar) and 16 L/min SAC:
    // 200 x 11.1 / (16 x 2) = 69.4 min. Asserted as a band, because the point is
    // that the number is *believable to a diver*, not that it is exactly 69.4.
    const mins = minutesOfGasLeft(CONFIG.tank.startBar, 10);
    expect(mins).toBeGreaterThan(60);
    expect(mins).toBeLessThan(80);
  });

  it('is exactly halved by doubling the ambient pressure', () => {
    // LAW.
    const shallow = minutesOfGasLeft(200, 0);
    expect(minutesOfGasLeft(200, 10)).toBeCloseTo(shallow / 2, 9);
    expect(minutesOfGasLeft(200, 30)).toBeCloseTo(shallow / 4, 9);
  });

  it('never goes negative, even with a nonsense tank pressure', () => {
    // The HUD reads this straight out; a negative would render as "-3 min left".
    expect(minutesOfGasLeft(0, 30)).toBe(0);
    expect(minutesOfGasLeft(-50, 30)).toBe(0);
    expect(minutesOfGasLeft(-1e6, 0)).toBe(0);
  });

  it('is monotonically shorter as the diver goes deeper', () => {
    let prev = Infinity;
    for (let d = 0; d <= 45; d += 1) {
      const m = minutesOfGasLeft(150, d);
      expect(m).toBeLessThan(prev);
      prev = m;
    }
  });
});

describe('minutesToReserve', () => {
  it('is always less than gas-to-zero, and hits 0 at or below the reserve', () => {
    expect(minutesToReserve(200, 30)).toBeLessThan(minutesOfGasLeft(200, 30));
    expect(minutesToReserve(CONFIG.tank.reserveBar, 30)).toBe(0);
    expect(minutesToReserve(CONFIG.tank.reserveBar - 20, 30)).toBe(0);
  });
});
