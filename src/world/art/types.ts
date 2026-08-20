/**
 * SHARED CONTRACT for procedural fish art. One drawing function per species,
 * registered by `Species.id`. Anything not registered falls back to its emoji.
 */
export interface FishArtArgs {
  ctx: CanvasRenderingContext2D;
  /**
   * Nominal size in pixels (`Species.size`). Treat it as the creature's LENGTH:
   * draw within roughly `size` wide by `size * 0.7` tall, centred on the origin.
   */
  size: number;
  /** Dive time in seconds — use for animation (fin beat, tentacle undulation). */
  t: number;
  /** Per-fish phase offset so a school never animates in lockstep. */
  phase: number;
  /**
   * 0 at the surface, 1 at the seabed. Deep water eats red first, so art drawn
   * for depth should desaturate warm hues as this rises. The renderer applies a
   * global tint of its own; use this only for per-species emphasis.
   */
  depthT: number;
}

export type FishArt = (a: FishArtArgs) => void;

/**
 * Convention: draw the creature facing +x (nose at +size/2, tail at −size/2).
 * The renderer mirrors the canvas for fish swimming the other way, so never
 * bake a direction in. Do not call save()/restore() imbalanced, and do not
 * touch globalAlpha or transforms outside your own save()/restore() pair.
 */
