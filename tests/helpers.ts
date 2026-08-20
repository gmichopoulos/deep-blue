/**
 * Shared rig for driving the engine with scripted input.
 *
 * The engine only ever sees `step(dtDiveSec, input)`, so a "dive plan" here is
 * just a controller function that picks ascend/descend/hold from the current
 * state — the same three choices the player has.
 */
import type { Engine } from '../src/sim/engine';
import type { DiveState, VerticalInput } from '../src/types';

/** The largest sub-step main.ts ever hands the engine (its `maxStep`). */
export const MAX_STEP = 0.25;

export type Controller = (s: DiveState) => VerticalInput;

/**
 * Run the engine for at most `maxDiveSec` dive-seconds at a fixed step size.
 * Returns true if the dive ended during this leg.
 */
export function drive(
  engine: Engine,
  ctl: Controller,
  maxDiveSec: number,
  dt: number = MAX_STEP,
): boolean {
  const steps = Math.round(maxDiveSec / dt);
  for (let i = 0; i < steps; i++) {
    if (engine.step(dt, ctl(engine.state))) return true;
  }
  return false;
}

/**
 * Run until `done(state)` is true (or the dive ends, or the budget runs out).
 * Returns the reason it stopped, so a test can assert it got where it meant to.
 */
export function driveUntil(
  engine: Engine,
  ctl: Controller,
  done: (s: DiveState) => boolean,
  maxDiveSec: number,
  dt: number = MAX_STEP,
): 'done' | 'ended' | 'timeout' {
  const steps = Math.round(maxDiveSec / dt);
  for (let i = 0; i < steps; i++) {
    if (engine.step(dt, ctl(engine.state))) return 'ended';
    if (done(engine.state)) return 'done';
  }
  return 'timeout';
}

/** Swim to `target` metres and hold there. A ±0.15 m deadband keeps the
 *  bang-bang controller from oscillating hard enough to trip the rate police. */
export function holdDepth(target: number): Controller {
  return (s) => (s.depth < target - 0.15 ? 'descend' : s.depth > target + 0.15 ? 'ascend' : 'hold');
}

/**
 * A disciplined ascent: pulse "ascend" only while slower than `rateMpm`, so the
 * vertical rate sits just under the limit instead of running away. Levels off at
 * `stopAtM` (pass a negative depth to go all the way to the surface).
 */
export function ascendAt(rateMpm: number, stopAtM: number): Controller {
  return (s) =>
    s.depth <= stopAtM ? 'hold' : s.verticalRate > -rateMpm ? 'ascend' : 'hold';
}

/**
 * Replay main.ts's frame loop: `realSec` of wall-clock at 60 fps, each frame
 * expanded into dive-time sub-steps of at most MAX_STEP. Samples the state once
 * per rendered frame, i.e. once per unit of REAL time — which is the frame of
 * reference the control-feel invariant lives in.
 */
export function runRealSeconds(
  engine: Engine,
  timeCompression: number,
  realSec: number,
  input: (realT: number) => VerticalInput,
): Array<{ realT: number; diveT: number; depth: number; rate: number }> {
  const realDt = 1 / 60;
  const frames = Math.round(realSec * 60);
  const samples: Array<{ realT: number; diveT: number; depth: number; rate: number }> = [];
  for (let f = 0; f < frames; f++) {
    const held = input(f * realDt);
    let remaining = realDt * timeCompression;
    let ended = false;
    while (remaining > 0) {
      const dt = Math.min(MAX_STEP, remaining);
      remaining -= dt;
      if (engine.step(dt, held)) {
        ended = true;
        break;
      }
    }
    samples.push({
      realT: (f + 1) * realDt,
      diveT: engine.state.t,
      depth: engine.state.depth,
      rate: engine.state.verticalRate,
    });
    if (ended) break;
  }
  return samples;
}
