/**
 * All tunables live here. Nothing else should hard-code a magic number that a
 * playtester might want to change.
 */
export const CONFIG = {
  /** Dive-seconds elapsed per real second. 10 = a 30-min dive plays in 3 min. */
  timeCompression: 10,

  // ---- physics
  /** Surface pressure, bar. Kept at a clean 1.0 so "10 m = double" reads clearly. */
  surfacePressureBar: 1.0,
  /** Metres of sea water per bar of gauge pressure. */
  mswPerBar: 10.0,
  /** Fraction of nitrogen in air. */
  fN2: 0.79,
  /** Alveolar water-vapour pressure, bar (Bühlmann uses 0.0627). */
  waterVaporBar: 0.0627,

  // ---- decompression model (Bühlmann ZH-L16C, gradient factors)
  /** Currently unused — no depth-varying GF ramp. Kept for a future GF-low/high ascent. */
  gfLow: 1.0,
  /**
   * 1.0 = the raw ZH-L16C M-values. Deliberate: it puts our no-deco limits on top of the
   * published recreational tables (~59 min @ 18 m, ~16 @ 30 m, ~9 @ 40 m vs PADI's 56/20/9),
   * so a player who later sits a course recognises the numbers. A real computer on GF 85
   * would be ~35% more conservative — correct, but it shrinks 30 m to under 10 minutes and
   * leaves no room for the risk/reward decision the game is built around.
   */
  gfHigh: 1.0,

  // ---- gas
  tank: {
    /** Aluminium 80: 11.1 L internal volume. */
    volumeL: 11.1,
    startBar: 200,
    /**
     * "Rock bottom" reserve — HUD turns amber below this.
     *
     * The two training traditions genuinely teach different amounts, not the same
     * amount in different words: metric courses say "be back with 50 bar", US
     * courses say "be back with 500 psi", and 500 psi is only ~34 bar. We honour
     * whichever the player chose, so the number they see is the number they would
     * actually be taught. See `reserveBar()` in ui/units.ts.
     */
    reserveBar: 50,
    /** 500 psi, the imperial rule of thumb, expressed in bar for the sim. */
    reserveBarImperial: 34.5,
  },
  /** Surface air consumption of a relaxed recreational diver, L/min. */
  sacLpm: 16,
  /** Extra breathing from effort. */
  exertion: { hold: 1.0, descend: 1.15, ascend: 1.25 },

  // ---- ascent policing
  /** Recommended max ascent rate, m/min. */
  maxAscentRateMpm: 9,
  /** Dive-seconds of continuous over-speed ascent tolerated before the bust.
   *  Long enough that a brief overshoot is a scare you can correct, short enough
   *  that riding 20 m/min up from 30 m always ends the dive. */
  ascentGraceSec: 45,
  /** How fast the strike meter drains when back within limits (per dive-second). */
  ascentStrikeDrainPerSec: 0.05,

  // ---- safety stop
  safetyStop: { depthM: 5, toleranceM: 1.5, durationSec: 180 },


  // ---- limits & world
  /** Recreational limit; below this narcosis ramps and the HUD warns. */
  recLimitM: 40,
  /** Hard bust depth — below this the dive ends. */
  hardMaxDepthM: 45,
  /** Seabed depth used for rendering the terrain floor, and a hard physical floor —
   *  the diver cannot swim through the sand. Sits just below hardMaxDepthM so the
   *  bottom is visible as a temptation you are never allowed to reach. */
  seabedM: 46,
  narcosisOnsetM: 28,

  // ---- diver kinematics
  diver: {
    /**
     * Constant forward swim, metres of reef per dive-second. At the default 10x
     * compression this is also 10x metres of reef per REAL second, so it sets how
     * fast the scene scrolls — 1.2 read as a sprint. It does not affect how many
     * fish you meet (that is set by the spawn rate); a slower swim just means each
     * one is on screen longer, which matters when depth is your only control.
     */
    forwardSpeedMps: 0.7,
    /**
     * Vertical acceleration while a key is held, m/min per REAL second — the engine
     * divides by the time compression. Control response has to live in real time or
     * the game becomes unplayably twitchy the moment you raise the compression.
     * At 14, a brief tap gets you a controlled ~9 m/min; keep holding and you run
     * past the limit, which is exactly the mistake the game is about.
     */
    verticalAccelPerRealSec: 14,
    /** Terminal vertical speeds, m/min. */
    maxDescentRate: 22,
    maxAscentRate: 20,
    /** Passive return to neutral buoyancy when no key is held, per REAL second. */
    neutralDampingPerRealSec: 3,
  },

  // ---- spawning
  spawn: {
    /** Mean dive-seconds between spawn attempts. */
    intervalSec: 3.5,
    /** Metres ahead of the diver that fish appear. */
    aheadM: 60,
    /** Metres behind the diver at which fish are culled. */
    behindM: 30,
    /** Observation radius, metres (world units). */
    observeRadiusM: 6,
  },

  // ---- scoring
  /**
   * Repeat sightings of a species you have already logged are worth progressively
   * less. Without this, a long shallow dive out-scores a deep one purely on volume,
   * which inverts the lesson: the reason to go deep is the rare species, not the count.
   */
  repeatDecay: 0.55,
  repeatFloor: 0.1,
  /**
   * Sightings of one species that can score in a single dive. The 1-point floor
   * keeps the safety stop worth playing, but a floor with no ceiling means points
   * accrue with time alone — and a diver who farms the shallows and then surfaces
   * neatly with gas in hand out-scores a real dive. A normal dive tops out around
   * 50-60 sightings of the commonest species, so this never fires in real play; it
   * only ends the grind.
   */
  maxScoringSightings: 80,
  /**
   * Points docked per dive-second spent above the ascent-rate limit, scaled by how
   * far over you are. This is for the overshoots you *get away with*: drifting up at
   * 12 m/min for 15 seconds and correcting costs about 24 points off a ~350 point
   * dive — enough to notice, nowhere near the instant loss of filling the strike
   * meter. A rushed ascent should cost you even when it does not bend you.
   */
  fastAscentPenaltyPerSec: 1.2,
  /**
   * Breadth bonus. A dive that finds twelve different species is worth ~1.8x one
   * that finds the same species twelve times. This is the counterweight to the
   * 1-point floor on repeat sightings: the floor keeps the safety stop worth
   * playing, and this keeps grinding it from being a strategy.
   */
  diversity: { perExtraSpecies: 0.07, max: 1.9 },
  bonus: {
    safetyStop: 50,
    /** Flat award for surfacing with the reserve still intact — the rule divers
     *  are actually taught, rather than a sliding scale. */
    reserveIntact: 120,
    /** Points per bar of gas remaining above reserve on a clean surfacing. */
    gasPerBar: 2,
  },
} as const;

export type GameConfig = typeof CONFIG;
