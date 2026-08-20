/**
 * The single definition of "the score".
 *
 * It lives here because it was previously computed in three places — the HUD, the
 * debrief headline and the debrief breakdown — which drifted apart twice: once when
 * repeat-sighting decay was added, and again when the fast-ascent penalty was.
 * Anything that shows the player a number must come through this module.
 */
import { CONFIG } from '../config';
import type { DiveState } from '../types';

/**
 * Rewards breadth over volume. Logging ten species is worth far more than logging
 * one species ten times, which is what stops a diver farming sardines in the
 * shallows from out-scoring someone who went looking for the rare animals.
 */
export function diversityMultiplier(distinctSpecies: number): number {
  const extra = Math.max(0, distinctSpecies - 1);
  return Math.min(CONFIG.diversity.max, 1 + CONFIG.diversity.perExtraSpecies * extra);
}

/** Fish points after the diversity multiplier. */
export function scaledFishPoints(state: DiveState): number {
  return Math.round(state.score * diversityMultiplier(state.observed.size));
}

/** What the dive is worth in the water, before it is banked. */
export function netScore(state: DiveState): number {
  return scaledFishPoints(state) + state.bonusPoints - Math.round(state.ascentPenalty);
}

/**
 * What the player actually keeps. You bank only the dive you come back from: a
 * dive that ends out of air, bent, or past the depth limit scores nothing, however
 * much you saw on the way. Points are the reward for a dive that worked, not for
 * time spent underwater.
 */
export function bankedScore(state: DiveState): number {
  return state.endReason && state.endReason !== 'surfaced' ? 0 : netScore(state);
}
