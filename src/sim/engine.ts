/**
 * The dive engine: one fixed-step simulation of a recreational scuba dive.
 *
 * Everything here works in DIVE seconds. main.ts is responsible for turning
 * real seconds into dive seconds via CONFIG.timeCompression.
 */
import { CONFIG } from '../config';
import type { DiveState, EndReason, VerticalInput, Fish } from '../types';
import { ambientPressure } from './pressure';
import { barPerSecond } from './gas';
import {
  rawCeiling,
  initialTissues,
  updateTissues,
  ceilingDepth,
  ndlMinutes,
  loadFraction,
} from './buhlmann';
import { createSpawner } from '../world/spawner';

export interface Engine {
  state: DiveState;
  /** Advance the simulation by `dtDiveSec` dive-seconds. Returns true if the dive just ended. */
  step(dtDiveSec: number, input: VerticalInput): boolean;
  reset(): void;
  /** Keeps control feel constant across time-compression settings. */
  setTimeCompression(tc: number): void;
  /** The reserve differs by training tradition; the UI owns that choice. */
  setReserveBar(bar: number): void;
}

function freshState(): DiveState {
  return {
    phase: 'diving',
    t: 0,
    depth: 0,
    verticalRate: 0,
    x: 0,
    maxDepth: 0,
    ambient: CONFIG.surfacePressureBar,
    tankBar: CONFIG.tank.startBar,
    sacNowLpm: CONFIG.sacLpm,
    tissues: initialTissues(),
    ndlMin: Infinity,
    ceiling: 0,
    loadPct: 0,
    inDeco: false,
    ascentStrike: 0,
    ascentPenalty: 0,
    safetyStopSec: 0,
    safetyStopDone: false,
    narcosis: 0,
    score: 0,
    bonusPoints: 0,
    observed: new Set<string>(),
    observedCounts: {},
    awardedBySpecies: {},
    fish: [],
    profile: [],
  };
}

export function createEngine(): Engine {
  let state = freshState();
  const spawner = createSpawner();

  // Engine-local accumulators (deliberately not part of the shared DiveState).
  let ceilingViolationSec = 0;
  let nextSampleAt = 0;
  /** Dive-seconds per real second. Control response is specified in real time. */
  let timeCompression = CONFIG.timeCompression as number;
  let reserveBar: number = CONFIG.tank.reserveBar;

  function end(reason: EndReason) {
    state.endReason = reason;
    state.phase = 'ended';
    if (reason === 'surfaced') {
      // Reward what a good diver actually protects: the reserve and the safety stop.
      // Kept separate from fish points so the diversity multiplier cannot inflate them.
      if (state.safetyStopDone) state.bonusPoints += CONFIG.bonus.safetyStop;
      if (state.tankBar >= reserveBar) state.bonusPoints += CONFIG.bonus.reserveIntact;
      const spare = Math.max(0, state.tankBar - reserveBar);
      state.bonusPoints += Math.round(spare * CONFIG.bonus.gasPerBar);
    }
    sample();
  }

  function sample() {
    state.profile.push({
      t: state.t,
      depth: state.depth,
      ceiling: state.ceiling,
      tankBar: state.tankBar,
      ndlMin: state.ndlMin, // Infinity stays Infinity; the debrief guards for it
      loadPct: state.loadPct,
    });
  }

  /** Vertical kinematics. Input is an acceleration, not a velocity, so holding
   *  "ascend" runs you past the 9 m/min limit — that is the whole point. */
  function moveDiver(dt: number, input: VerticalInput) {
    const d = CONFIG.diver;
    // Control gains are authored per real second, so dividing by the compression
    // keeps the diver equally responsive at 4x or 10x.
    const accel = (d.verticalAccelPerRealSec / timeCompression) * dt;
    if (input === 'descend') {
      state.verticalRate = Math.min(d.maxDescentRate, state.verticalRate + accel);
    } else if (input === 'ascend') {
      state.verticalRate = Math.max(-d.maxAscentRate, state.verticalRate - accel);
    } else {
      // Neutral buoyancy: bleed the rate back toward zero.
      const damp = Math.exp((-d.neutralDampingPerRealSec / timeCompression) * dt);
      state.verticalRate *= damp;
      if (Math.abs(state.verticalRate) < 0.05) state.verticalRate = 0;
    }
    // verticalRate is m/min; depth is metres.
    state.depth += (state.verticalRate / 60) * dt;
    if (state.depth < 0) {
      state.depth = 0;
      if (state.verticalRate < 0) state.verticalRate = 0;
    }
    if (state.depth > CONFIG.seabedM) {
      state.depth = CONFIG.seabedM;
      if (state.verticalRate > 0) state.verticalRate = 0;
    }
    state.maxDepth = Math.max(state.maxDepth, state.depth);
    state.x += d.forwardSpeedMps * dt;
  }

  function exertionFor(input: VerticalInput): number {
    return input === 'ascend'
      ? CONFIG.exertion.ascend
      : input === 'descend'
        ? CONFIG.exertion.descend
        : CONFIG.exertion.hold;
  }

  function observeFish() {
    const r = CONFIG.spawn.observeRadiusM;
    for (const f of state.fish as Fish[]) {
      if (f.observed) continue;
      const dx = f.x - state.x;
      // Depth counts double: you have to actually get to their depth, not just their reef.
      const dy = (f.depth - state.depth) * 2;
      if (dx * dx + dy * dy <= r * r) {
        f.observed = true;
        f.observedAt = state.t;
        const seen = state.observedCounts[f.species.id] ?? 0;
        // Diminishing returns on a species you have already logged: the fifth
        // sardine is not worth another trip, but a first nautilus is.
        const worth = Math.max(CONFIG.repeatFloor, Math.pow(CONFIG.repeatDecay, seen));
        // Always worth at least a point, so there is still something to do during
        // the three minutes of the safety stop. This is only safe because a diver
        // who never leaves the shallows is surfaced automatically after
        // 180 dive-seconds — without that release, a 1-point floor cancels the
        // decay for the cheap shallow species and surface-farming out-scores a
        // real dive. The two rules have to move together.
        const awarded =
          seen >= CONFIG.maxScoringSightings
            ? 0 // fully surveyed: logged, but no longer worth points
            : Math.max(1, Math.round(f.species.points * worth));
        f.awardedPoints = awarded;
        state.score += awarded;
        state.observed.add(f.species.id);
        state.observedCounts[f.species.id] = seen + 1;
        state.awardedBySpecies[f.species.id] =
          (state.awardedBySpecies[f.species.id] ?? 0) + awarded;
      }
    }
  }

  function step(dt: number, input: VerticalInput): boolean {
    if (state.phase !== 'diving') return false;

    moveDiver(dt, input);
    state.t += dt;
    state.ambient = ambientPressure(state.depth);

    // ---- gas
    const exertion = exertionFor(input);
    state.sacNowLpm = CONFIG.sacLpm * state.ambient * exertion;
    state.tankBar = Math.max(0, state.tankBar - barPerSecond(state.depth, exertion) * dt);

    // ---- tissues
    updateTissues(state.tissues, state.depth, dt);
    state.ceiling = ceilingDepth(state.tissues);
    state.ndlMin = ndlMinutes(state.tissues, state.depth);
    state.loadPct = loadFraction(state.tissues);
    state.inDeco = state.ceiling > 0;

    // ---- ascent-rate policing (verticalRate is negative while ascending)
    const ascentSpeed = Math.max(0, -state.verticalRate);
    if (ascentSpeed > CONFIG.maxAscentRateMpm && state.depth > 0.3) {
      // Overshoot scales the fill, so 25 m/min busts far faster than 10 m/min.
      const overshoot = ascentSpeed / CONFIG.maxAscentRateMpm;
      state.ascentStrike += (dt / CONFIG.ascentGraceSec) * overshoot;
      // Dock points live, so the score reacts while the player can still see the
      // gauge that caused it. Overshooting and correcting is survivable but not free.
      state.ascentPenalty += CONFIG.fastAscentPenaltyPerSec * overshoot * dt;
    } else {
      state.ascentStrike = Math.max(0, state.ascentStrike - CONFIG.ascentStrikeDrainPerSec * dt);
    }

    // ---- safety stop
    const ss = CONFIG.safetyStop;
    // Only on the way back up: this is a stop, not a depth you happened to pass
    // through. Matches the condition the HUD already uses to show the widget.
    if (state.maxDepth > 10 && Math.abs(state.depth - ss.depthM) <= ss.toleranceM) {
      state.safetyStopSec = Math.min(ss.durationSec, state.safetyStopSec + dt);
      if (state.safetyStopSec >= ss.durationSec) state.safetyStopDone = true;
    } else if (!state.safetyStopDone && state.depth > 10) {
      // Dropping back to depth restarts the clock. The stop has to be three
      // continuous minutes immediately before surfacing, not three minutes
      // banked across the dive; a little wobble around 5 m is tolerated because
      // holding depth exactly is not the skill being taught here.
      state.safetyStopSec = 0;
    }

    // ---- narcosis (cosmetic, but it teaches why 40 m is the line)
    const n = (state.depth - CONFIG.narcosisOnsetM) / (CONFIG.recLimitM - CONFIG.narcosisOnsetM);
    state.narcosis = Math.max(0, Math.min(1.2, n));

    // ---- world
    spawner.update(state, dt);
    observeFish();

    // ---- profile sampling, once per dive-second
    if (state.t >= nextSampleAt) {
      sample();
      nextSampleAt = state.t + 1;
    }

    // ---- failure and success checks
    if (state.tankBar <= 0) {
      end('out-of-air');
      return true;
    }
    if (state.ascentStrike >= 1) {
      end('ascent-too-fast');
      return true;
    }
    if (state.depth > CONFIG.hardMaxDepthM) {
      end('depth-exceeded');
      return true;
    }
    // Breaking the ceiling is only fatal if you stay above it — a brief overshoot
    // that you correct is a scare, not a bend.
    // Tested against the raw ceiling, not the 3 m stop grid the HUD displays:
    // snapping up to the grid would bend you for breaking a barrier three metres
    // more conservative than the model actually claims.
    const trueCeiling = rawCeiling(state.tissues);
    if (trueCeiling > 0 && state.depth < trueCeiling - 0.5) {
      ceilingViolationSec += dt;
      if (ceilingViolationSec > 8) {
        end('dcs-ceiling');
        return true;
      }
    } else {
      ceilingViolationSec = Math.max(0, ceilingViolationSec - dt * 0.5);
    }
    // Surfacing only counts once you have actually been down — otherwise the dive
    // ends half a second after it starts, before the player has touched a key.
    // The time release matters as much as the depth one: without it, a diver who
    // never descends has no exit condition and floats until the tank runs dry.
    if (state.depth <= 0.2 && (state.maxDepth > 3 || state.t > 180)) {
      end(state.ceiling > 0 ? 'dcs-ceiling' : 'surfaced');
      return true;
    }
    return false;
  }

  function reset() {
    state = freshState();
    engine.state = state;
    spawner.reset();
    ceilingViolationSec = 0;
    nextSampleAt = 0;
  }

  const engine: Engine = {
    state,
    step,
    reset,
    setTimeCompression(tc: number) {
      timeCompression = Math.max(0.1, tc);
    },
    setReserveBar(bar: number) {
      reserveBar = Math.max(0, bar);
    },
  };
  return engine;
}
