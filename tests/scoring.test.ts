/**
 * sim/scoring.ts — the single definition of "the score".
 *
 * The bug this file exists to prevent has already happened three times: the HUD,
 * the debrief headline and the debrief breakdown each computed the score their
 * own way and drifted apart. These tests assert the *identities* that make one
 * definition possible, so a change to decay, diversity or the penalty cannot
 * silently move one consumer without the others.
 */
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createEngine } from '../src/sim/engine';
import {
  bankedScore,
  diversityMultiplier,
  netScore,
  scaledFishPoints,
} from '../src/sim/scoring';
import { buildDebrief } from '../src/ui/debrief';
import type { DiveState, Fish, Species } from '../src/types';
import { ascendAt, drive, holdDepth } from './helpers';

const MIN = 60;

const testSpecies = (id: string, points: number): Species => ({
  id,
  name: id,
  emoji: '?',
  points,
  minDepth: 0,
  maxDepth: 45,
  rarity: 1,
  speed: 0,
  size: 20,
  blurb: '',
});

/** Park a fish on the diver and step once, so it is certain to be logged. */
function logSighting(e: ReturnType<typeof createEngine>, species: Species, id: number): void {
  const f: Fish = {
    id,
    species,
    x: e.state.x,
    depth: e.state.depth,
    phase: 0,
    observed: false,
  };
  e.state.fish = [f];
  e.step(0.25, 'hold');
  expect(f.observed).toBe(true);
}

/** A clean dive to 24 m with the full safety stop, the reference "good dive". */
function cleanDive(): ReturnType<typeof createEngine> {
  const e = createEngine();
  drive(e, holdDepth(24), 12 * MIN);
  drive(e, ascendAt(8, 5), 8 * MIN);
  drive(e, holdDepth(5), 4 * MIN);
  drive(e, ascendAt(8, -1), 4 * MIN);
  expect(e.state.endReason).toBe('surfaced');
  return e;
}

// ------------------------------------------------------------------ identities

describe('the score has exactly one definition', () => {
  /**
   * LAW: `state.score` (the multiplier's base) and the per-species breakdown are
   * the same total. The debrief's "Fish observed" row is the sum of
   * `awardedBySpecies`, and its "Variety ×N" row multiplies that; if the two ever
   * diverge the logbook column stops adding up to the headline — which is the
   * exact bug that shipped once already.
   */
  it('raw fish points equal the sum of the per-species awards', () => {
    const e = cleanDive();
    const sum = Object.values(e.state.awardedBySpecies).reduce((a, b) => a + b, 0);
    expect(sum).toBe(e.state.score);
    expect(buildDebrief(e.state).fishPoints).toBe(e.state.score);
  });

  /**
   * LAW: netScore is exactly `round(raw × diversity) + bonuses − round(penalty)`.
   * The HUD prints netScore live and the debrief prints the three terms as
   * separate rows; a reader adding the rows up must land on the total.
   */
  it('netScore is the sum of the rows the debrief shows', () => {
    const e = cleanDive();
    const s = e.state;
    const mult = diversityMultiplier(s.observed.size);
    expect(scaledFishPoints(s)).toBe(Math.round(s.score * mult));
    expect(netScore(s)).toBe(
      Math.round(s.score * mult) + s.bonusPoints - Math.round(s.ascentPenalty),
    );
    const d = buildDebrief(s);
    expect(d.diversityMult).toBe(mult);
    expect(d.bonusPoints).toBe(s.bonusPoints);
    expect(d.ascentPenalty).toBe(Math.round(s.ascentPenalty));
    expect(Math.round(d.fishPoints * d.diversityMult) + d.bonusPoints - d.ascentPenalty).toBe(
      d.score,
    );
  });

  /**
   * LAW: end-of-dive bonuses are added *after* the multiplier, never inside it.
   * Putting them inside would mean a diver who logs twelve species gets 1.9× the
   * safety-stop bonus too, which turns the breadth reward into a bonus amplifier.
   */
  it('keeps bonusPoints outside the diversity multiplier', () => {
    const e = createEngine();
    drive(e, holdDepth(12), 2 * MIN);
    // Log ten distinct species so the multiplier is well above 1.
    for (let i = 0; i < 10; i++) logSighting(e, testSpecies(`sp-${i}`, 10), 5000 + i);
    const s = e.state;
    expect(diversityMultiplier(s.observed.size)).toBeGreaterThan(1.5);

    const before = netScore(s);
    s.bonusPoints += 100;
    // The bonus must move the score by exactly 100, not by 100 × multiplier.
    expect(netScore(s) - before).toBe(100);
  });

  /**
   * LAW: you bank only the dive you come back from. Every failure reason scores
   * zero, however much was logged on the way down.
   */
  it('banks nothing for a dive that did not end on the surface', () => {
    const e = createEngine();
    drive(e, holdDepth(20), 3 * MIN);
    for (let i = 0; i < 6; i++) logSighting(e, testSpecies(`sp-${i}`, 40), 6000 + i);
    expect(netScore(e.state)).toBeGreaterThan(0);

    for (const reason of [
      'out-of-air',
      'ascent-too-fast',
      'dcs-ceiling',
      'depth-exceeded',
    ] as const) {
      const s: DiveState = { ...e.state, endReason: reason };
      expect(bankedScore(s)).toBe(0);
      expect(buildDebrief(s).score).toBe(0);
    }
    expect(bankedScore({ ...e.state, endReason: 'surfaced' })).toBe(netScore(e.state));
  });
});

// ------------------------------------------------------------------ the curve

describe('diversity multiplier', () => {
  it('is 1.0 for a single species and grows per extra one', () => {
    expect(diversityMultiplier(0)).toBe(1);
    expect(diversityMultiplier(1)).toBe(1);
    expect(diversityMultiplier(2)).toBeCloseTo(1 + CONFIG.diversity.perExtraSpecies, 10);
  });

  /**
   * LAW: the multiplier is capped. It is the counterweight to the 1-point floor
   * on repeats; uncapped, adding species to the table would quietly inflate every
   * historical score.
   */
  it('is capped, and the cap is reachable with the species that exist', () => {
    expect(diversityMultiplier(1000)).toBe(CONFIG.diversity.max);
    // 14 species in the table today; the cap must be reachable, or it is dead code.
    expect(diversityMultiplier(14)).toBe(CONFIG.diversity.max);
  });
});

describe('repeat-sighting decay: floor and cap together', () => {
  /**
   * LAW: the 1-point floor is bounded by `maxScoringSightings`. The floor keeps
   * the safety stop worth playing; the cap is what stops a floor with no ceiling
   * from turning "time underwater" back into "points", which is the grind the
   * decay was added to kill. Neither rule is safe on its own.
   */
  it('stops paying for a species after maxScoringSightings, and logs it anyway', () => {
    const e = createEngine();
    drive(e, holdDepth(10), 1 * MIN);
    const sp = testSpecies('grind', 3);
    const n = CONFIG.maxScoringSightings;

    let id = 7000;
    for (let i = 0; i < n; i++) logSighting(e, sp, id++);
    const cappedScore = e.state.score;
    const cappedForSpecies = e.state.awardedBySpecies.grind;
    expect(e.state.observedCounts.grind).toBe(n);
    // Every sighting up to the cap paid at least the 1-point floor.
    expect(cappedForSpecies).toBeGreaterThanOrEqual(n);

    // Ten more sightings past the cap: still logged, worth nothing.
    for (let i = 0; i < 10; i++) logSighting(e, sp, id++);
    expect(e.state.score).toBe(cappedScore);
    expect(e.state.awardedBySpecies.grind).toBe(cappedForSpecies);
    expect(e.state.observedCounts.grind).toBe(n + 10);
    // A species that has stopped paying must still count once toward breadth.
    expect(e.state.observed.has('grind')).toBe(true);
  });

  /**
   * LAW: the fish-point total is monotonic. A sighting may be worthless but can
   * never subtract, or the "+N" popup and the running score contradict each other.
   */
  it('never lets a sighting reduce the score', () => {
    const e = createEngine();
    drive(e, holdDepth(10), 1 * MIN);
    const sp = testSpecies('mono', 60);
    let prev = e.state.score;
    for (let i = 0; i < 20; i++) {
      logSighting(e, sp, 8000 + i);
      expect(e.state.score).toBeGreaterThanOrEqual(prev);
      prev = e.state.score;
    }
  });
});

// ------------------------------------------------------------------ the penalty

describe('fast-ascent penalty', () => {
  /**
   * LAW: the penalty is docked once, in `state.ascentPenalty`, and subtracted
   * once, in `netScore`. It must not also be baked into `state.score`, or a
   * rushed ascent costs double and the debrief's own subtraction row is a lie.
   */
  it('is docked exactly once and never touches the raw fish points', () => {
    const e = createEngine();
    drive(e, holdDepth(30), 4 * MIN);
    const rawBefore = e.state.score;
    // Hold "ascend" from 30 m: the rate runs past the 9 m/min limit.
    drive(e, () => 'ascend', 40);
    expect(e.state.ascentPenalty).toBeGreaterThan(0);
    // Fish points are untouched by the penalty (any change is new sightings only).
    expect(e.state.score).toBeGreaterThanOrEqual(rawBefore);

    const s = e.state;
    const expected =
      Math.round(s.score * diversityMultiplier(s.observed.size)) +
      s.bonusPoints -
      Math.round(s.ascentPenalty);
    expect(netScore(s)).toBe(expected);
  });

  /**
   * LAW: reset() clears the penalty. It lives on DiveState, so a fresh state
   * object clears it — this test is the tripwire for anyone moving it into an
   * engine-local accumulator, where reset() has to remember it explicitly.
   */
  it('does not survive a reset', () => {
    const e = createEngine();
    drive(e, holdDepth(30), 4 * MIN);
    drive(e, () => 'ascend', 40);
    expect(e.state.ascentPenalty).toBeGreaterThan(0);
    e.reset();
    expect(e.state.ascentPenalty).toBe(0);
    expect(netScore(e.state)).toBe(0);
  });
});
