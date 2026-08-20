/**
 * world/render.ts — the parts that are pure enough to test in node.
 *
 * `drawDiverSprite` was extracted so the onboarding wizard can show the same
 * diver the player will control, rather than a lookalike that drifts. That makes
 * it a shared drawing primitive with two callers and no owner, which is exactly
 * the shape that grows canvas-state bugs: an unbalanced save/restore or a leaked
 * transform in here corrupts the frame *after* it, so the symptom never points
 * at the cause.
 *
 * The fake context below records every call and property write. It is not a
 * canvas — it only has to be enough of one for the sprite to run.
 */
import { describe, expect, it } from 'vitest';
import { drawDiverSprite } from '../src/world/render';

interface Rec {
  calls: string[];
  depth: number;
  minDepth: number;
  sets: Record<string, unknown>;
}

function fakeCtx(): { ctx: CanvasRenderingContext2D; rec: Rec } {
  const rec: Rec = { calls: [], depth: 0, minDepth: 0, sets: {} };
  const noop = (name: string) => (...args: unknown[]) => {
    rec.calls.push(name);
    void args;
  };
  const target: Record<string, unknown> = {
    save: () => {
      rec.calls.push('save');
      rec.depth++;
    },
    restore: () => {
      rec.calls.push('restore');
      rec.depth--;
      rec.minDepth = Math.min(rec.minDepth, rec.depth);
    },
    createLinearGradient: () => {
      rec.calls.push('createLinearGradient');
      return { addColorStop: () => {} };
    },
    createRadialGradient: () => {
      rec.calls.push('createRadialGradient');
      return { addColorStop: () => {} };
    },
    measureText: () => ({ width: 10 }),
  };
  for (const m of [
    'translate', 'rotate', 'scale', 'setTransform', 'beginPath', 'closePath',
    'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arc', 'ellipse',
    'rect', 'roundRect', 'fill', 'stroke', 'clip', 'fillRect', 'strokeRect',
    'fillText', 'strokeText', 'setLineDash', 'arcTo', 'clearRect',
  ]) {
    target[m] = noop(m);
  }

  const ctx = new Proxy(target, {
    get: (t, p: string) => (p in t ? t[p] : rec.sets[p]),
    set: (_t, p: string, v) => {
      rec.sets[p] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;

  return { ctx, rec };
}

describe('drawDiverSprite', () => {
  /**
   * LAW: save/restore is balanced and never dips below the depth it was called
   * at. An extra restore() pops the *caller's* state — in the renderer that means
   * the diver silently undoes the scene transform for everything drawn after it.
   */
  it('leaves the save/restore stack exactly where it found it', () => {
    for (const t of [0, 0.37, 1.1, 12.5, 1e5]) {
      const { ctx, rec } = fakeCtx();
      drawDiverSprite(ctx, t);
      expect(rec.depth, `unbalanced at t=${t}`).toBe(0);
      expect(rec.minDepth, `over-restored at t=${t}`).toBe(0);
    }
  });

  /**
   * LAW: the sprite positions itself at the origin and leaves the transform to
   * the caller ("the caller owns the translate/rotate"). Every translate/rotate
   * it does for its own limbs must be inside a save/restore, so the net transform
   * change across the call is zero.
   */
  it('does not move the caller transform', () => {
    const { ctx, rec } = fakeCtx();
    drawDiverSprite(ctx, 2.2);
    // Walk the call log: any transform call must be inside an open save block.
    let depth = 0;
    for (const c of rec.calls) {
      if (c === 'save') depth++;
      else if (c === 'restore') depth--;
      else if (c === 'translate' || c === 'rotate' || c === 'scale' || c === 'setTransform') {
        expect(depth, `${c} outside a save block`).toBeGreaterThan(0);
      }
    }
    expect(depth).toBe(0);
  });

  /** It must actually draw something at every phase of the fin kick. */
  it('draws at every phase of the kick cycle', () => {
    for (let t = 0; t < 2; t += 0.25) {
      const { ctx, rec } = fakeCtx();
      drawDiverSprite(ctx, t);
      expect(rec.calls.filter((c) => c === 'fill' || c === 'stroke').length).toBeGreaterThan(5);
    }
  });

  /**
   * The animation clock is real seconds and is never reset, so it grows without
   * bound over a long session. Nothing in the sprite may depend on it staying
   * small (e.g. an index derived from t).
   */
  it('is stable at a large animation clock', () => {
    const { ctx, rec } = fakeCtx();
    expect(() => drawDiverSprite(ctx, 86_400)).not.toThrow();
    expect(rec.calls.length).toBeGreaterThan(10);
    for (const v of Object.values(rec.sets)) {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
    }
  });
});
