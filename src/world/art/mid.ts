/**
 * Mid-water art (7–22 m): pufferfish, moon jellyfish, moray eel, reef crab.
 *
 * These render at 24–30 px, so everything here is built silhouette-first: one
 * confident body shape, two or three flat colour areas, and only as much detail
 * as survives at that size. All geometry is expressed as a fraction of `size`
 * so a species can be re-scaled from the table without redrawing anything.
 *
 * Facing is always +x (contract in ./types.ts) — the renderer mirrors us.
 */

import type { FishArt, FishArtArgs } from './types';

// ------------------------------------------------------------------ helpers

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Depth-aware colour. Water eats red first, so as `depthT` rises we pull the
 * warm channels toward the colour's own luminance — reds go grey, blues stay.
 * The renderer already applies a global grade, so `warmth` is per-species
 * emphasis only (the reef crab leans on it; everyone else stays near 1).
 */
function tone(
  depthT: number,
  r: number,
  g: number,
  b: number,
  a = 1,
  warmth = 1,
): string {
  const k = clamp01(clamp01(depthT) * 0.34 * warmth);
  const l = 0.3 * r + 0.55 * g + 0.15 * b;
  const rr = Math.round(r + (l - r) * k);
  const gg = Math.round(g + (l - g) * k * 0.45);
  return `rgba(${rr},${gg},${Math.round(b)},${a})`;
}

// --------------------------------------------------------------- pufferfish

/** Body spots, in units of `size` relative to the origin: x, y, radius. */
const PUFFER_SPOTS: ReadonlyArray<readonly [number, number, number]> = [
  [0.14, -0.15, 0.032],
  [0.0, -0.2, 0.028],
  [-0.14, -0.14, 0.03],
  [-0.22, -0.02, 0.026],
  [-0.08, 0.02, 0.032],
  [0.06, -0.02, 0.026],
  [-0.18, 0.14, 0.028],
  [-0.02, 0.18, 0.03],
  [0.14, 0.11, 0.026],
];

/** The inflated outline, reused for the fill and for the spine rim. */
function pufferBody(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.beginPath();
  ctx.moveTo(0.44 * s, 0.04 * s);
  ctx.bezierCurveTo(0.36 * s, -0.17 * s, 0.14 * s, -0.29 * s, -0.04 * s, -0.29 * s);
  ctx.bezierCurveTo(-0.22 * s, -0.29 * s, -0.33 * s, -0.18 * s, -0.33 * s, -0.01 * s);
  ctx.bezierCurveTo(-0.33 * s, 0.16 * s, -0.2 * s, 0.29 * s, -0.02 * s, 0.29 * s);
  ctx.bezierCurveTo(0.2 * s, 0.29 * s, 0.37 * s, 0.2 * s, 0.44 * s, 0.04 * s);
  ctx.closePath();
}

/** One fluttering pectoral fan, hinged at the origin of the current frame. */
function pufferFin(ctx: CanvasRenderingContext2D, s: number, fill: string): void {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-0.06 * s, 0.1 * s, -0.16 * s, 0.15 * s);
  ctx.quadraticCurveTo(-0.11 * s, 0.03 * s, -0.02 * s, -0.03 * s);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

const drawPufferfish: FishArt = ({ ctx, size: s, t, phase, depthT }: FishArtArgs) => {
  ctx.save();

  const lw = Math.max(0.7, s * 0.028);
  // Pectorals beat fast — a puffer is a bad swimmer working hard.
  const flap = Math.sin(t * 13 + phase);
  const flap2 = Math.sin(t * 13 + phase + 0.9);
  const wag = Math.sin(t * 3.1 + phase * 1.7);

  // Far-side pectoral, behind the body and darker so it reads as depth.
  ctx.save();
  ctx.translate(0.06 * s, -0.02 * s);
  ctx.rotate(-0.25 + flap2 * 0.4);
  ctx.scale(1, -1);
  pufferFin(ctx, s, tone(depthT, 150, 106, 58, 0.55));
  ctx.restore();

  // Caudal fan, a lazy scull.
  ctx.save();
  ctx.translate(-0.3 * s, 0);
  ctx.rotate(wag * 0.22);
  ctx.beginPath();
  ctx.moveTo(0.02 * s, -0.05 * s);
  ctx.quadraticCurveTo(-0.13 * s, -0.16 * s, -0.19 * s, -0.11 * s);
  ctx.quadraticCurveTo(-0.15 * s, 0, -0.19 * s, 0.11 * s);
  ctx.quadraticCurveTo(-0.13 * s, 0.16 * s, 0.02 * s, 0.06 * s);
  ctx.closePath();
  ctx.fillStyle = tone(depthT, 214, 158, 86, 0.92);
  ctx.fill();
  ctx.restore();

  // Faint spines: short quills around the rim, everywhere but the face.
  ctx.save();
  ctx.strokeStyle = tone(depthT, 236, 206, 152, 0.5);
  ctx.lineWidth = lw * 0.8;
  ctx.lineCap = 'round';
  for (let i = 0; i < 13; i++) {
    const a = Math.PI * (0.36 + (i / 12) * 1.28); // back half of the rim
    const cx = -0.02 * s + Math.cos(a) * 0.345 * s;
    const cy = Math.cos(t * 6 + phase + i) * 0.004 * s + Math.sin(a) * 0.285 * s;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * 0.048 * s, cy + Math.sin(a) * 0.048 * s);
    ctx.stroke();
  }
  ctx.restore();

  // Body.
  pufferBody(ctx, s);
  ctx.fillStyle = tone(depthT, 224, 170, 92);
  ctx.fill();

  // Pale belly, clipped to the body so it never breaks the silhouette.
  ctx.save();
  pufferBody(ctx, s);
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(0.04 * s, 0.28 * s, 0.34 * s, 0.19 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = tone(depthT, 250, 234, 200, 0.95);
  ctx.fill();
  // Darker dorsal cap.
  ctx.beginPath();
  ctx.ellipse(-0.06 * s, -0.34 * s, 0.32 * s, 0.17 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = tone(depthT, 150, 100, 48, 0.55);
  ctx.fill();

  ctx.fillStyle = tone(depthT, 62, 40, 22, 0.72);
  for (const [x, y, r] of PUFFER_SPOTS) {
    ctx.beginPath();
    ctx.ellipse(x * s, y * s, r * s, r * s * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.lineWidth = lw;
  ctx.strokeStyle = tone(depthT, 92, 58, 28, 0.55);
  pufferBody(ctx, s);
  ctx.stroke();

  // Near pectoral, over the body.
  ctx.save();
  ctx.translate(0.08 * s, 0.03 * s);
  ctx.rotate(0.3 + flap * 0.45);
  pufferFin(ctx, s, tone(depthT, 246, 214, 158, 0.78));
  ctx.restore();

  // Beak and eye.
  ctx.beginPath();
  ctx.moveTo(0.44 * s, 0.045 * s);
  ctx.quadraticCurveTo(0.37 * s, 0.09 * s, 0.32 * s, 0.07 * s);
  ctx.lineWidth = lw * 1.1;
  ctx.strokeStyle = tone(depthT, 74, 44, 24, 0.85);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0.25 * s, -0.08 * s, 0.075 * s, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(250,246,238,0.95)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0.265 * s, -0.075 * s, 0.042 * s, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(18,14,12,0.95)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0.245 * s, -0.095 * s, 0.016 * s, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fill();

  ctx.restore();
};

// ---------------------------------------------------------------- jellyfish

const drawJellyfish: FishArt = ({ ctx, size: s, t, phase }: FishArtArgs) => {
  ctx.save();

  // One slow contraction cycle drives everything; the trailing parts read the
  // same cycle a beat late, which is what makes a jelly look like it swims.
  const cyc = t * 1.5 + phase;
  const pulse = Math.sin(cyc);
  const lag = Math.sin(cyc - 1.0);

  const cy = -0.05 * s; // bell centre, leaving room below for the arms
  const bw = 0.31 * s * (1 + 0.1 * pulse);
  const bh = 0.24 * s * (1 - 0.14 * pulse);
  const rim = 0.05 * s * (1 - 0.3 * pulse); // how far the skirt flares out

  // --- trailing tentacles first, so the bell floats over them.
  ctx.lineCap = 'round';
  for (let i = 0; i < 15; i++) {
    const u = i / 14;
    const x0 = -bw + u * bw * 2;
    // Rim tentacles are longest at the sides, shortest under the apex.
    const len = (0.18 + 0.14 * Math.abs(u - 0.5) * 2) * s * (1 + 0.18 * lag);
    const sway = Math.sin(cyc - 1.4 + i * 0.7) * 0.05 * s;
    const y0 = cy + Math.sqrt(Math.max(0, 1 - (x0 / bw) * (x0 / bw))) * bh * 0.16;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(
      x0 + (x0 > 0 ? rim : -rim) * 0.6,
      y0 + len * 0.4,
      x0 + sway,
      y0 + len * 0.75,
      x0 + sway * 1.8 - 0.02 * s,
      y0 + len,
    );
    ctx.lineWidth = Math.max(0.5, s * 0.011);
    ctx.strokeStyle = `rgba(214,240,255,${0.16 + 0.14 * (1 - Math.abs(u - 0.5) * 2)})`;
    ctx.stroke();
  }

  // --- four oral arms: shorter, wider, frillier, pulled by the same lag.
  for (let i = 0; i < 4; i++) {
    const off = (i - 1.5) * 0.075 * s;
    const curl = Math.sin(cyc - 0.8 + i * 1.1) * 0.055 * s;
    const len = 0.27 * s * (1 + 0.12 * lag);
    ctx.beginPath();
    ctx.moveTo(off * 0.5, cy + bh * 0.1);
    ctx.bezierCurveTo(
      off + curl * 0.5,
      cy + len * 0.45,
      off * 1.6 + curl,
      cy + len * 0.8,
      off * 1.2 + curl * 1.6,
      cy + len,
    );
    ctx.lineWidth = Math.max(0.9, s * 0.035) * (1 - i * 0.05);
    ctx.strokeStyle = 'rgba(226,244,255,0.2)';
    ctx.stroke();
    ctx.lineWidth = Math.max(0.5, s * 0.014);
    ctx.strokeStyle = 'rgba(255,232,240,0.28)';
    ctx.stroke();
  }

  // --- the bell, as stacked low-alpha shells rather than one flat shape.
  const bellPath = (k: number): void => {
    const w = bw * k;
    const h = bh * k;
    ctx.beginPath();
    ctx.moveTo(-w, cy);
    ctx.bezierCurveTo(-w, cy - h * 1.5, w, cy - h * 1.5, w, cy);
    // Skirt: the rim flares out and the underside is scalloped inward.
    ctx.bezierCurveTo(w + rim * k, cy + h * 0.28, w * 0.5, cy + h * 0.2, 0, cy + h * 0.24);
    ctx.bezierCurveTo(-w * 0.5, cy + h * 0.2, -w - rim * k, cy + h * 0.28, -w, cy);
    ctx.closePath();
  };

  bellPath(1.06);
  ctx.fillStyle = 'rgba(150,206,246,0.13)';
  ctx.fill();

  bellPath(1.0);
  ctx.fillStyle = 'rgba(196,232,255,0.15)';
  ctx.fill();

  bellPath(0.78);
  ctx.fillStyle = 'rgba(226,246,255,0.14)';
  ctx.fill();

  // Four horseshoe gonads — the one opaque-ish thing inside a moon jelly.
  for (let i = 0; i < 4; i++) {
    const gx = (i - 1.5) * bw * 0.42;
    const gy = cy - bh * 0.18;
    ctx.beginPath();
    ctx.arc(gx, gy, bw * 0.16, Math.PI * 0.15, Math.PI * 0.85);
    ctx.lineWidth = Math.max(0.7, s * 0.026);
    ctx.strokeStyle = 'rgba(255,198,214,0.4)';
    ctx.stroke();
  }

  // Rim highlight — the brightest line on the animal, and the whole silhouette.
  bellPath(1.0);
  ctx.lineWidth = Math.max(0.7, s * 0.026);
  ctx.strokeStyle = 'rgba(228,248,255,0.55)';
  ctx.stroke();

  // A crescent of specular on the apex.
  ctx.beginPath();
  ctx.ellipse(-bw * 0.3, cy - bh * 0.62, bw * 0.3, bh * 0.16, -0.35, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fill();

  ctx.restore();
};

// ---------------------------------------------------------------- moray eel

/** Half-thickness of the ribbon at position `u` (0 = tail, 1 = snout). */
function morayGirth(u: number): number {
  if (u < 0.12) return 0.012 + u * 0.553; // tapers to a fine tail tip
  if (u > 0.82) return 0.085 - (u - 0.82) * 0.1;
  return 0.085 - Math.abs(u - 0.45) * 0.02;
}

const drawMorayEel: FishArt = ({ ctx, size: s, t, phase, depthT }: FishArtArgs) => {
  ctx.save();

  const x0 = -0.5 * s; // free tail tip
  const x1 = 0.3 * s; // jaw hinge; the head is drawn separately past this
  const wave = t * 2.4 + phase;

  // Centreline. An eel swimming in open water is anguilliform: the wave runs
  // head-to-tail and grows as it goes, so the head barely tracks while the tail
  // sweeps hard. (Anchored in a crevice it would be the exact opposite, which is
  // what this used to be.)
  const yAt = (x: number): number => {
    const u = clamp01((x - x0) / (x1 - x0)); // 0 at tail, 1 at snout
    const aft = 1 - u;
    const amp = 0.15 * s * (0.06 + aft * aft);
    return amp * Math.sin((x / s) * 8.2 - wave);
  };

  const N = 26;
  const pts: { x: number; y: number; g: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const x = x0 + (x1 - x0) * u;
    pts.push({ x, y: yAt(x), g: morayGirth(u) * s });
  }

  // --- body ribbon.
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y - pts[0].g);
  for (let i = 1; i <= N; i++) ctx.lineTo(pts[i].x, pts[i].y - pts[i].g);
  for (let i = N; i >= 0; i--) ctx.lineTo(pts[i].x, pts[i].y + pts[i].g);
  ctx.closePath();
  ctx.fillStyle = tone(depthT, 150, 132, 62);
  ctx.fill();

  ctx.save();
  ctx.clip();
  // Pale belly stripe along the lower edge.
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y + pts[0].g * 0.25);
  for (let i = 1; i <= N; i++) ctx.lineTo(pts[i].x, pts[i].y + pts[i].g * 0.25);
  for (let i = N; i >= 0; i--) ctx.lineTo(pts[i].x, pts[i].y + pts[i].g + s);
  ctx.closePath();
  ctx.fillStyle = tone(depthT, 216, 204, 140, 0.55);
  ctx.fill();
  // Mottling: irregular dark blotches riding the body. Sizes and offsets come
  // off a cheap hash so it looks camouflaged rather than polka-dotted.
  ctx.fillStyle = tone(depthT, 58, 48, 20, 0.5);
  for (let i = 2; i < N; i += 2) {
    const p = pts[i];
    const h = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const k = 0.45 + Math.abs(h) * 0.7;
    ctx.beginPath();
    ctx.ellipse(
      p.x + h * 0.01 * s,
      p.y + (h > 0 ? -0.45 : 0.15) * p.g,
      p.g * k * 0.7,
      p.g * k,
      h,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  // Dorsal ridge, drawn inside the clip so it stays a stripe on the back
  // rather than a pale outline floating off the silhouette.
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y - pts[0].g);
  for (let i = 1; i <= N; i++) ctx.lineTo(pts[i].x, pts[i].y - pts[i].g);
  for (let i = N; i >= 0; i--) {
    const p = pts[i];
    ctx.lineTo(p.x, p.y - p.g + 0.035 * s * clamp01((i / N - 0.05) * 3));
  }
  ctx.closePath();
  ctx.fillStyle = tone(depthT, 214, 202, 130, 0.45);
  ctx.fill();

  ctx.restore();

  // --- head, in a frame aligned with the body at the hinge.
  const hp = pts[N];
  const ang = Math.atan2(hp.y - pts[N - 2].y, hp.x - pts[N - 2].x);
  const gape = 0.2 + 0.12 * (0.5 + 0.5 * Math.sin(t * 1.1 + phase * 2)); // breathing
  ctx.save();
  ctx.translate(hp.x, hp.y);
  ctx.rotate(ang);

  // Mouth interior first — everything else overlaps it.
  ctx.beginPath();
  ctx.moveTo(-0.02 * s, 0);
  ctx.lineTo(0.17 * s, -0.035 * s);
  ctx.lineTo(0.16 * s, 0.06 * s);
  ctx.closePath();
  ctx.fillStyle = tone(depthT, 92, 38, 46);
  ctx.fill();

  // Upper jaw + skull.
  ctx.beginPath();
  ctx.moveTo(-0.04 * s, -hp.g);
  ctx.quadraticCurveTo(0.09 * s, -0.095 * s, 0.18 * s, -0.045 * s);
  ctx.lineTo(0.19 * s, -0.02 * s);
  ctx.quadraticCurveTo(0.08 * s, -0.005 * s, -0.04 * s, 0);
  ctx.closePath();
  ctx.fillStyle = tone(depthT, 158, 140, 68);
  ctx.fill();

  // Lower jaw, hinged open by `gape`.
  ctx.save();
  ctx.rotate(gape);
  ctx.beginPath();
  ctx.moveTo(-0.04 * s, 0);
  ctx.quadraticCurveTo(0.08 * s, 0.02 * s, 0.17 * s, 0.028 * s);
  ctx.lineTo(0.165 * s, 0.055 * s);
  ctx.quadraticCurveTo(0.06 * s, 0.075 * s, -0.04 * s, hp.g);
  ctx.closePath();
  ctx.fillStyle = tone(depthT, 196, 182, 116);
  ctx.fill();
  // Teeth on the lower jaw.
  ctx.fillStyle = 'rgba(246,242,228,0.85)';
  for (let i = 0; i < 3; i++) {
    const tx = (0.05 + i * 0.045) * s;
    ctx.beginPath();
    ctx.moveTo(tx, 0.012 * s);
    ctx.lineTo(tx + 0.014 * s, 0.012 * s);
    ctx.lineTo(tx + 0.007 * s, -0.022 * s);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Teeth on the upper jaw.
  ctx.fillStyle = 'rgba(246,242,228,0.85)';
  for (let i = 0; i < 3; i++) {
    const tx = (0.04 + i * 0.045) * s;
    ctx.beginPath();
    ctx.moveTo(tx, -0.006 * s);
    ctx.lineTo(tx + 0.014 * s, -0.006 * s);
    ctx.lineTo(tx + 0.007 * s, 0.026 * s);
    ctx.closePath();
    ctx.fill();
  }

  // Eye — small, high and forward.
  ctx.beginPath();
  ctx.arc(0.055 * s, -0.05 * s, 0.03 * s, 0, Math.PI * 2);
  ctx.fillStyle = tone(depthT, 236, 216, 150, 0.95);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0.058 * s, -0.048 * s, 0.016 * s, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(12,10,8,0.95)';
  ctx.fill();
  ctx.restore();

  ctx.restore();
};

// ---------------------------------------------------------------- reef crab

/**
 * A crab walks sideways, so it is the one animal here we see head-on: the
 * travel direction is +x, the body faces the viewer. A profile crab reads as a
 * beetle at 24 px; a wide shell with legs fanned out either side reads as a
 * crab instantly.
 *
 * Legs, in units of `size`: root, elbow offset, foot offset. Mirrored onto both
 * sides — index 0 is the outermost pair.
 */
const CRAB_LEGS: ReadonlyArray<{
  rx: number;
  ry: number;
  kx: number;
  ky: number;
  fx: number;
  fy: number;
}> = [
  { rx: 0.2, ry: -0.02, kx: 0.16, ky: 0.03, fx: 0.06, fy: 0.24 },
  { rx: 0.24, ry: 0.04, kx: 0.13, ky: 0.06, fx: 0.05, fy: 0.21 },
  { rx: 0.16, ry: 0.09, kx: 0.09, ky: 0.09, fx: 0.03, fy: 0.16 },
];

/** Carapace outline — laid out more than once (fill, clip, stroke). */
function carapacePath(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.beginPath();
  ctx.moveTo(-0.28 * s, -0.02 * s);
  ctx.bezierCurveTo(-0.27 * s, -0.16 * s, -0.13 * s, -0.21 * s, 0, -0.21 * s);
  ctx.bezierCurveTo(0.13 * s, -0.21 * s, 0.27 * s, -0.16 * s, 0.28 * s, -0.02 * s);
  ctx.bezierCurveTo(0.29 * s, 0.09 * s, 0.16 * s, 0.16 * s, 0, 0.16 * s);
  ctx.bezierCurveTo(-0.16 * s, 0.16 * s, -0.29 * s, 0.09 * s, -0.28 * s, -0.02 * s);
  ctx.closePath();
}

/**
 * One pincer, pointing +x from the origin of the current frame. `open` is 0–1.
 * Filled shapes, not strokes — at this size a line-art claw reads as antlers.
 */
function crabClaw(
  ctx: CanvasRenderingContext2D,
  s: number,
  open: number,
  fill: string,
  edge: string,
  tip: string,
  lw: number,
): void {
  // Arm into the palm.
  ctx.strokeStyle = fill;
  ctx.lineWidth = lw * 2.1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-0.08 * s, 0.02 * s);
  ctx.lineTo(0.03 * s, 0.01 * s);
  ctx.stroke();

  // Palm — the heavy mass that makes the claw read.
  ctx.beginPath();
  ctx.ellipse(0.1 * s, 0, 0.095 * s, 0.07 * s, -0.18, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw * 0.8;
  ctx.strokeStyle = edge;
  ctx.stroke();

  // Fixed finger (lower) — short, blunt, shell-coloured with a pale tip.
  ctx.beginPath();
  ctx.moveTo(0.13 * s, 0.03 * s);
  ctx.quadraticCurveTo(0.2 * s, 0.055 * s, 0.25 * s, 0.03 * s);
  ctx.quadraticCurveTo(0.19 * s, 0.015 * s, 0.14 * s, -0.01 * s);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  // Dactyl (upper), hinged open.
  ctx.save();
  ctx.translate(0.14 * s, -0.01 * s);
  ctx.rotate(-0.4 * open);
  ctx.beginPath();
  ctx.moveTo(-0.01 * s, -0.03 * s);
  ctx.quadraticCurveTo(0.06 * s, -0.06 * s, 0.11 * s, -0.04 * s);
  ctx.quadraticCurveTo(0.06 * s, -0.012 * s, 0.0, 0.008 * s);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0.1 * s, -0.042 * s, 0.022 * s, 0.014 * s, -0.2, 0, Math.PI * 2);
  ctx.fillStyle = tip;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.ellipse(0.24 * s, 0.032 * s, 0.022 * s, 0.014 * s, 0.2, 0, Math.PI * 2);
  ctx.fillStyle = tip;
  ctx.fill();
}

const drawReefCrab: FishArt = ({ ctx, size: s, t, phase, depthT }: FishArtArgs) => {
  ctx.save();

  // The blurb's point: below ~15 m this animal stops being red. Lean on the
  // depth term harder than the other species do.
  const shell = tone(depthT, 208, 70, 46, 1, 1.9);
  const shellLit = tone(depthT, 240, 126, 86, 1, 1.9);
  const shellDark = tone(depthT, 128, 32, 24, 1, 1.9);
  const clawTip = tone(depthT, 248, 226, 202, 1, 1.4);
  const lw = Math.max(0.7, s * 0.03);

  const scuttle = t * 7 + phase;
  // A sideways crab rocks on its legs as it goes.
  ctx.translate(0, Math.sin(scuttle) * 0.012 * s);

  // --- legs: three pairs, the trailing side stepping out of phase.
  ctx.lineCap = 'round';
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < CRAB_LEGS.length; i++) {
      const L = CRAB_LEGS[i];
      const step = Math.sin(scuttle - i * 1.2 + (side < 0 ? Math.PI : 0));
      const lift = Math.max(0, step); // off the bottom on the forward swing
      const bx = side * L.rx * s;
      const by = L.ry * s;
      const kx = bx + side * L.kx * s;
      const ky = by + L.ky * s;
      // Feet swing along the travel axis and lift clear on the recovery.
      const fx = kx + side * L.fx * s + step * 0.05 * s;
      const fy = ky + L.fy * s - lift * 0.05 * s;
      // Rear pair sits behind the shell and reads darker.
      const back = i === 2;
      ctx.strokeStyle = back ? shellDark : shell;
      ctx.lineWidth = (back ? 1.3 : 1.7) * lw;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(kx, ky);
      ctx.stroke();
      ctx.lineWidth = (back ? 1.0 : 1.2) * lw;
      ctx.beginPath();
      ctx.moveTo(kx, ky);
      ctx.lineTo(fx, fy);
      ctx.stroke();
    }
  }

  const pinch = 0.5 + 0.5 * Math.sin(t * 2.2 + phase * 1.7);

  // --- carapace.
  carapacePath(ctx, s);
  ctx.fillStyle = shell;
  ctx.fill();

  ctx.save();
  ctx.clip();
  // Light off the top of the shell, shadow along the front margin.
  ctx.beginPath();
  ctx.ellipse(-0.02 * s, -0.24 * s, 0.26 * s, 0.15 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = shellLit;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0.0, 0.21 * s, 0.3 * s, 0.09 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = shellDark;
  ctx.fill();
  // Mouthparts: a small dark plate low and centre.
  ctx.beginPath();
  ctx.moveTo(-0.05 * s, 0.08 * s);
  ctx.lineTo(0.05 * s, 0.08 * s);
  ctx.lineTo(0.035 * s, 0.145 * s);
  ctx.lineTo(-0.035 * s, 0.145 * s);
  ctx.closePath();
  ctx.fillStyle = tone(depthT, 128, 32, 24, 0.55, 1.9);
  ctx.fill();
  ctx.restore();

  // Re-lay the path: clip()/restore() leave the last shading shape current.
  carapacePath(ctx, s);
  ctx.lineWidth = lw;
  ctx.strokeStyle = shellDark;
  ctx.stroke();

  // --- trailing claw (−x): smaller, held lower, shadow-side colours.
  ctx.save();
  ctx.scale(-1, 1);
  ctx.translate(0.23 * s, 0.07 * s);
  ctx.rotate(-0.32 + Math.sin(scuttle * 0.4) * 0.07);
  ctx.scale(0.85, 0.85);
  crabClaw(ctx, s, 1 - pinch, shellDark, shellDark, clawTip, lw);
  ctx.restore();

  // --- eyes on short stalks, up on the shell.
  for (let i = -1; i <= 1; i += 2) {
    const ex = i * 0.1 * s;
    const ey = -0.24 * s;
    ctx.beginPath();
    ctx.moveTo(i * 0.085 * s, -0.15 * s);
    ctx.lineTo(ex, ey);
    ctx.lineWidth = lw * 1.2;
    ctx.strokeStyle = shell;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ex, ey, 0.042 * s, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(18,14,14,0.95)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex - 0.014 * s, ey - 0.016 * s, 0.016 * s, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fill();
  }

  // --- leading claw (+x): the big one, raised and working.
  ctx.save();
  ctx.translate(0.23 * s, 0.03 * s);
  ctx.rotate(-0.6 + Math.sin(scuttle * 0.35 + 1.2) * 0.08);
  crabClaw(ctx, s, pinch, shell, shellDark, clawTip, lw);
  ctx.restore();

  ctx.restore();
};

// ------------------------------------------------------------------ registry

export const MID_ART: Record<string, FishArt> = {
  pufferfish: drawPufferfish,
  jellyfish: drawJellyfish,
  'moray-eel': drawMorayEel,
  'reef-crab': drawReefCrab,
};
