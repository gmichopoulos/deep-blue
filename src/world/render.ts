/**
 * Canvas scene renderer.
 *
 * The single most important rule in this file: **vertical screen position IS
 * depth**. The whole water column (0 m at the top, CONFIG.seabedM just above the
 * bottom) is on screen at once and never scrolls vertically. Everything else —
 * the ruler, the Boyle bubble, the safety-stop band, the decompression ceiling —
 * hangs off that one mapping, which is what makes the physics legible.
 *
 * Self-contained: no assets, no libraries, no DOM beyond the canvas.
 */

import { CONFIG } from '../config';
import type { DiveState, Fish } from '../types';
import { ambientPressure, pressureMultiplier, relativeVolume } from '../sim/pressure';
import { FISH_ART } from './art';
import * as U from '../ui/units';

// ---------------------------------------------------------------- layout
/** Width of the depth/pressure ruler gutter, CSS px. */
const RULER_W = 96;
/** Space above the waterline (sky glow + wave). */
const TOP_PAD = 30;
/** Space below the seabed line. */
const BOTTOM_PAD = 54;
/** Diver's fixed horizontal position, fraction of canvas width. */
const DIVER_X_FRAC = 0.3;
/**
 * Metres of reef visible across the full canvas width. Chosen so the right edge
 * sits at ~55 m ahead (inside CONFIG.spawn.aheadM = 60, so fish never pop in on
 * screen) and the left edge at ~23 m behind (inside CONFIG.spawn.behindM = 30,
 * so nothing is culled while still visible).
 */
const WORLD_SPAN_M = 78;

const UI_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/** How long the "+N" observation popup lives, dive-seconds. */
const POPUP_SEC = 2.6;

// ---------------------------------------------------------------- tiny noise
function hash1(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}
function noise1(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash1(i) * (1 - u) + hash1(i + 1) * u;
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

interface Particle {
  fx: number; // 0..1 across the canvas
  fy: number; // 0..1 down the canvas
  r: number;
  par: number; // parallax factor
  tw: number; // twinkle phase
}

interface Bubble {
  wx: number; // world metres
  depth: number;
  birthDepth: number;
  r0: number;
  wob: number;
}

/**
 * The diver, drawn at the origin facing +x. Exported so the onboarding wizard can
 * show the same diver the player will actually control, rather than a lookalike
 * that drifts out of sync with it.
 *
 * `t` is a real-time seconds clock (drives the fin kick); the caller owns the
 * translate/rotate.
 */
/**
 * `roundRect` is missing in Safari before 16.4, and an unguarded call inside
 * `draw()` kills the whole scene every frame rather than one label.
 */
function roundRectSafe(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

export function drawDiverSprite(ctx: CanvasRenderingContext2D, t: number): void {
  const kick = Math.sin(t * 3.4);
  // Self-contained: the sprite sets lineCap, stroke and fill styles, so it owns a
  // save/restore rather than relying on every caller to wrap it.
  ctx.save();

    // --- fins / legs (behind the body)
    ctx.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const k = Math.sin(t * 3.4 + i * Math.PI) * 0.45;
      ctx.save();
      ctx.translate(-13, i === 0 ? -2.5 : 2.5);
      ctx.rotate(k * 0.5);
      ctx.strokeStyle = '#12293f';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-11, 2 * k);
      ctx.stroke();
      // fin blade
      ctx.translate(-11, 2 * k);
      ctx.rotate(k * 0.9);
      ctx.fillStyle = '#ffb03a';
      ctx.beginPath();
      ctx.moveTo(0, -3.5);
      ctx.lineTo(-15, -6);
      ctx.lineTo(-17, 0);
      ctx.lineTo(-15, 6);
      ctx.lineTo(0, 3.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // --- tank
    ctx.save();
    ctx.fillStyle = '#96a5b2';
    ctx.beginPath();
    roundRectSafe(ctx, -22, -12, 20, 12, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(-19, -11, 14, 2);
    ctx.fillStyle = '#5d6b78';
    ctx.fillRect(-8, -14, 4, 3);
    ctx.restore();

    // --- regulator hose
    ctx.strokeStyle = '#1b2a34';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-6, -12);
    ctx.quadraticCurveTo(10, -16, 20, -6);
    ctx.stroke();

    // --- body
    const bg = ctx.createLinearGradient(0, -10, 0, 10);
    bg.addColorStop(0, '#28527d');
    bg.addColorStop(1, '#0d2038');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.ellipse(0, 0, 20, 8.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(120,230,220,0.5)';
    ctx.fillRect(-8, -1.5, 16, 2);

    // --- arm reaching forward
    ctx.strokeStyle = '#1b3d5f';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(6, 1);
    ctx.quadraticCurveTo(15, 4 + kick, 23, 2 + kick * 1.5);
    ctx.stroke();

    // --- head + hood
    ctx.fillStyle = '#16304c';
    ctx.beginPath();
    ctx.arc(20, -4, 7.2, 0, Math.PI * 2);
    ctx.fill();
    // mask
    ctx.save();
    ctx.translate(23, -5);
    ctx.rotate(-0.12);
    const mg = ctx.createLinearGradient(-5, -3, 5, 3);
    mg.addColorStop(0, '#bff4ff');
    mg.addColorStop(1, '#4fb3c9');
    ctx.fillStyle = mg;
    ctx.beginPath();
    roundRectSafe(ctx, -4, -3.4, 10, 6.6, 2.4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(10,25,35,0.85)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
    // regulator in mouth
    ctx.fillStyle = '#22323d';
    ctx.beginPath();
    ctx.arc(22, 1.5, 2.6, 0, Math.PI * 2);
    ctx.fill();


  ctx.restore();
}

export function createRenderer(canvas: HTMLCanvasElement): {
  draw(state: DiveState): void;
  resize(): void;
} {
  const ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;

  let W = 960;
  let H = 600;
  let dpr = 1;
  let waterGrad: CanvasGradient | null = null;
  let skyGrad: CanvasGradient | null = null;

  const particles: Particle[] = [];
  for (let i = 0; i < 150; i++) {
    particles.push({
      fx: Math.random(),
      fy: Math.random(),
      r: 0.5 + Math.random() * 1.9,
      par: 0.25 + Math.random() * 0.95,
      tw: Math.random() * Math.PI * 2,
    });
  }

  const bubbles: Bubble[] = [];
  let bubbleTimer = 0;
  let lastT = 0;
  /**
   * Cosmetic animation runs on REAL seconds, never dive-seconds. At the default
   * 10x compression a tail beat authored at 1.3 Hz would otherwise run at 13 Hz,
   * which reads as jitter rather than swimming.
   */
  let animT = 0;
  let lastRealMs = 0;
  /** Real-time stamp of each fish's "+N" popup, since observedAt is in dive-seconds. */
  const popupStart = new Map<number, number>();

  // ------------------------------------------------------------ geometry
  const columnH = () => H - TOP_PAD - BOTTOM_PAD;
  const yFor = (depth: number) => TOP_PAD + (depth / CONFIG.seabedM) * columnH();
  const pxPerM = () => W / WORLD_SPAN_M;
  const diverX = () => W * DIVER_X_FRAC;
  const sxFor = (worldX: number, stateX: number) => diverX() + (worldX - stateX) * pxPerM();

  function seabedDepthAt(worldX: number): number {
    return (
      CONFIG.seabedM -
      (noise1(worldX * 0.045) * 2.6 + noise1(worldX * 0.14) * 0.9 + 0.25)
    );
  }

  // ------------------------------------------------------------ resize
  function buildGradients(): void {
    // Runs surface -> seabed (not surface -> canvas bottom), so the near-black
    // end of the ramp actually lands on the seabed where the player can see it.
    const g = ctx.createLinearGradient(0, TOP_PAD, 0, yFor(CONFIG.seabedM));
    g.addColorStop(0.0, '#8ef3e6');
    g.addColorStop(0.05, '#3fd0d2');
    g.addColorStop(0.16, '#12a3c4');
    g.addColorStop(0.33, '#0a72a2');
    g.addColorStop(0.53, '#064c7c');
    g.addColorStop(0.72, '#032d54');
    g.addColorStop(0.88, '#01172e');
    g.addColorStop(1.0, '#00060e');
    waterGrad = g;

    const s = ctx.createLinearGradient(0, 0, 0, TOP_PAD);
    s.addColorStop(0, '#d9f4fb');
    s.addColorStop(1, '#9fe9e0');
    skyGrad = s;
  }

  /** Last measured CSS size, before clamping — the resize guard compares against
   *  this, not the clamped values, or a sub-360px viewport re-resizes every frame. */
  let measuredW = 0;
  let measuredH = 0;

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    measuredW = Math.round(rect.width || canvas.clientWidth || 960);
    measuredH = Math.round(rect.height || canvas.clientHeight || 600);
    W = Math.max(360, measuredW);
    H = Math.max(280, measuredH);
    // Capped at 1.5: the scene is soft-edged gradients and vector shapes, so the
    // step from 1.5x to 2x is nearly invisible while costing 78% more pixels.
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    buildGradients();
    buildShaftGrad();
  }

  // ------------------------------------------------------------ layers
  function drawWater(): void {
    ctx.fillStyle = waterGrad ?? '#04395e';
    // Overscan: the narcosis sway shifts the scene by a few px, and an unpainted
    // sliver at the edge would be far more distracting than the effect itself.
    ctx.fillRect(-12, -12, W + 24, H + 24);
  }

  function drawSurface(t: number): void {
    ctx.fillStyle = skyGrad ?? '#cfeff5';
    ctx.fillRect(0, 0, W, TOP_PAD);

    // Waveline at depth 0.
    ctx.beginPath();
    ctx.moveTo(0, TOP_PAD);
    for (let x = 0; x <= W; x += 8) {
      const y =
        TOP_PAD +
        Math.sin(x * 0.035 + t * 1.1) * 2.4 +
        Math.sin(x * 0.011 - t * 0.7) * 1.8;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, TOP_PAD + 8);
    ctx.lineTo(0, TOP_PAD + 8);
    ctx.closePath();
    ctx.fillStyle = 'rgba(233,255,255,0.75)';
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const y = TOP_PAD + 10 + Math.sin(x * 0.03 - t * 0.9) * 1.6;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  /** Alpha the cached shaft gradient is authored at; runtime alpha scales against it. */
  const SHAFT_BASE_ALPHA = 0.14;
  let shaftGrad: CanvasGradient | null = null;

  function buildShaftGrad(): void {
    const bottom = TOP_PAD + columnH() * 0.55;
    const g = ctx.createLinearGradient(0, TOP_PAD, 0, bottom);
    g.addColorStop(0, `rgba(200,255,250,${SHAFT_BASE_ALPHA})`);
    g.addColorStop(0.55, `rgba(150,240,255,${SHAFT_BASE_ALPHA * 0.4})`);
    g.addColorStop(1, 'rgba(120,220,255,0)');
    shaftGrad = g;
  }

  function drawSunShafts(t: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bottom = TOP_PAD + columnH() * 0.55;
    for (let i = 0; i < 6; i++) {
      const drift = Math.sin(t * 0.11 + i * 1.7) * 46;
      const x = ((i + 0.5) / 6) * W + drift;
      const wTop = 20 + i * 6;
      const wBot = wTop * 3.4;
      const skew = 110 + i * 18;
      const a = 0.09 + 0.05 * (0.5 + 0.5 * Math.sin(t * 0.3 + i));
      ctx.fillStyle = shaftGrad ?? 'rgba(180,245,250,0.1)';
      ctx.globalAlpha = clamp(a / SHAFT_BASE_ALPHA, 0, 1);
      ctx.beginPath();
      ctx.moveTo(x - wTop / 2, TOP_PAD);
      ctx.lineTo(x + wTop / 2, TOP_PAD);
      ctx.lineTo(x + skew + wBot / 2, bottom);
      ctx.lineTo(x + skew - wBot / 2, bottom);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawParticles(dt: number, realDt: number, stateDepth: number): void {
    const shift = (CONFIG.diver.forwardSpeedMps * pxPerM() * dt) / W;
    ctx.save();
    for (const p of particles) {
      p.fx -= shift * p.par;
      if (p.fx < -0.02) {
        p.fx += 1.04;
        p.fy = Math.random();
      }
      p.tw += realDt * 0.6;
      const y = TOP_PAD + p.fy * columnH();
      const near = clamp(1 - Math.abs(y - yFor(stateDepth)) / (H * 0.6), 0.15, 1);
      const a = (0.1 + 0.2 * p.par) * near * (0.6 + 0.4 * Math.sin(p.tw));
      ctx.fillStyle = `rgba(226,248,255,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.fx * W, y, p.r * p.par, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function terrainPath(stateX: number, parallax: number, lift: number): void {
    const ppm = pxPerM();
    const dx = diverX();
    ctx.beginPath();
    ctx.moveTo(-10, H + 10);
    for (let sx = -10; sx <= W + 10; sx += 7) {
      const wx = stateX * parallax + (sx - dx) / ppm;
      ctx.lineTo(sx, yFor(seabedDepthAt(wx) - lift));
    }
    ctx.lineTo(W + 10, H + 10);
    ctx.closePath();
  }

  function drawFarTerrain(stateX: number): void {
    terrainPath(stateX, 0.5, 2.6);
    const g = ctx.createLinearGradient(0, yFor(CONFIG.seabedM - 6), 0, H);
    g.addColorStop(0, 'rgba(10,54,74,0.85)');
    g.addColorStop(1, 'rgba(2,14,26,0.95)');
    ctx.fillStyle = g;
    ctx.fill();
  }

  function drawCoral(stateX: number): void {
    const startK = Math.floor((stateX - 34) / 5.5);
    const endK = Math.ceil((stateX + WORLD_SPAN_M) / 5.5);
    ctx.save();
    for (let k = startK; k <= endK; k++) {
      const h = hash1(k * 3.7);
      if (h < 0.35) continue;
      const wx = k * 5.5 + hash1(k * 9.1) * 4;
      const sx = sxFor(wx, stateX);
      if (sx < -40 || sx > W + 40) continue;
      const base = yFor(seabedDepthAt(wx));
      const scale = 0.55 + hash1(k * 5.3) * 1.1;
      const tint = hash1(k * 11.7);
      ctx.strokeStyle = `rgba(${18 + tint * 40},${58 + tint * 30},${66 + tint * 24},0.9)`;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineCap = 'round';
      if (h > 0.72) {
        // sea fan
        ctx.lineWidth = 2 * scale;
        for (let b = -3; b <= 3; b++) {
          ctx.beginPath();
          ctx.moveTo(sx, base);
          ctx.quadraticCurveTo(
            sx + b * 3 * scale,
            base - 14 * scale,
            sx + b * 7 * scale,
            base - 26 * scale,
          );
          ctx.stroke();
        }
      } else if (h > 0.52) {
        // branching coral
        ctx.lineWidth = 3.4 * scale;
        ctx.beginPath();
        ctx.moveTo(sx, base);
        ctx.lineTo(sx, base - 14 * scale);
        ctx.moveTo(sx, base - 8 * scale);
        ctx.lineTo(sx - 9 * scale, base - 20 * scale);
        ctx.moveTo(sx, base - 9 * scale);
        ctx.lineTo(sx + 8 * scale, base - 22 * scale);
        ctx.stroke();
      } else {
        // brain coral / boulder
        ctx.beginPath();
        ctx.ellipse(sx, base - 3 * scale, 13 * scale, 8 * scale, 0, Math.PI, 0);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawNearTerrain(stateX: number): void {
    drawCoral(stateX);
    terrainPath(stateX, 1, 0);
    const g = ctx.createLinearGradient(0, yFor(CONFIG.seabedM - 4), 0, H);
    g.addColorStop(0, '#123c40');
    g.addColorStop(0.4, '#0a2431');
    g.addColorStop(1, '#02090f');
    ctx.fillStyle = g;
    ctx.fill();

    // Ridge highlight so the floor reads as a surface, not a silhouette.
    ctx.save();
    ctx.strokeStyle = 'rgba(120,220,215,0.22)';
    ctx.lineWidth = 1.5;
    const ppm = pxPerM();
    const dx = diverX();
    ctx.beginPath();
    for (let sx = -10; sx <= W + 10; sx += 7) {
      const wx = stateX + (sx - dx) / ppm;
      const y = yFor(seabedDepthAt(wx));
      if (sx <= -10) ctx.moveTo(sx, y);
      else ctx.lineTo(sx, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawSafetyBand(): void {
    const { depthM, toleranceM } = CONFIG.safetyStop;
    const y1 = yFor(depthM - toleranceM);
    const y2 = yFor(depthM + toleranceM);
    ctx.save();
    ctx.fillStyle = 'rgba(150,255,225,0.09)';
    ctx.fillRect(RULER_W, y1, W - RULER_W, y2 - y1);
    ctx.setLineDash([7, 6]);
    ctx.strokeStyle = 'rgba(168,255,232,0.42)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(RULER_W, y1);
    ctx.lineTo(W, y1);
    ctx.moveTo(RULER_W, y2);
    ctx.lineTo(W, y2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `600 11px ${UI_FONT}`;
    ctx.fillStyle = 'rgba(190,255,238,0.8)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('safety stop', W - 12, (y1 + y2) / 2);
    ctx.restore();
  }

  // ------------------------------------------------------------ fish
  function drawFish(state: DiveState, t: number): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of state.fish as Fish[]) {
      const sx = sxFor(f.x, state.x);
      if (sx < -70 || sx > W + 70) continue;
      // Bob on the real-time clock with the fish's own phase as a fixed offset.
      // Bigger animals swing slower.
      const bobRate = 2.2 - Math.min(1.6, f.species.size / 45);
      const sy = yFor(f.depth) + Math.sin(t * bobRate + f.phase) * 3.2;

      if (f.observed && !popupStart.has(f.id)) popupStart.set(f.id, t);
      const started = popupStart.get(f.id);
      // Guard the low side too: a stale entry from a previous dive whose id got
      // reused yields a large negative age, and `1 - age/0.5` then becomes a
      // shadowBlur in the thousands of pixels.
      const rawAge = started !== undefined ? t - started : Infinity;
      const age = rawAge >= 0 ? rawAge : Infinity;
      if (started !== undefined && rawAge > POPUP_SEC) popupStart.delete(f.id);

      ctx.save();
      ctx.translate(sx, sy);
      if (age < 0.5) {
        ctx.shadowColor = 'rgba(255,235,150,0.95)';
        ctx.shadowBlur = 26 * (1 - age / 0.5);
      }
      // Art is authored facing +x, so mirror anything swimming in -x. This was
      // inverted: it tested `speed > 0`, and since every species in the table has a
      // negative speed the branch never fired and the entire reef faced backwards.
      if (f.species.speed < 0) ctx.scale(-1, 1);
      // Procedural vector art where a species has it; emoji is the fallback.
      const art = FISH_ART[f.species.id];
      if (art) {
        art({
          ctx,
          size: f.species.size,
          t,
          phase: f.phase,
          depthT: clamp(f.depth / CONFIG.seabedM, 0, 1),
        });
      } else {
        ctx.font = `${f.species.size}px ${EMOJI_FONT}`;
        ctx.fillStyle = '#fff';
        ctx.fillText(f.species.emoji, 0, 0);
      }
      ctx.restore();

      const awarded = f.awardedPoints ?? f.species.points;
      if (age < POPUP_SEC) {
        const k = age / POPUP_SEC;
        const alpha = k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88;
        const rise = 6 + age * 26;
        ctx.save();
        ctx.globalAlpha = clamp(alpha, 0, 1);
        ctx.font = `800 16px ${UI_FONT}`;
        ctx.fillStyle = '#ffe27a';
        ctx.shadowColor = 'rgba(0,0,0,0.7)';
        ctx.shadowBlur = 5;
        if (awarded > 0) {
          ctx.fillText(`+${awarded}`, sx, sy - f.species.size * 0.6 - rise);
        } else {
          // Only reachable after ~80 sightings of one species in a single dive.
          ctx.font = `700 12px ${UI_FONT}`;
          ctx.fillStyle = '#9fb3c4';
          ctx.fillText('fully surveyed', sx, sy - f.species.size * 0.6 - rise);
        }
        ctx.font = `600 11px ${UI_FONT}`;
        ctx.fillStyle = '#eafcff';
        ctx.fillText(f.species.name, sx, sy - f.species.size * 0.6 - rise + 15);
        ctx.restore();
      }
    }
  }

  // ------------------------------------------------------------ diver
  function drawBubbles(state: DiveState, dt: number): void {
    // `dt` here is REAL seconds — a bubble rising 0.62 m per dive-second would
    // shoot up at 6 m/s at the default compression.
    const mouthDepth = state.depth;
    bubbleTimer -= dt;
    if (bubbleTimer <= 0 && state.depth > 0.3) {
      bubbleTimer = 0.28 + Math.random() * 0.3;
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        bubbles.push({
          wx: state.x + 2.2 + Math.random() * 0.6,
          depth: mouthDepth - 0.15,
          birthDepth: Math.max(0.2, mouthDepth),
          r0: 1.6 + Math.random() * 2.4,
          wob: Math.random() * Math.PI * 2,
        });
      }
      if (bubbles.length > 220) bubbles.splice(0, bubbles.length - 220);
    }

    ctx.save();
    ctx.strokeStyle = 'rgba(226,250,255,0.55)';
    ctx.lineWidth = 1;
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.depth -= 0.62 * dt;
      b.wob += dt * 2.4;
      if (b.depth <= 0.15) {
        bubbles.splice(i, 1);
        continue;
      }
      const sx = sxFor(b.wx, state.x) + Math.sin(b.wob) * 3;
      if (sx < -20) {
        bubbles.splice(i, 1);
        continue;
      }
      // Boyle: the bubble expands as it rises into lower pressure.
      const grow = Math.cbrt(
        ambientPressure(b.birthDepth) / ambientPressure(Math.max(0, b.depth)),
      );
      const r = Math.min(b.r0 * grow, b.r0 * 2.6);
      ctx.globalAlpha = clamp(0.25 + r * 0.09, 0.15, 0.7);
      ctx.beginPath();
      ctx.arc(sx, yFor(b.depth), r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawDiver(state: DiveState): void {
    const x = diverX();
    const y = yFor(state.depth);
    const pitch = clamp(state.verticalRate / 22, -1, 1) * 0.48;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(pitch);
    drawDiverSprite(ctx, animT);
    ctx.restore();
  }


  // ------------------------------------------------------------ ceiling
  function drawCeilingWash(ceiling: number): void {
    if (ceiling <= 0) return;
    const yc = yFor(ceiling);
    const g = ctx.createLinearGradient(0, TOP_PAD, 0, yc);
    g.addColorStop(0, 'rgba(255,40,40,0.10)');
    g.addColorStop(1, 'rgba(255,60,50,0.02)');
    ctx.fillStyle = g;
    ctx.fillRect(RULER_W, TOP_PAD, W - RULER_W, Math.max(0, yc - TOP_PAD));
  }

  function drawCeilingLine(state: DiveState): void {
    const ceiling = state.ceiling;
    if (ceiling <= 0) return;
    const yc = yFor(ceiling);
    const pulse = 0.65 + 0.35 * Math.sin(animT * 4.2);
    const bandH = 13;

    ctx.save();
    // hatched band
    ctx.beginPath();
    ctx.rect(RULER_W, yc - bandH / 2, W - RULER_W, bandH);
    ctx.clip();
    ctx.strokeStyle = `rgba(255,86,72,${0.55 * pulse + 0.25})`;
    ctx.lineWidth = 3;
    const off = (animT * 14) % 16;
    for (let x = RULER_W - bandH - off; x < W + bandH; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, yc + bandH / 2 + 2);
      ctx.lineTo(x + bandH + 4, yc - bandH / 2 - 2);
      ctx.stroke();
    }
    ctx.restore();

    // solid rule
    ctx.save();
    ctx.strokeStyle = `rgba(255,72,60,${0.85 * pulse + 0.15})`;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = 'rgba(255,60,50,0.9)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(RULER_W, yc);
    ctx.lineTo(W, yc);
    ctx.stroke();
    ctx.restore();

    // label
    const label = `DO NOT GO ABOVE ${U.depth(ceiling)} — your decompression ceiling`;
    ctx.save();
    ctx.font = `800 13px ${UI_FONT}`;
    const tw = ctx.measureText(label).width;
    const below = yc < TOP_PAD + 46;
    const ly = below ? yc + bandH / 2 + 8 : yc - bandH / 2 - 30;
    const lx = RULER_W + 18;
    ctx.fillStyle = `rgba(196,24,18,${0.88})`;
    ctx.beginPath();
    roundRectSafe(ctx, lx, ly, tw + 24, 24, 6);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,140,120,${pulse})`;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, lx + 12, ly + 12.5);
    ctx.restore();

    // "you must stay below" arrow
    ctx.save();
    ctx.globalAlpha = 0.75 * pulse;
    ctx.strokeStyle = '#ff6b5a';
    ctx.lineWidth = 2;
    const ax = W - 46;
    ctx.beginPath();
    ctx.moveTo(ax, yc + 8);
    ctx.lineTo(ax, yc + 24);
    ctx.moveTo(ax - 5, yc + 18);
    ctx.lineTo(ax, yc + 24);
    ctx.lineTo(ax + 5, yc + 18);
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------ ruler
  function drawRuler(state: DiveState): void {
    ctx.save();
    const g = ctx.createLinearGradient(0, 0, RULER_W, 0);
    g.addColorStop(0, 'rgba(3,12,22,0.72)');
    g.addColorStop(1, 'rgba(3,12,22,0.30)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, RULER_W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(RULER_W + 0.5, 0);
    ctx.lineTo(RULER_W + 0.5, H);
    ctx.stroke();

    ctx.textBaseline = 'middle';
    for (let d = 0; d <= CONFIG.seabedM; d += 5) {
      const y = yFor(d);
      const major = d % 10 === 0 && d > 0;
      ctx.strokeStyle = major ? 'rgba(150,238,255,0.55)' : 'rgba(190,225,240,0.28)';
      ctx.lineWidth = major ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(major ? 60 : 72, y + 0.5);
      ctx.lineTo(RULER_W, y + 0.5);
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.font = major ? `700 12px ${UI_FONT}` : `500 11px ${UI_FONT}`;
      ctx.fillStyle = major ? 'rgba(226,250,255,0.95)' : 'rgba(200,226,238,0.6)';
      ctx.fillText(U.teach(d, 0), 8, major ? y - 6 : y);

      if (major && d <= 40) {
        const p = ambientPressure(d);
        const mult = pressureMultiplier(d);
        ctx.font = `600 9.5px ${UI_FONT}`;
        ctx.fillStyle = 'rgba(126,226,222,0.9)';
        ctx.fillText(`${U.ambientPressureLabel(p)} · ×${mult.toFixed(mult % 1 ? 1 : 0)}`, 8, y + 6);
      }
    }

    // Diver depth marker on the ruler.
    const dy = yFor(state.depth);
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(RULER_W - 1, dy);
    ctx.lineTo(RULER_W - 11, dy - 5.5);
    ctx.lineTo(RULER_W - 11, dy + 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Boyle's law made physical: a bubble that shrinks as you take it down. */
  function drawBoyleBubble(state: DiveState): void {
    const baseR = 24;
    const rel = relativeVolume(state.depth);
    const r = baseR * Math.cbrt(Math.max(0.02, rel));
    const cx = RULER_W + 38;
    const cy = clamp(yFor(state.depth), TOP_PAD + baseR + 6, H - BOTTOM_PAD - baseR - 28);

    ctx.save();
    // surface-size reference outline
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(210,240,255,0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // the compressed bubble
    const bg = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    bg.addColorStop(0, 'rgba(255,255,255,0.85)');
    bg.addColorStop(0.5, 'rgba(180,240,255,0.30)');
    bg.addColorStop(1, 'rgba(120,210,240,0.12)');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(226,250,255,0.85)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 11px ${UI_FONT}`;
    ctx.fillStyle = '#dff8ff';
    ctx.fillText(`${Math.round(rel * 100)}% vol`, cx, cy + baseR + 11);
    ctx.font = `600 9.5px ${UI_FONT}`;
    ctx.fillStyle = 'rgba(150,230,226,0.85)';
    ctx.fillText("Boyle's law", cx, cy + baseR + 24);
    ctx.restore();
  }

  // ------------------------------------------------------------ effects
  function drawDepthGrade(state: DiveState): void {
    const f = clamp(state.depth / CONFIG.seabedM, 0, 1);
    if (f < 0.02) return;
    ctx.save();
    // Red goes first: multiply by a cyan-shifted tint.
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.5 * f;
    ctx.fillStyle = '#4fa6d2'; // low red, high blue => reds die first
    ctx.fillRect(0, 0, W, H);
    // then bleed the remaining colour out. A flat wash reads the same as a
    // 'saturation' blend here and costs a fraction of it — non-separable blend
    // modes are evaluated per pixel across the whole canvas.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.3 * f;
    ctx.fillStyle = '#5a7f96';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function drawNarcosis(state: DiveState): void {
    const n = clamp(state.narcosis, 0, 1);
    if (n < 0.04) return;
    // The sway that used to be done by compositing two offset copies of the whole
    // frame is now a transform applied to the scene in draw() — same woozy read,
    // none of the full-canvas readback. Only the vignette is drawn here.

    // Woozy vignette.
    ctx.save();
    const r0 = Math.min(W, H) * (0.34 - 0.08 * n);
    const g = ctx.createRadialGradient(W * 0.5, H * 0.5, r0, W * 0.5, H * 0.5, Math.max(W, H) * 0.72);
    g.addColorStop(0, 'rgba(60,10,90,0)');
    g.addColorStop(1, `rgba(48,8,86,${0.5 * n})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function drawAscentStrike(state: DiveState): void {
    const s = clamp(state.ascentStrike, 0, 1);
    if (s < 0.01) return;
    const pulse = 0.75 + 0.25 * Math.sin(animT * 6);
    const g = ctx.createRadialGradient(
      W * 0.5,
      H * 0.5,
      Math.min(W, H) * 0.3,
      W * 0.5,
      H * 0.5,
      Math.max(W, H) * 0.68,
    );
    g.addColorStop(0, 'rgba(255,170,40,0)');
    g.addColorStop(1, `rgba(255,150,20,${(0.16 + 0.5 * s) * pulse})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // ------------------------------------------------------------ draw
  function draw(state: DiveState): void {
    if (canvas.clientWidth !== measuredW || canvas.clientHeight !== measuredH) {
      if (canvas.clientWidth > 0 && canvas.clientHeight > 0) resize();
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Narcosis sway: nudging the whole scene transform costs nothing, where the
    // old two-copy composite cost a full backbuffer read per frame.
    const narc = clamp(state.narcosis, 0, 1);
    if (narc > 0.04) {
      ctx.translate(Math.sin(animT * 1.9) * 4.5 * narc, Math.cos(animT * 1.35) * 3 * narc);
    }

    // Dive-time delta: drives anything that must stay locked to the world, i.e.
    // how fast the reef scrolls past.
    let dt = state.t - lastT;
    // A rewound dive clock means reset() ran; drop per-fish render state so it
    // cannot be picked up by a fish that reuses an id.
    if (state.t < lastT) {
      popupStart.clear();
      bubbles.length = 0; // stale bubbles would keep rising in the old world frame
    }
    if (!(dt >= 0) || dt > 0.6) dt = dt > 0 ? 0.6 : 0;
    lastT = state.t;

    // Real-time delta: drives everything that is just animation.
    const nowMs = performance.now();
    let realDt = lastRealMs ? (nowMs - lastRealMs) / 1000 : 0.016;
    if (!(realDt >= 0) || realDt > 0.25) realDt = 0.016;
    lastRealMs = nowMs;
    animT += realDt;

    const t = animT;

    drawWater();
    drawSunShafts(t);
    drawFarTerrain(state.x);
    drawParticles(dt, realDt, state.depth);
    drawSafetyBand();
    drawNearTerrain(state.x);
    drawCeilingWash(state.ceiling);
    drawFish(state, t);
    drawBubbles(state, realDt);
    // Surface band first: it fills the sky strip above the waterline opaquely, and
    // at depth 0 that was painting over the diver's head. Drawing the diver last
    // lets them break the surface properly.
    drawSurface(t);
    drawDiver(state);

    // Scene-only colour grading (UI drawn after stays legible).
    drawDepthGrade(state);

    // Gauges and overlays sit outside the sway — a wobbling ruler reads as a bug.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawCeilingLine(state);
    drawRuler(state);
    drawBoyleBubble(state);

    drawNarcosis(state);
    drawAscentStrike(state);
  }

  resize();
  return { draw, resize };
}
