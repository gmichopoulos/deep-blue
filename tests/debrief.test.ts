/**
 * ui/debrief.ts — the end-of-dive report.
 *
 * `buildDebrief` is pure, so it can be driven headlessly from a real dive. The
 * rule this file enforces is the one the earlier fish-points bug taught: the
 * debrief REPORTS the dive, it does not RE-DECIDE it. Anything the engine already
 * decided — what was awarded, whether the safety stop counted — must be read from
 * state, never recomputed from the sampled profile, because the profile is a
 * lossy 1 Hz summary that does not carry the engine's rules.
 */
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createEngine } from '../src/sim/engine';
import { analyseProfile, buildDebrief, scoreBreakdown } from '../src/ui/debrief';
import { ascendAt, drive, holdDepth } from './helpers';

const MIN = 60;

/**
 * Two half-stops split by a return to depth. The engine refuses this (the stop
 * must be three *continuous* minutes immediately before surfacing) — see
 * "does not credit two half-stops split by a return to depth" in engine.test.ts.
 */
function splitStopDive() {
  const e = createEngine();
  drive(e, holdDepth(24), 6 * MIN);
  drive(e, ascendAt(8, 5), 160);
  drive(e, holdDepth(5), 95); // first half-stop
  drive(e, holdDepth(20), 4 * MIN); // back to depth: the clock restarts
  drive(e, ascendAt(8, 5), 160);
  drive(e, holdDepth(5), 95); // second half-stop
  return e;
}

describe('the debrief reports the dive rather than re-deciding it', () => {
  it('reports the per-species points the engine actually awarded', () => {
    const e = createEngine();
    drive(e, holdDepth(14), 15 * MIN);
    const d = buildDebrief(e.state);
    expect(d.awardedBySpecies).toEqual(e.state.awardedBySpecies);
    expect(Object.values(d.awardedBySpecies).reduce((a, b) => a + b, 0)).toBe(e.state.score);
  });

  it('keeps Infinity out of the profile and out of the report', () => {
    const e = createEngine();
    drive(e, holdDepth(6), 3 * MIN);
    const d = buildDebrief(e.state);
    // The sentinel must stay Infinity in the data (the renderer guards for it)
    // rather than being flattened to a fake large minute count.
    expect(d.profile.some((s) => s.ndlMin === Infinity)).toBe(true);
    expect(d.profile.every((s) => Number.isFinite(s.ndlMin) || s.ndlMin === Infinity)).toBe(true);
  });

  /**
   * ============================ CONFIRMED DEFECT ============================
   * `src/ui/debrief.ts`: `analyseProfile()` derives `safetyStopDone` by summing
   * every sample within 5 ± 1.5 m across the whole dive. The engine's rule is
   * narrower on two counts — it only credits time once `maxDepth > 10`, and it
   * resets the clock if you go back below 10 m — so the profile-derived flag is
   * strictly more generous than the engine's.
   *
   * `showDebrief()` then uses that flag for the "Safety stop" bonus row
   * (`const stopBonus = st.safetyStopDone ? CONFIG.bonus.safetyStop : 0`), for
   * the "The dive" column's Safety stop row, and `coachSuccess` ORs it into the
   * headline copy (`st.safetyStopDone || state.safetyStopDone`).
   *
   * Measured on the profile below: the engine credits 150 s and pays no bonus,
   * while the profile credits 288 s and the debrief tells the player
   * "You made the safety stop." and shows "Safety stop +50".
   *
   * Fix: carry `safetyStopDone` (and `safetyStopSec`) on `Debrief`, sourced from
   * `state`, and have `showDebrief` use that. `analyseProfile`'s own figure is
   * fine for drawing the graph; it must not be an authority on the bonus.
   * =========================================================================
   */
  /**
   * The profile cannot be used to re-derive the stop: the engine requires the time
   * to be continuous and to come after the dive proper, neither of which survives
   * into a list of depth samples. `analyseProfile`'s figure is therefore for
   * drawing the graph only, and everything the player reads comes from the
   * engine's verdict on `Debrief`. This test pins that split, because collapsing
   * it back together is exactly how the bug returns.
   */
  it('reports the engine verdict, not one re-derived from the profile', () => {
    const e = splitStopDive();
    expect(e.state.safetyStopDone).toBe(false); // the engine refused it
    // The profile-derived figure disagrees, by design — it cannot see continuity.
    expect(analyseProfile(e.state.profile).safetyStopDone).toBe(true);
    // What the player is shown follows the engine.
    expect(buildDebrief(e.state).safetyStopDone).toBe(false);
    expect(scoreBreakdown(buildDebrief(e.state)).stopBonus).toBe(0);
  });

  /** The same defect, seen from the copy the player reads. */
  it('does not claim a safety stop the engine refused to credit', () => {
    const e = splitStopDive();
    drive(e, ascendAt(8, -1), 4 * MIN);
    expect(e.state.endReason).toBe('surfaced');
    expect(e.state.safetyStopDone).toBe(false);
    // The engine paid no stop bonus. (Checked directly: spare-gas points alone can
    // exceed any fixed threshold, so comparing totals is not a valid proxy.)
    expect(buildDebrief(e.state).safetyStopDone).toBe(false);
    // ...so the debrief must not say it did.
    expect(buildDebrief(e.state).what).not.toContain('You made the safety stop');
  });

  /**
   * The same defect at its worst: on a FAILED dive nothing is banked, so
   * `bonusPoints` is 0 — but the profile-derived flag still lights the
   * "Safety stop +50" row. The score column then shows a +50 line item that
   * exists nowhere in the total, on a dive that scored nothing.
   *
   * The profile here banks its 180 s in the 5 m band on the way DOWN, which the
   * engine never credits because `maxDepth` was still under 10 m.
   */
  it('shows no stop bonus on a dive that banked nothing', () => {
    const e = createEngine();
    drive(e, holdDepth(5), 200); // dawdle at 5 m before descending
    drive(e, () => 'descend', 10 * MIN);
    expect(e.state.endReason).toBe('depth-exceeded');
    expect(e.state.safetyStopSec).toBe(0); // the engine credited nothing at all

    const d = buildDebrief(e.state);
    expect(d.score).toBe(0);
    expect(d.bonusPoints).toBe(0);
    // The real breakdown the panel renders, not a re-implementation of it.
    const { stopBonus, gasBonus } = scoreBreakdown(d);
    expect(stopBonus).toBe(0);
    // LAW: the two bonus rows partition bonusPoints, so the column adds up.
    // Here they sum to 50 against a bonusPoints of 0.
    expect(stopBonus + gasBonus).toBe(d.bonusPoints);
  });
});

describe('profile analysis', () => {
  it('never reports a max depth shallower than the dive actually reached', () => {
    const e = createEngine();
    drive(e, holdDepth(31), 8 * MIN);
    drive(e, ascendAt(8, 5), 8 * MIN);
    const d = buildDebrief(e.state);
    expect(d.maxDepth).toBeGreaterThanOrEqual(e.state.maxDepth - 1e-9);
  });

  it('survives a dive with no profile at all', () => {
    const e = createEngine();
    e.state.profile = [];
    e.state.endReason = 'surfaced';
    const d = buildDebrief(e.state);
    expect(d.score).toBe(0);
    expect(d.title).toBeTruthy();
    expect(d.advice).toBeTruthy();
  });
});
