/**
 * sim/engine.ts — the integration layer.
 *
 * These are the tests with the most leverage: everything below is driven through
 * `createEngine().step(dt, input)` with scripted input, exactly the way main.ts
 * drives it, so they exercise the real interaction between kinematics, gas,
 * tissues, the rate police, the safety stop and the end-of-dive transitions.
 *
 * Where a number came out of the model rather than out of physics it is marked
 * SNAPSHOT.
 */
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createEngine } from '../src/sim/engine';
import { rawCeiling } from '../src/sim/buhlmann';
import type { Fish, Species, VerticalInput } from '../src/types';
import { MAX_STEP, ascendAt, drive, driveUntil, holdDepth, runRealSeconds } from './helpers';

const MIN = 60;

// ---------------------------------------------------------------- happy path

describe('a disciplined dive', () => {
  it('descends to 24 m, ascends slowly, completes the stop and surfaces cleanly', () => {
    const e = createEngine();

    // Down to 24 m and hold for ~11 min of bottom time. NDL at 24 m is ~28 min,
    // so this is comfortably inside the no-stop limit.
    drive(e, holdDepth(24), 12 * MIN);
    expect(e.state.endReason).toBeUndefined();
    expect(e.state.depth).toBeCloseTo(24, 0);
    expect(e.state.ceiling).toBe(0);
    expect(e.state.ndlMin).toBeGreaterThan(0);
    expect(e.state.inDeco).toBe(false);

    // Up at 8 m/min (under the 9 m/min limit) to the 5 m stop.
    drive(e, ascendAt(8, 5), 8 * MIN);
    expect(e.state.endReason).toBeUndefined();
    expect(e.state.ascentStrike).toBe(0);

    // Hang the full 3 minutes.
    drive(e, holdDepth(5), 4 * MIN);
    expect(e.state.safetyStopDone).toBe(true);

    const ended = drive(e, ascendAt(8, -1), 4 * MIN);
    expect(ended).toBe(true);
    expect(e.state.endReason).toBe('surfaced');
    expect(e.state.phase).toBe('ended');
    expect(e.state.ceiling).toBe(0);
    expect(e.state.tankBar).toBeGreaterThan(CONFIG.tank.reserveBar);
  });

  it('pays the safety-stop and spare-gas bonuses on a clean surfacing', () => {
    const e = createEngine();
    drive(e, holdDepth(24), 12 * MIN);
    drive(e, ascendAt(8, 5), 8 * MIN);
    drive(e, holdDepth(5), 4 * MIN);
    const spare = Math.max(0, e.state.tankBar - CONFIG.tank.reserveBar);
    drive(e, ascendAt(8, -1), 4 * MIN);

    expect(e.state.endReason).toBe('surfaced');
    // Bonuses land in their own bucket, not in `score`, so the diversity
    // multiplier applied to fish points cannot inflate them.
    expect(e.state.bonusPoints).toBeGreaterThanOrEqual(
      CONFIG.bonus.safetyStop + Math.round(spare * CONFIG.bonus.gasPerBar) - 2,
    );
  });

  it('records a dive profile roughly once per dive-second', () => {
    const e = createEngine();
    drive(e, holdDepth(12), 5 * MIN);
    // One sample per dive-second, plus a final one at end() if the dive ended.
    expect(e.state.profile.length).toBeGreaterThanOrEqual(5 * MIN - 1);
    expect(e.state.profile.length).toBeLessThanOrEqual(5 * MIN + 2);
    // Samples must be ordered in time and carry the real depth.
    for (let i = 1; i < e.state.profile.length; i++) {
      expect(e.state.profile[i].t).toBeGreaterThan(e.state.profile[i - 1].t);
    }
    // Sampling is once per dive-second, so the graph can miss the true peak by
    // a fraction of a metre, but it must never *exceed* it.
    const peakInGraph = Math.max(...e.state.profile.map((p) => p.depth));
    expect(peakInGraph).toBeLessThanOrEqual(e.state.maxDepth + 1e-9);
    expect(peakInGraph).toBeGreaterThan(e.state.maxDepth - 0.5);
  });
});

// ---------------------------------------------------------------- ascent rate

describe('ascent-rate policing', () => {
  it('ends the dive when you bolt for the surface from 30 m', () => {
    const e = createEngine();
    drive(e, holdDepth(30), 5 * MIN);
    expect(e.state.endReason).toBeUndefined();

    const ended = drive(e, () => 'ascend', 5 * MIN);
    expect(ended).toBe(true);
    expect(e.state.endReason).toBe('ascent-too-fast');
    // SNAPSHOT: the bust happens well before the surface, so the player sees it
    // as a consequence of the ascent rather than as a surprise at the end.
    expect(e.state.depth).toBeGreaterThan(5);
  });

  it('does not punish a slow ascent from the same depth', () => {
    const e = createEngine();
    drive(e, holdDepth(30), 5 * MIN);
    const ended = drive(e, ascendAt(8, -1), 10 * MIN);

    expect(ended).toBe(true);
    expect(e.state.endReason).toBe('surfaced');
    expect(e.state.ascentStrike).toBe(0);
    expect(e.state.maxDepth).toBeGreaterThan(29);
  });

  it('lets a brief overshoot drain away instead of ending the dive', () => {
    // The design intent recorded in config.ts: "long enough that a brief
    // overshoot is a scare you can correct".
    const e = createEngine();
    drive(e, holdDepth(30), 3 * MIN);
    drive(e, () => 'ascend', 8); // 8 dive-seconds of unrestrained ascent
    const strikeAfterOvershoot = e.state.ascentStrike;
    expect(strikeAfterOvershoot).toBeGreaterThan(0);
    expect(e.state.endReason).toBeUndefined();

    drive(e, holdDepth(e.state.depth), 60);
    expect(e.state.ascentStrike).toBe(0);
    expect(e.state.endReason).toBeUndefined();
  });

  it('fills the strike meter faster the harder you overshoot', () => {
    // LAW of the implementation: fill scales with overshoot ratio, so 20 m/min
    // is punished far faster than 10 m/min.
    const strikeAfter = (ascentRate: number) => {
      const e = createEngine();
      drive(e, holdDepth(30), 2 * MIN);
      drive(e, ascendAt(ascentRate, -1), 30);
      return e.state.ascentStrike;
    };
    expect(strikeAfter(18)).toBeGreaterThan(strikeAfter(10) * 1.5);
  });
});

// ---------------------------------------------------------------- deco

describe('overstaying the no-stop limit', () => {
  it('grows a ceiling instead of ending the dive on the spot', () => {
    // PLAN.md: "Exceeding NDL is not instant death — it flips you into deco".
    const e = createEngine();
    drive(e, holdDepth(30), 22 * MIN);

    expect(e.state.endReason).toBeUndefined();
    expect(e.state.phase).toBe('diving');
    expect(e.state.inDeco).toBe(true);
    expect(e.state.ndlMin).toBe(0);
    expect(e.state.ceiling).toBeGreaterThan(0);
    expect(e.state.ceiling % 3).toBe(0);
    expect(e.state.loadPct).toBeGreaterThan(1);
    // Still has gas: the point is that the dive is recoverable at this moment.
    expect(e.state.tankBar).toBeGreaterThan(50);
  });

  it('bends the diver who surfaces through the ceiling', () => {
    const e = createEngine();
    drive(e, holdDepth(30), 22 * MIN);
    expect(e.state.ceiling).toBeGreaterThan(0);

    // A textbook-speed ascent — the rate is fine, the *obligation* is not.
    const ended = drive(e, ascendAt(8, -1), 10 * MIN);
    expect(ended).toBe(true);
    expect(e.state.endReason).toBe('dcs-ceiling');
    expect(e.state.ascentStrike).toBeLessThan(1); // not a rate bust
  });

  it('forgives a momentary dip above the ceiling that the diver corrects', () => {
    // engine.ts allows 8 dive-seconds above the ceiling before calling it a bend.
    const e = createEngine();
    drive(e, holdDepth(30), 22 * MIN);
    const ceiling = e.state.ceiling;
    expect(ceiling).toBeGreaterThan(0);

    // Come up to just below the ceiling at a legal rate, then settle there.
    driveUntil(e, ascendAt(8, ceiling + 1), (s) => s.depth <= ceiling + 1.2, 8 * MIN);
    drive(e, holdDepth(ceiling + 1), 1 * MIN);
    expect(e.state.endReason).toBeUndefined();

    // Poke a metre and a half above it for ~5 dive-seconds, then go back down.
    drive(e, holdDepth(ceiling - 1.5), 5);
    expect(e.state.endReason).toBeUndefined();
    drive(e, holdDepth(ceiling + 2), 3 * MIN);
    expect(e.state.endReason).toBeUndefined();
    expect(e.state.phase).toBe('diving');
  });

  it('polices the true ceiling, not the 3 m stop grid the HUD shows', () => {
    // engine.ts checks rawCeiling deliberately: snapping up to the displayed
    // grid would bend the diver for breaking a barrier three metres more
    // conservative than the model actually claims. So there is a legal band
    // between the raw ceiling and the displayed one.
    const e = createEngine();
    drive(e, holdDepth(30), 22 * MIN);
    const shown = e.state.ceiling;
    const raw = rawCeiling(e.state.tissues);
    expect(shown).toBeGreaterThan(raw); // 3 m grid, rounded up
    expect(shown - raw).toBeGreaterThan(0.7); // enough room to actually sit in

    // Sit between the two for far longer than the 8 dive-second violation fuse.
    driveUntil(e, ascendAt(8, raw + 0.3), (s) => s.depth <= raw + 0.5, 8 * MIN);
    drive(e, holdDepth(raw + 0.3), 2 * MIN);
    expect(e.state.depth).toBeLessThan(shown);
    expect(e.state.endReason).toBeUndefined();
  });

  it('clears the obligation if the diver waits it out at the ceiling', () => {
    // The teachable recovery: deco is a debt you can pay, not an instant loss.
    const e = createEngine();
    drive(e, holdDepth(30), 22 * MIN);
    expect(e.state.ceiling).toBeGreaterThan(0);

    driveUntil(e, ascendAt(8, 6), (s) => s.depth <= 6.2, 8 * MIN);
    drive(e, holdDepth(6), 12 * MIN);
    expect(e.state.endReason).toBeUndefined();
    expect(e.state.ceiling).toBe(0);
    expect(e.state.inDeco).toBe(false);
  });
});

// ---------------------------------------------------------------- gas

describe('gas', () => {
  it('drains the tank exactly twice as fast at 30 m as at 10 m', () => {
    // LAW: 4 bar ambient vs 2 bar. Same exertion (holding depth) in both runs,
    // so the ratio is pure gas density, nothing else. This is the whole
    // "gas planning scales with depth" lesson, measured end-to-end.
    const usedAt = (depth: number) => {
      const e = createEngine();
      drive(e, holdDepth(depth), 2 * MIN); // settle at depth first
      const start = e.state.tankBar;
      drive(e, holdDepth(depth), 10 * MIN);
      return start - e.state.tankBar;
    };
    expect(usedAt(30) / usedAt(10)).toBeCloseTo(2, 1);
  });

  it('ends the dive when the tank hits zero', () => {
    const e = createEngine();
    drive(e, holdDepth(18), 2 * MIN);
    // Fast-forward the gas rather than simulating 60 minutes of breathing.
    e.state.tankBar = 3;
    const ended = drive(e, holdDepth(18), 5 * MIN);

    expect(ended).toBe(true);
    expect(e.state.endReason).toBe('out-of-air');
    expect(e.state.tankBar).toBe(0);
  });

  it('reports a live consumption rate that tracks depth', () => {
    const e = createEngine();
    drive(e, holdDepth(30), 3 * MIN);
    // sacNowLpm = SAC x P_amb x exertion; holding at 30 m is 4 bar, exertion 1.
    expect(e.state.sacNowLpm).toBeCloseTo(CONFIG.sacLpm * 4 * CONFIG.exertion.hold, 0);
    expect(e.state.ambient).toBeCloseTo(4, 1);
  });
});

// ---------------------------------------------------------------- depth limit

describe('the hard depth limit', () => {
  it('ends the dive past the recreational bust depth', () => {
    const e = createEngine();
    const ended = drive(e, () => 'descend', 10 * MIN);
    expect(ended).toBe(true);
    expect(e.state.endReason).toBe('depth-exceeded');
    expect(e.state.maxDepth).toBeGreaterThan(CONFIG.hardMaxDepthM);
  });
});

// ---------------------------------------------------------------- t=0 guard

describe('the start of the dive', () => {
  it('does not end at t=0 just because the diver is at the surface', () => {
    // REGRESSION GUARD: this was a real bug. The surfacing check has to require
    // that the diver actually went down first, or the dive ends before the
    // player has touched a key.
    const e = createEngine();
    expect(e.step(MAX_STEP, 'hold')).toBe(false);
    expect(e.state.endReason).toBeUndefined();
    expect(e.state.phase).toBe('diving');

    // Two full minutes of floating around on the surface: still not an ending.
    const ended = drive(e, () => 'hold', 2 * MIN);
    expect(ended).toBe(false);
    expect(e.state.endReason).toBeUndefined();
  });

  it('does eventually release a diver who never descends at all', () => {
    // The other half of the same condition in engine.ts: without a time release,
    // a diver who never goes down has no exit and floats until the tank is dry.
    // SNAPSHOT: the release is at t > 180 dive-seconds.
    const e = createEngine();
    expect(drive(e, () => 'hold', 179)).toBe(false);
    const ended = drive(e, () => 'hold', 30);
    expect(ended).toBe(true);
    expect(e.state.endReason).toBe('surfaced');
    expect(e.state.maxDepth).toBeLessThan(3);
  });

  it('does end once the diver has actually been down and comes back up', () => {
    const e = createEngine();
    drive(e, holdDepth(8), 2 * MIN);
    expect(e.state.maxDepth).toBeGreaterThan(3);
    const ended = drive(e, ascendAt(8, -1), 5 * MIN);
    expect(ended).toBe(true);
    expect(e.state.endReason).toBe('surfaced');
  });

  it('refuses to step once the dive has ended', () => {
    const e = createEngine();
    drive(e, holdDepth(8), 2 * MIN);
    drive(e, ascendAt(8, -1), 5 * MIN);
    const frozen = { t: e.state.t, score: e.state.score, tank: e.state.tankBar };
    expect(e.step(MAX_STEP, 'descend')).toBe(false);
    expect(e.state.t).toBe(frozen.t);
    expect(e.state.score).toBe(frozen.score);
    expect(e.state.tankBar).toBe(frozen.tank);
  });
});

// ---------------------------------------------------------------- reset

describe('reset', () => {
  it('returns a genuinely fresh dive', () => {
    const e = createEngine();
    drive(e, holdDepth(20), 6 * MIN);
    expect(e.state.t).toBeGreaterThan(0);
    expect(e.state.profile.length).toBeGreaterThan(0);
    const loadedP0 = e.state.tissues.pN2[0];

    e.reset();
    const s = e.state;
    expect(s.phase).toBe('diving');
    expect(s.endReason).toBeUndefined();
    expect(s.t).toBe(0);
    expect(s.depth).toBe(0);
    expect(s.maxDepth).toBe(0);
    expect(s.verticalRate).toBe(0);
    expect(s.x).toBe(0);
    expect(s.score).toBe(0);
    expect(s.observed.size).toBe(0);
    expect(s.observedCounts).toEqual({});
    expect(s.fish).toEqual([]);
    expect(s.profile).toEqual([]);
    expect(s.tankBar).toBe(CONFIG.tank.startBar);
    expect(s.ascentStrike).toBe(0);
    expect(s.safetyStopSec).toBe(0);
    expect(s.safetyStopDone).toBe(false);
    expect(s.inDeco).toBe(false);
    expect(s.ceiling).toBe(0);
    expect(s.narcosis).toBe(0);
    // Tissues are re-equilibrated, not carried over from the previous dive.
    expect(s.tissues.pN2[0]).toBeLessThan(loadedP0);
    expect(new Set(s.tissues.pN2).size).toBe(1);
  });

  it('resets the engine-local accumulators, not just the shared state', () => {
    // The profile sampler keeps its own `nextSampleAt`. If reset() forgot it,
    // the second dive would silently record no profile for its first N seconds —
    // invisible in DiveState, visible in the debrief graph.
    const e = createEngine();
    drive(e, holdDepth(20), 6 * MIN);
    e.reset();
    drive(e, holdDepth(10), 10);
    expect(e.state.profile.length).toBeGreaterThanOrEqual(9);
    expect(e.state.profile[0].t).toBeLessThanOrEqual(1);
  });

  it('survives a reset after a fatal ending and can be dived again', () => {
    const e = createEngine();
    drive(e, () => 'descend', 10 * MIN);
    expect(e.state.endReason).toBe('depth-exceeded');

    e.reset();
    expect(e.step(MAX_STEP, 'descend')).toBe(false);
    drive(e, holdDepth(10), 2 * MIN);
    expect(e.state.endReason).toBeUndefined();
    expect(e.state.depth).toBeCloseTo(10, 0);
  });
});

// ---------------------------------------------------------------- scoring

describe('repeat-sighting score decay', () => {
  /** A synthetic species, so the test does not depend on the species table. */
  const testSpecies = (points: number): Species => ({
    id: 'test-species',
    name: 'Test Fish',
    emoji: '?',
    points,
    minDepth: 0,
    maxDepth: 40,
    rarity: 1,
    speed: 0,
    size: 20,
    blurb: '',
  });

  /**
   * Log the same species `n` times and return what each sighting paid.
   * Replacing state.fish each step means the only observable fish is ours —
   * spawned fish appear 60 m ahead and cannot be observed in the same step.
   */
  const awards = (species: Species, n: number): number[] => {
    const e = createEngine();
    drive(e, holdDepth(10), 1 * MIN);
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const fish: Fish = {
        id: 10_000 + i,
        species,
        x: e.state.x,
        depth: e.state.depth,
        phase: 0,
        observed: false,
      };
      e.state.fish = [fish];
      const before = e.state.score;
      e.step(MAX_STEP, 'hold');
      expect(fish.observed).toBe(true);
      out.push(e.state.score - before);
    }
    return out;
  };

  it('pays full value for the first sighting and less for each repeat', () => {
    const paid = awards(testSpecies(60), 8);
    expect(paid[0]).toBe(60);
    for (let i = 1; i < paid.length; i++) {
      expect(paid[i]).toBeLessThanOrEqual(paid[i - 1]);
    }
    expect(paid[4]).toBeLessThan(paid[0] / 5);
    // SNAPSHOT of repeatDecay 0.55 / repeatFloor 0.1: 60, 33, 18, 10, 6, 6, ...
    expect(paid.slice(0, 5)).toEqual([60, 33, 18, 10, 6]);
  });

  it('never awards a negative score', () => {
    // LAW: a sighting can be worthless, but it can never take points away.
    for (const points of [1, 3, 60]) {
      for (const p of awards(testSpecies(points), 12)) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(p)).toBe(true);
      }
    }
  });

  /**
  /**
   * A logged species always pays at least one point, so there is still something
   * to do during the three minutes of the safety stop.
   *
   * This is only safe because a diver who never leaves the shallows is surfaced
   * automatically after 180 dive-seconds — a 1-point floor otherwise cancels the
   * decay entirely for the 1-3 point species and surface-farming out-scores a real
   * dive. If that release is ever removed, this floor has to go with it.
   */
  it('never pays less than a point for a logged sighting', () => {
    const paid = awards(testSpecies(1), 8);
    expect(paid[0]).toBe(1);
    expect(Math.min(...paid)).toBe(1);
  });

  it('bottoms out at the repeat floor rather than decaying to nothing', () => {
    const paid = awards(testSpecies(60), 12);
    const tail = paid.slice(6);
    // SNAPSHOT: repeatFloor 0.1 x 60 points = 6.
    expect(new Set(tail)).toEqual(new Set([6]));
  });

  it('counts each species separately', () => {
    const e = createEngine();
    drive(e, holdDepth(10), 1 * MIN);
    const a = testSpecies(40);
    const b = { ...testSpecies(40), id: 'other-species' };
    const seeOne = (species: Species, id: number) => {
      e.state.fish = [
        { id, species, x: e.state.x, depth: e.state.depth, phase: 0, observed: false },
      ];
      const before = e.state.score;
      e.step(MAX_STEP, 'hold');
      return e.state.score - before;
    };
    // Real spawned fish may also have been logged during the descent, so count
    // the delta rather than the absolute size of the observed set.
    const speciesBefore = e.state.observed.size;
    expect(seeOne(a, 1)).toBe(40);
    expect(seeOne(a, 2)).toBeLessThan(40);
    expect(seeOne(b, 3)).toBe(40); // a different species is still worth full value
    expect(e.state.observed.size - speciesBefore).toBe(2);
    expect(e.state.observedCounts['test-species']).toBe(2);
    expect(e.state.observedCounts['other-species']).toBe(1);
  });
});

// ---------------------------------------------------------------- time compression

describe('time compression', () => {
  // Four real seconds of the three inputs a player actually has. Kept short so
  // that neither the 4x nor the 25x run ends mid-comparison — at 25x, four real
  // seconds is already 100 dive-seconds of diving.
  const script = (realT: number): VerticalInput =>
    realT < 2 ? 'descend' : realT < 3 ? 'hold' : 'ascend';

  const runAt = (tc: number, realSec = 4) => {
    const e = createEngine();
    e.setTimeCompression(tc);
    return runRealSeconds(e, tc, realSec, script);
  };

  it('gives identical control response in real time at 4x and 25x', () => {
    // THE invariant recorded in config.ts: control gains are authored per REAL
    // second and divided by the compression, so the diver is equally responsive
    // however fast the dive is being played. The vertical rate the player feels
    // at 2.5 s into the dive must not depend on a playtesting dial.
    const slow = runAt(4);
    const fast = runAt(25);
    expect(fast.length).toBe(slow.length);
    for (let i = 0; i < slow.length; i++) {
      expect(fast[i].rate).toBeCloseTo(slow[i].rate, 9);
    }
  });

  it('is unaffected by the order the compression is set in', () => {
    const a = runAt(10);
    const e = createEngine();
    e.setTimeCompression(10);
    e.setTimeCompression(10);
    const b = runRealSeconds(e, 10, 4, script);
    expect(b.map((s) => s.rate)).toEqual(a.map((s) => s.rate));
  });

  it('advances the dive clock and the depth in proportion to the compression', () => {
    // Consequence of the same design: rate-vs-real-time is invariant, so depth,
    // being its integral over DIVE time, scales exactly with the compression.
    const slow = runAt(4);
    const fast = runAt(25);
    const last = slow.length - 1;
    expect(fast[last].diveT / slow[last].diveT).toBeCloseTo(25 / 4, 6);
    // Depth is an Euler integral, so allow 3% rather than demanding equality.
    expect(Math.abs(fast[last].depth / slow[last].depth / (25 / 4) - 1)).toBeLessThan(0.03);
  });

  it('clamps a nonsensical compression instead of dividing by zero', () => {
    const e = createEngine();
    e.setTimeCompression(0);
    e.step(MAX_STEP, 'descend');
    expect(Number.isFinite(e.state.verticalRate)).toBe(true);
    expect(Number.isFinite(e.state.depth)).toBe(true);
  });

  /**
   * KNOWN DIVERGENCE — see the final report.
   *
   * `verticalAccelPerRealSec / timeCompression` keeps the *feel* constant, but it
   * makes the acceleration per DIVE-second depend on the compression. The diver
   * therefore takes a different number of dive-seconds to reach a given depth
   * depending on a playtesting dial: ~85 dive-seconds to reach 30 m at 4x versus
   * ~102 at 25x. Those extra ~17 dive-seconds at depth are real nitrogen and real
   * gas, so the simulated dive is not the same dive at different compressions.
   *
   * This is arguably an inherent tension rather than a defect (you cannot have
   * both real-time feel and compression-invariant physics with a pure
   * acceleration model), but the simulation should not depend on a display
   * setting, so it is recorded here as `it.fails` — a tripwire that will flip to
   * a normal pass if anyone ever reconciles the two.
   */
  it.fails('costs the same dive time to reach 30 m at any compression', () => {
    const diveSecondsTo30m = (tc: number) => {
      const e = createEngine();
      e.setTimeCompression(tc);
      const samples = runRealSeconds(e, tc, 120, () => 'descend');
      const hit = samples.find((s) => s.depth >= 30);
      expect(hit).toBeDefined();
      return hit!.diveT;
    };
    expect(diveSecondsTo30m(25)).toBeCloseTo(diveSecondsTo30m(4), 0);
  });
});

// ---------------------------------------------------------------- safety stop

describe('the safety stop', () => {
  it('needs the full configured duration inside the depth window', () => {
    const e = createEngine();
    drive(e, holdDepth(18), 5 * MIN);
    // Stop the ascent just *outside* the band, so the clock below is the only
    // time being credited. (A handful of seconds is banked crossing the band on
    // the way down — see the it.fails below.)
    driveUntil(e, ascendAt(8, 5), (s) => s.depth <= 6.8, 5 * MIN);

    drive(e, holdDepth(5), CONFIG.safetyStop.durationSec - 40);
    expect(e.state.safetyStopDone).toBe(false);
    drive(e, holdDepth(5), 60);
    expect(e.state.safetyStopDone).toBe(true);
    expect(e.state.safetyStopSec).toBe(CONFIG.safetyStop.durationSec);
  });

  it('does not credit a stop held outside the tolerance band', () => {
    const e = createEngine();
    drive(e, holdDepth(18), 5 * MIN);
    const before = e.state.safetyStopSec;
    drive(e, holdDepth(12), 5 * MIN); // 12 m is well outside 5 +/- 1.5 m
    expect(e.state.safetyStopSec).toBe(before);
    expect(e.state.safetyStopDone).toBe(false);
  });

  /**
   * A safety stop is three *continuous* minutes immediately before surfacing,
   * not three minutes banked across the dive, so returning to depth restarts
   * the clock. Note the ascent legs are kept short here: `ascendAt` holds at its
   * target once it arrives, so a long ascent leg would itself bank a legitimate
   * continuous stop and the split would never be tested.
   */
  it('does not credit two half-stops split by a return to depth', () => {
    const e = createEngine();
    drive(e, holdDepth(24), 6 * MIN);
    drive(e, ascendAt(8, 5), 160); // just enough to arrive at 5 m
    drive(e, holdDepth(5), 95); // first half-stop
    expect(e.state.safetyStopDone).toBe(false);
    drive(e, holdDepth(20), 4 * MIN); // back down to depth
    expect(e.state.safetyStopSec).toBe(0); // the clock restarted
    drive(e, ascendAt(8, 5), 160);
    drive(e, holdDepth(5), 95); // second half-stop
    expect(e.state.safetyStopDone).toBe(false);
  });
});
