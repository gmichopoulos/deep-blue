/**
 * Fish spawning / motion / culling.
 *
 * The spawner is deliberately *depth-aware*: it only considers species whose
 * band overlaps a window around the diver's current depth, so what you find is
 * a direct consequence of where you chose to be. That is the whole risk/reward
 * loop — the deep species are both worth more and genuinely infrequent.
 *
 * This module never scores and never decides what counts as "observed";
 * the engine owns that. It only mutates `state.fish`.
 */

import { CONFIG } from '../config';
import type { Depth, DiveState, Fish, Species } from '../types';
import { SPECIES } from './species';

/** Half-height of the depth window, in metres, that the diver can "find" fish in. */
const DEPTH_WINDOW_M = 12;
/** Never let the pond get unbounded, whatever the frame rate does. */
const MAX_FISH = 110;
/**
 * Total candidate weight at which a spawn attempt always succeeds. Below it,
 * attempts fail proportionally — so the deep water is genuinely *emptier*, not
 * merely stocked with different animals. Without this the spawner renormalises
 * and every attempt at 38 m produces a rare deep species, which would turn the
 * gamble into a guarantee.
 */
const FULL_DENSITY_WEIGHT = 1.6;
/** Small margin so fish are not born exactly on a band edge. */
const BAND_INSET_M = 0.4;

interface Candidate {
  species: Species;
  weight: number;
  lo: number;
  hi: number;
}

export function createSpawner(): {
  update(state: DiveState, dtDiveSec: number): void;
  reset(): void;
} {
  let nextId = 1;
  let timer = CONFIG.spawn.intervalSec * 0.35;

  // Scratch buffer, reused every attempt so spawning allocates nothing.
  const candidates: Candidate[] = [];

  function reset(): void {
    nextId = 1;
    timer = CONFIG.spawn.intervalSec * 0.35;
    candidates.length = 0;
  }

  /** Collect species whose band overlaps the diver's depth window. */
  function gather(depth: Depth): number {
    candidates.length = 0;
    let total = 0;

    const winLo = depth - DEPTH_WINDOW_M;
    const winHi = depth + DEPTH_WINDOW_M;

    for (const species of SPECIES) {
      const lo = Math.max(species.minDepth, winLo);
      const hi = Math.min(species.maxDepth, winHi);
      if (hi <= lo) continue;

      // Partial overlaps are less likely than a band you are sitting inside of.
      const bandSpan = Math.max(0.5, species.maxDepth - species.minDepth);
      const overlap = (hi - lo) / Math.min(bandSpan, DEPTH_WINDOW_M * 2);
      const weight = species.rarity * (0.35 + 0.65 * Math.min(1, overlap));
      if (weight <= 0) continue;

      candidates.push({ species, weight, lo, hi });
      total += weight;
    }
    return total;
  }

  function spawnOne(state: DiveState, c: Candidate, xJitter: number): void {
    const lo = c.lo;
    const hi = c.hi;
    const inset = Math.min(BAND_INSET_M, (hi - lo) * 0.25);
    const depth = lo + inset + Math.random() * Math.max(0.01, hi - lo - inset * 2);

    const fish: Fish = {
      id: nextId++,
      species: c.species,
      x: state.x + CONFIG.spawn.aheadM + xJitter,
      // Keep them out of the chop right at the surface and out of the seabed.
      depth: Math.min(CONFIG.seabedM - 0.8, Math.max(0.4, depth)),
      phase: Math.random() * Math.PI * 2,
      observed: false,
    };
    state.fish.push(fish);
  }

  function update(state: DiveState, dtDiveSec: number): void {
    const dt = Math.max(0, Math.min(0.5, dtDiveSec));

    // ---- move + bob + cull ------------------------------------------------
    const cullBehind = state.x - CONFIG.spawn.behindM;
    const cullAhead = state.x + CONFIG.spawn.aheadM * 2.5;
    const fish = state.fish;
    let write = 0;
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i];
      f.x += f.species.speed * dt;
      // `phase` is a FIXED per-fish offset, never advanced here. Animation runs on
      // the renderer's real-time clock; advancing this in dive-seconds made every
      // animation race at the time-compression factor.
      if (f.x > cullBehind && f.x < cullAhead) {
        fish[write++] = f;
      }
    }
    fish.length = write;

    // ---- spawn ------------------------------------------------------------
    timer -= dt;
    if (timer > 0) return;
    // Jittered interval so the reef never feels metronomic.
    timer = CONFIG.spawn.intervalSec * (0.55 + Math.random() * 0.95);

    if (fish.length >= MAX_FISH) return;

    const total = gather(state.depth);
    if (total <= 0 || candidates.length === 0) return;

    // Sparse water stays sparse.
    if (Math.random() > Math.min(1, total / FULL_DENSITY_WEIGHT)) return;

    let roll = Math.random() * total;
    let picked = candidates[candidates.length - 1];
    for (const c of candidates) {
      roll -= c.weight;
      if (roll <= 0) {
        picked = c;
        break;
      }
    }

    // Common little fish arrive in loose schools; rare deep animals arrive alone.
    const schooling = picked.species.rarity > 0.7 && picked.species.size <= 24;
    const count = schooling ? 2 + Math.floor(Math.random() * 4) : 1;
    for (let i = 0; i < count && fish.length < MAX_FISH; i++) {
      spawnOne(state, picked, (Math.random() - 0.5) * (schooling ? 9 : 3));
    }
  }

  return { update, reset };
}
