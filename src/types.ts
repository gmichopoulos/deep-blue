/**
 * SHARED CONTRACT — every module depends on this file.
 * Do not change existing field names/semantics without flagging it; other
 * modules are being written in parallel against these types.
 */

// ---------------------------------------------------------------- units

/** All depths in metres of sea water (msw). All pressures in bar absolute.
 *  All *dive* durations in dive-seconds (game clock), not real seconds. */
export type Depth = number;
export type Bar = number;
export type DiveSeconds = number;

// ---------------------------------------------------------------- species / fish

export interface Species {
  id: string;
  name: string;
  /** Placeholder glyph. Phase 2 replaces rendering with vector art keyed by id. */
  emoji: string;
  /** Points awarded on observation. Deeper == rarer == more. */
  points: number;
  /** Depth band this species inhabits (msw). */
  minDepth: Depth;
  maxDepth: Depth;
  /** 0..1 relative spawn weight within its band. */
  rarity: number;
  /** Horizontal drift speed, world-units/dive-second (negative = swims toward diver). */
  speed: number;
  /** Render size in world units (~pixels at 1:1 zoom). */
  size: number;
  /** One-line fact shown in the logbook / on first observation. */
  blurb: string;
}

export interface Fish {
  id: number;
  species: Species;
  /** World X (metres along the reef). Diver X increases over time. */
  x: number;
  /** Depth in msw. */
  depth: Depth;
  /** Vertical bob phase. */
  phase: number;
  observed: boolean;
  /** Set when observed, used for the floating "+N" popup. */
  observedAt?: DiveSeconds;
  /** Points actually awarded, after repeat-sighting decay. */
  awardedPoints?: number;
}

// ---------------------------------------------------------------- simulation state

export type GamePhase = 'wizard' | 'briefing' | 'diving' | 'ended';

export type EndReason =
  | 'surfaced'          // success
  | 'out-of-air'
  | 'ascent-too-fast'
  | 'dcs-ceiling'       // ascended above the decompression ceiling
  | 'depth-exceeded';   // blew past the recreational depth limit

export type VerticalInput = 'ascend' | 'descend' | 'hold';

/** One sample of the dive profile, recorded ~1/dive-second for the debrief graph. */
export interface ProfileSample {
  t: DiveSeconds;
  depth: Depth;
  ceiling: Depth;
  tankBar: Bar;
  /** Infinity when no-stop time is unlimited — do not substitute a sentinel. */
  ndlMin: number;
  loadPct: number;
}

export interface TissueState {
  /** Nitrogen partial pressure loaded in each Bühlmann compartment (bar). */
  pN2: number[];
}

export interface DiveState {
  phase: GamePhase;

  /** Elapsed dive time. */
  t: DiveSeconds;
  /** Diver depth, msw. 0 = surface. */
  depth: Depth;
  /** Positive = descending, m/min. */
  verticalRate: number;
  /** World X position (metres travelled along the reef). */
  x: number;
  /** Deepest point reached this dive. */
  maxDepth: Depth;

  /** Ambient pressure at current depth, bar absolute. */
  ambient: Bar;

  // gas
  tankBar: Bar;
  /** Current consumption in surface-litres/min at this depth. */
  sacNowLpm: number;

  // tissues
  tissues: TissueState;
  /** Minutes of no-decompression time left at the current depth. Infinity if unlimited. */
  ndlMin: number;
  /** Shallowest depth the diver may currently ascend to (msw). 0 = clear to surface. */
  ceiling: Depth;
  /** 0..1+ — max tissue loading vs. surfacing M-value. >=1 means deco obligation. */
  loadPct: number;
  /** True while a decompression obligation exists. Momentary, not latching:
   *  it clears again if the ceiling clears. */
  inDeco: boolean;

  // ascent-rate policing
  /** 0..1 — fills while ascending faster than the limit, drains below it. Hits 1 => bust. */
  ascentStrike: number;
  /** Points docked for time spent above the ascent-rate limit, accrued live.
   *  Separate from `score` so the debrief can show it as its own line. */
  ascentPenalty: number;

  // safety stop
  /** Dive-seconds accumulated in the safety-stop window. */
  safetyStopSec: DiveSeconds;
  safetyStopDone: boolean;

  // narcosis (cosmetic + teaching)
  /** 0..1 visual narcosis intensity. */
  narcosis: number;

  // scoring
  /** Raw fish points, before the diversity multiplier. Never shown directly —
   *  everything the player sees comes from `sim/scoring.ts`. */
  score: number;
  /** End-of-dive bonuses (safety stop, spare gas). Zero until the dive ends. */
  bonusPoints: number;
  observed: Set<string>;
  observedCounts: Record<string, number>;
  /** Points actually awarded per species, after repeat-sighting decay. The
   *  debrief must report these, not `points x count`, or its breakdown will
   *  disagree with the score on screen. */
  awardedBySpecies: Record<string, number>;

  fish: Fish[];
  profile: ProfileSample[];

  endReason?: EndReason;
}

// ---------------------------------------------------------------- debrief

export interface Debrief {
  success: boolean;
  reason: EndReason;
  /** Big headline, e.g. "Out of air at 27 m". */
  title: string;
  /** What physically happened, 1–2 sentences, plain language. */
  what: string;
  /** The single most useful thing to do differently next time. */
  advice: string;
  /** Optional supporting numbers, e.g. "You breathed 3.7× surface rate at 27 m". */
  detail?: string;
  score: number;
  /** Raw fish points after repeat-sighting decay, before the diversity multiplier. */
  fishPoints: number;
  /** Breadth multiplier applied to `fishPoints`. */
  diversityMult: number;
  /** End-of-dive bonuses actually awarded. */
  bonusPoints: number;
  /** The engine's verdict on the safety stop. The profile cannot be used to
   *  re-derive this: the engine requires the time to be continuous and to come
   *  after the dive, and re-deriving it drifts from what was actually paid. */
  safetyStopDone: boolean;
  safetyStopSec: DiveSeconds;
  /** Points docked for ascending too fast. Positive number, already subtracted from `score`. */
  ascentPenalty: number;
  maxDepth: Depth;
  duration: DiveSeconds;
  profile: ProfileSample[];
  observedCounts: Record<string, number>;
  /** Points actually awarded per species. */
  awardedBySpecies: Record<string, number>;
}
