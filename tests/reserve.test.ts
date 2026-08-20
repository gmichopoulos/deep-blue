/**
 * The unit-dependent gas reserve, end to end.
 *
 * The reserve is the one place the player's unit choice changes the *game* and
 * not just the wording: 50 bar and 500 psi (34.5 bar) are different amounts of
 * gas. `main.ts` pushes the current rule into the engine every frame with
 * `setReserveBar()`, so the engine must honour whatever it was last told —
 * including a change made mid-dive — and every consumer must read the same rule.
 */
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createEngine, type Engine } from '../src/sim/engine';
import { minutesOfGasLeft, minutesToReserve } from '../src/sim/gas';
import { ascendAt, drive, driveUntil, holdDepth } from './helpers';

const MIN = 60;

/** Midway between the two reserve rules: above 500 psi, below 50 bar. */
const BETWEEN_RULES = (CONFIG.tank.reserveBar + CONFIG.tank.reserveBarImperial) / 2;

/**
 * A clean 24 m dive with the full safety stop, then hang at 5 m until the tank
 * reads `stopAtBar`, then surface. Same profile every time, so the only variable
 * is which reserve rule the engine was handed.
 */
function diveEndingWith(reserveBar: number, stopAtBar: number): Engine {
  const e = createEngine();
  e.setReserveBar(reserveBar);
  drive(e, holdDepth(24), 12 * MIN);
  drive(e, ascendAt(8, 5), 8 * MIN);
  drive(e, holdDepth(5), 4 * MIN);
  expect(e.state.safetyStopDone).toBe(true);
  driveUntil(e, holdDepth(5), (s) => s.tankBar <= stopAtBar, 120 * MIN);
  return e;
}

describe('the engine honours the reserve it was given', () => {
  /**
   * LAW: the reserve-intact bonus is decided against `setReserveBar()`, not
   * against `CONFIG.tank.reserveBar`. A metric and an imperial diver surfacing
   * with the same 40 bar get different answers, and that is correct.
   */
  it('pays reserve-intact at 34.5 bar but not at 50 bar for the same dive', () => {
    const finish = (reserve: number) => {
      const e = diveEndingWith(reserve, BETWEEN_RULES);
      drive(e, ascendAt(8, -1), 4 * MIN);
      expect(e.state.endReason).toBe('surfaced');
      return e.state;
    };

    const metric = finish(CONFIG.tank.reserveBar);
    const imperial = finish(CONFIG.tank.reserveBarImperial);
    // Identical profile, identical gas: the only difference is the rule applied.
    expect(metric.tankBar).toBeCloseTo(imperial.tankBar, 5);
    expect(metric.tankBar).toBeLessThan(CONFIG.tank.reserveBar);
    expect(metric.tankBar).toBeGreaterThan(CONFIG.tank.reserveBarImperial);

    expect(imperial.bonusPoints).toBeGreaterThanOrEqual(CONFIG.bonus.reserveIntact);
    expect(metric.bonusPoints).toBeLessThan(CONFIG.bonus.reserveIntact);
  });

  /**
   * LAW: toggling units mid-dive takes effect. main.ts calls setReserveBar()
   * every frame, so the rule in force at the moment of surfacing is the one that
   * pays — the reserve must not be latched at dive start.
   */
  it('uses the reserve in force when the dive ends, not when it began', () => {
    const e = diveEndingWith(CONFIG.tank.reserveBar, BETWEEN_RULES); // started metric
    // The player flips the toggle to imperial on the way up.
    e.setReserveBar(CONFIG.tank.reserveBarImperial);
    drive(e, ascendAt(8, -1), 4 * MIN);
    expect(e.state.endReason).toBe('surfaced');
    expect(e.state.bonusPoints).toBeGreaterThanOrEqual(CONFIG.bonus.reserveIntact);
  });

  /**
   * LAW: reset() must not silently revert the reserve to the metric default.
   * main.ts sets it every frame, so either behaviour "works" in the app — but a
   * reset that quietly reinstates 50 bar means the first frames of every new dive
   * run on a rule the player did not choose, and any headless consumer of the
   * engine gets a different answer after reset than before it.
   */
  it('keeps the configured reserve across reset()', () => {
    const e = createEngine();
    e.setReserveBar(CONFIG.tank.reserveBarImperial);
    e.reset();
    drive(e, holdDepth(24), 12 * MIN);
    drive(e, ascendAt(8, 5), 8 * MIN);
    drive(e, holdDepth(5), 4 * MIN);
    driveUntil(e, holdDepth(5), (s) => s.tankBar <= BETWEEN_RULES, 120 * MIN);
    drive(e, ascendAt(8, -1), 4 * MIN);
    expect(e.state.endReason).toBe('surfaced');
    expect(e.state.tankBar).toBeLessThan(CONFIG.tank.reserveBar);
    expect(e.state.bonusPoints).toBeGreaterThanOrEqual(CONFIG.bonus.reserveIntact);
  });

  it('scores spare gas above the given reserve, not above the metric one', () => {
    const spareBonus = (reserve: number): number => {
      const e = createEngine();
      e.setReserveBar(reserve);
      drive(e, holdDepth(24), 12 * MIN);
      drive(e, ascendAt(8, 5), 8 * MIN);
      drive(e, holdDepth(5), 4 * MIN);
      drive(e, ascendAt(8, -1), 4 * MIN);
      const spare = Math.max(0, e.state.tankBar - reserve);
      expect(e.state.bonusPoints).toBe(
        CONFIG.bonus.safetyStop + CONFIG.bonus.reserveIntact + Math.round(spare * CONFIG.bonus.gasPerBar),
      );
      return e.state.bonusPoints;
    };
    // A lower reserve leaves more "spare" gas, so it must pay more.
    expect(spareBonus(CONFIG.tank.reserveBarImperial)).toBeGreaterThan(
      spareBonus(CONFIG.tank.reserveBar),
    );
  });
});

describe('gas helpers and the reserve', () => {
  /**
   * LAW: `minutesToReserve` takes the reserve as a parameter. It used to hard-code
   * the metric constant, which answered the metric question for every player; the
   * moment the HUD wires up a "minutes to turn pressure" readout that becomes a
   * visibly wrong number for half the audience.
   */
  it('lets the caller choose which reserve rule applies', () => {
    const metric = minutesToReserve(200, 30);
    const imperial = minutesToReserve(200, 30, CONFIG.tank.reserveBarImperial);
    expect(metric).toBe(minutesToReserve(200, 30, CONFIG.tank.reserveBar));
    // The lower (imperial) reserve leaves more gas you are allowed to plan on.
    expect(imperial).toBeGreaterThan(metric);
    expect(minutesToReserve(30, 30, CONFIG.tank.reserveBarImperial)).toBe(0);
  });

  it('never reports more usable gas than there is gas', () => {
    for (const d of [0, 10, 30, 45]) {
      expect(minutesToReserve(200, d)).toBeLessThan(minutesOfGasLeft(200, d));
    }
  });
});
