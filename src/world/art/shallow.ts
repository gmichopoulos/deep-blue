/**
 * Procedural vector art for the 0–12 m shallow band.
 *
 * Owned by the shallow-reef art pass: sardine, clownfish, cleaner shrimp and
 * green sea turtle. Everything here follows the contract in `types.ts` —
 * drawn facing +x, centred on the origin, inside roughly `size` × `size * 0.7`,
 * with every save() balanced and no transform or alpha leaking out.
 *
 * These render at 18–34 px, so the priorities are, in order: silhouette,
 * two or three confident colour areas, countershading, and only then detail.
 */

import type { FishArt } from './types';

// --------------------------------------------------------------- colour util

type RGB = readonly [number, number, number];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Water eats red first. Nudge a colour toward its own luminance with a cool
 * bias as depth rises. Deliberately gentle — render.ts already applies a global
 * depth grade, this is only per-species emphasis for the warm species.
 */
function tone(c: RGB, depthT: number, amount = 0.24, alpha = 1): string {
  const k = clamp01(depthT) * amount;
  const l = 0.26 * c[0] + 0.6 * c[1] + 0.14 * c[2];
  const r = Math.round(c[0] + (l * 0.8 - c[0]) * k);
  const g = Math.round(c[1] + (l * 0.96 - c[1]) * k);
  const b = Math.round(c[2] + (l * 1.2 - c[2]) * k);
  const cl = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
  return alpha >= 1
    ? `rgb(${cl(r)},${cl(g)},${cl(b)})`
    : `rgba(${cl(r)},${cl(g)},${cl(b)},${alpha})`;
}

/** Vertical dark-back → light-belly ramp: the cheapest 3D cue there is. */
function countershade(
  ctx: CanvasRenderingContext2D,
  top: number,
  bottom: number,
  stops: ReadonlyArray<readonly [number, RGB]>,
  depthT: number,
  amount = 0.24,
): CanvasGradient {
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  for (const [at, c] of stops) g.addColorStop(at, tone(c, depthT, amount));
  return g;
}

// ------------------------------------------------------------------- sardine

const SARDINE_BACK: RGB = [18, 62, 78];
const SARDINE_FLANK: RGB = [84, 136, 158];
const SARDINE_SILVER: RGB = [226, 238, 245];
const SARDINE_BELLY: RGB = [255, 255, 255];

/** Small, fast, silvery. Reads as a flicker of light with a forked tail. */
const sardine: FishArt = ({ ctx, size: L, t, phase, depthT }) => {
  const w = t * 8.2 + phase * 2.7; // fast beat — this is a 1.6 m/s fish
  const h = L * 0.165; // half body depth
  const nose = L * 0.5;
  const ped = -L * 0.32; // caudal peduncle
  const bend = Math.sin(w) * h * 0.7;
  const mid = Math.sin(w - 0.9) * h * 0.3;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // --- caudal fin, behind the body and lagging the tail beat
  ctx.save();
  ctx.translate(ped, bend);
  ctx.rotate(Math.cos(w) * 0.38);
  ctx.beginPath();
  ctx.moveTo(L * 0.04, 0);
  ctx.lineTo(-L * 0.15, -h * 1.3);
  ctx.lineTo(-L * 0.09, 0);
  ctx.lineTo(-L * 0.15, h * 1.3);
  ctx.closePath();
  ctx.fillStyle = tone([158, 190, 206], depthT, 0.2, 0.85);
  ctx.fill();
  ctx.restore();

  // --- body: slim fusiform, flexing through the beat
  ctx.beginPath();
  ctx.moveTo(nose, 0);
  ctx.bezierCurveTo(L * 0.3, -h * 0.96, L * 0.02, -h * 1.02 + mid, ped, -h * 0.24 + bend);
  ctx.lineTo(ped, h * 0.24 + bend);
  ctx.bezierCurveTo(L * 0.02, h * 1.02 + mid, L * 0.3, h * 0.96, nose, 0);
  ctx.closePath();
  ctx.fillStyle = countershade(
    ctx,
    -h * 1.05,
    h * 1.05,
    [
      [0, SARDINE_BACK],
      [0.36, SARDINE_BACK],
      [0.5, SARDINE_FLANK],
      [0.6, SARDINE_SILVER],
      [1, SARDINE_BELLY],
    ],
    depthT,
    0.16,
  );
  ctx.fill();

  // --- dorsal + anal fins, small and translucent
  ctx.fillStyle = tone([150, 184, 200], depthT, 0.2, 0.62);
  ctx.beginPath();
  ctx.moveTo(L * 0.07, -h * 0.9);
  ctx.quadraticCurveTo(-L * 0.02, -h * 1.45, -L * 0.11, -h * 0.82 + mid * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-L * 0.08, h * 0.82 + mid * 0.6);
  ctx.quadraticCurveTo(-L * 0.16, h * 1.35, -L * 0.22, h * 0.6 + bend * 0.7);
  ctx.closePath();
  ctx.fill();

  // --- pectoral fin, tucked just behind the gill
  ctx.save();
  ctx.translate(L * 0.19, h * 0.42);
  ctx.rotate(0.55 + Math.sin(w * 0.8) * 0.25);
  ctx.beginPath();
  ctx.ellipse(-L * 0.05, 0, L * 0.065, L * 0.026, 0, 0, Math.PI * 2);
  ctx.fillStyle = tone([170, 202, 216], depthT, 0.2, 0.45);
  ctx.fill();
  ctx.restore();

  // --- lateral line: the silver flash that makes a sardine a sardine
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = Math.max(0.6, L * 0.035);
  ctx.beginPath();
  ctx.moveTo(L * 0.4, -h * 0.05);
  ctx.quadraticCurveTo(L * 0.02, -h * 0.16 + mid * 0.4, ped + L * 0.02, bend * 0.9);
  ctx.stroke();

  // --- gill slit + eye
  ctx.strokeStyle = tone([40, 92, 110], depthT, 0.16, 0.55);
  ctx.lineWidth = Math.max(0.5, L * 0.028);
  ctx.beginPath();
  ctx.moveTo(L * 0.27, -h * 0.62);
  ctx.quadraticCurveTo(L * 0.22, 0, L * 0.27, h * 0.55);
  ctx.stroke();

  ctx.fillStyle = 'rgba(238,248,252,0.9)';
  ctx.beginPath();
  ctx.arc(L * 0.35, -h * 0.26, L * 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0b1a22';
  ctx.beginPath();
  ctx.arc(L * 0.355, -h * 0.26, L * 0.033, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
};

// ----------------------------------------------------------------- clownfish

const CLOWN_DARK: RGB = [206, 78, 6];
const CLOWN_MID: RGB = [255, 126, 22];
const CLOWN_LIGHT: RGB = [255, 178, 84];
const CLOWN_EDGE: RGB = [26, 14, 10];

/** Orange, three white bands, black edging everywhere. Deep-bodied and slow. */
const clownfish: FishArt = ({ ctx, size: L, t, phase, depthT }) => {
  const w = t * 4.6 + phase * 2.1;
  const h = L * 0.25; // half body depth
  const nose = L * 0.46;
  const ped = -L * 0.28;
  const bend = Math.sin(w) * h * 0.22;
  const edge = tone(CLOWN_EDGE, depthT, 0.1);
  const lw = Math.max(0.65, L * 0.026);

  const bodyPath = () => {
    ctx.beginPath();
    ctx.moveTo(nose, h * 0.14);
    ctx.bezierCurveTo(L * 0.44, -h * 0.5, L * 0.24, -h * 0.98, L * 0.02, -h);
    ctx.bezierCurveTo(-L * 0.12, -h, ped, -h * 0.66, ped, -h * 0.3 + bend);
    ctx.lineTo(ped, h * 0.34 + bend);
    ctx.bezierCurveTo(ped, h * 0.76, -L * 0.1, h * 1.02, L * 0.06, h);
    ctx.bezierCurveTo(L * 0.28, h * 0.96, L * 0.42, h * 0.6, nose, h * 0.14);
    ctx.closePath();
  };

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // --- caudal fin (behind body): rounded fan, pale with a dark rim
  ctx.save();
  ctx.translate(ped + L * 0.01, bend);
  ctx.rotate(Math.cos(w) * 0.3);
  ctx.beginPath();
  ctx.moveTo(L * 0.02, -h * 0.3);
  ctx.quadraticCurveTo(-L * 0.13, -h * 0.86, -L * 0.18, -h * 0.58);
  ctx.quadraticCurveTo(-L * 0.21, 0, -L * 0.18, h * 0.62);
  ctx.quadraticCurveTo(-L * 0.13, h * 0.9, L * 0.02, h * 0.34);
  ctx.closePath();
  const cg = ctx.createLinearGradient(L * 0.02, 0, -L * 0.2, 0);
  cg.addColorStop(0, tone(CLOWN_MID, depthT, 0.3));
  cg.addColorStop(0.55, tone([255, 176, 92], depthT, 0.3));
  cg.addColorStop(1, tone([255, 236, 208], depthT, 0.3));
  ctx.fillStyle = cg;
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = lw * 0.8;
  ctx.stroke();
  ctx.restore();

  // --- dorsal + anal fins, behind the body
  ctx.fillStyle = tone(CLOWN_MID, depthT, 0.3);
  ctx.strokeStyle = edge;
  ctx.lineWidth = lw * 0.75;
  ctx.beginPath();
  ctx.moveTo(L * 0.22, -h * 0.78);
  ctx.quadraticCurveTo(L * 0.04, -h * 1.7, -L * 0.18, -h * 0.86);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-L * 0.02, h * 0.9);
  ctx.quadraticCurveTo(-L * 0.16, h * 1.5, -L * 0.23, h * 0.68);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // --- body
  bodyPath();
  ctx.fillStyle = countershade(
    ctx,
    -h * 1.02,
    h * 1.02,
    [
      [0, CLOWN_DARK],
      [0.45, CLOWN_MID],
      [1, CLOWN_LIGHT],
    ],
    depthT,
    0.3,
  );
  ctx.fill();

  // --- the three white bands, clipped to the body so they end at the outline
  ctx.save();
  bodyPath();
  ctx.clip();
  const band = (cx: number, halfW: number, skew: number) => {
    ctx.beginPath();
    ctx.moveTo(cx + halfW + skew, -h * 1.4);
    ctx.lineTo(cx - halfW + skew, -h * 1.4);
    ctx.lineTo(cx - halfW - skew, h * 1.4);
    ctx.lineTo(cx + halfW - skew, h * 1.4);
    ctx.closePath();
    ctx.fillStyle = 'rgba(252,253,255,0.97)';
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = lw * 0.85;
    ctx.stroke();
  };
  band(L * 0.26, L * 0.045, L * 0.03); // head band, tilted back at the base
  band(-L * 0.02, L * 0.055, -L * 0.035); // mid band, leaning forward
  band(-L * 0.235, L * 0.035, L * 0.01); // tail band
  ctx.restore();

  // --- body outline last so the black edging sits on top of everything
  bodyPath();
  ctx.strokeStyle = edge;
  ctx.lineWidth = lw;
  ctx.stroke();

  // --- pectoral fin, fluttering over the mid band
  ctx.save();
  ctx.translate(L * 0.16, h * 0.46);
  ctx.rotate(0.75 + Math.sin(w * 1.7) * 0.4);
  ctx.beginPath();
  ctx.moveTo(0, -L * 0.012);
  ctx.quadraticCurveTo(-L * 0.09, -L * 0.05, -L * 0.14, -L * 0.006);
  ctx.quadraticCurveTo(-L * 0.09, L * 0.03, 0, L * 0.02);
  ctx.closePath();
  ctx.fillStyle = tone([255, 158, 66], depthT, 0.3, 0.78);
  ctx.fill();
  ctx.strokeStyle = tone(CLOWN_EDGE, depthT, 0.1, 0.5);
  ctx.lineWidth = lw * 0.5;
  ctx.stroke();
  ctx.restore();

  // --- eye, sitting on the white head band
  ctx.fillStyle = '#120a08';
  ctx.beginPath();
  ctx.arc(L * 0.3, -h * 0.2, L * 0.062, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,240,215,0.9)';
  ctx.beginPath();
  ctx.arc(L * 0.315, -h * 0.32, L * 0.022, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
};

// ------------------------------------------------------------ cleaner shrimp

const SHRIMP_RED: RGB = [198, 40, 38];

/**
 * Banded cleaner shrimp: a slender glassy body under bold red/white banding,
 * a flared tail fan, and the trademark pair of very long white antennae held
 * forward. The antennae overrun the nominal width on purpose — at 19 px they
 * are most of what tells you this is a shrimp and not a small fish.
 */
const cleanerShrimp: FishArt = ({ ctx, size: L, t, phase, depthT }) => {
  const w = t * 2.3 + phase * 1.9;
  const sway = Math.sin(w);
  const flex = Math.sin(w * 1.3 + 0.6) * L * 0.018; // gentle abdominal curl
  const red = tone(SHRIMP_RED, depthT, 0.32);
  const pale = tone([214, 168, 158], depthT, 0.28, 0.85);

  // The body: one arched, tapering shape from rostrum to tail base.
  const body = () => {
    ctx.beginPath();
    ctx.moveTo(L * 0.47, -L * 0.1); // rostrum tip
    ctx.lineTo(L * 0.33, -L * 0.13);
    ctx.quadraticCurveTo(L * 0.24, -L * 0.19, L * 0.12, -L * 0.175);
    ctx.quadraticCurveTo(L * 0.06, -L * 0.16, L * 0.02, -L * 0.165); // carapace/abdomen notch
    ctx.quadraticCurveTo(-L * 0.05, -L * 0.215, -L * 0.15, -L * 0.14 - flex);
    ctx.quadraticCurveTo(-L * 0.24, -L * 0.07 - flex, -L * 0.28, -L * 0.005 - flex);
    ctx.lineTo(-L * 0.23, L * 0.035 - flex);
    ctx.quadraticCurveTo(-L * 0.16, -L * 0.02 - flex, -L * 0.05, L * 0.02);
    ctx.quadraticCurveTo(L * 0.08, L * 0.09, L * 0.24, L * 0.075);
    ctx.quadraticCurveTo(L * 0.37, L * 0.05, L * 0.47, -L * 0.1);
    ctx.closePath();
  };

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // --- antennae, drawn first so the body overlaps their roots
  ctx.strokeStyle = 'rgba(255,255,255,0.88)';
  ctx.lineWidth = Math.max(0.5, L * 0.026);
  for (let i = 0; i < 2; i++) {
    const s = Math.sin(w * 1.15 + i * 1.4);
    const up = i === 0 ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(L * 0.3, -L * 0.09);
    ctx.quadraticCurveTo(
      L * 0.5,
      up * L * 0.11 + s * L * 0.03 - L * 0.04,
      L * 0.62,
      up * L * 0.18 + s * L * 0.06 - L * 0.03,
    );
    ctx.stroke();
  }
  // short secondary pair, sweeping low
  ctx.strokeStyle = 'rgba(238,250,255,0.55)';
  ctx.lineWidth = Math.max(0.42, L * 0.02);
  ctx.beginPath();
  ctx.moveTo(L * 0.3, -L * 0.04);
  ctx.quadraticCurveTo(L * 0.44, L * 0.03 + sway * L * 0.02, L * 0.54, L * 0.09);
  ctx.stroke();

  // --- tail fan: three blades flaring off the tapered abdomen
  ctx.save();
  ctx.translate(-L * 0.26, L * 0.01 - flex);
  ctx.rotate(0.35);
  for (let i = -1; i <= 1; i++) {
    ctx.save();
    ctx.rotate(i * (0.5 + Math.sin(w * 1.6) * 0.11));
    ctx.beginPath();
    ctx.moveTo(0, -L * 0.026);
    ctx.quadraticCurveTo(-L * 0.11, -L * 0.055, -L * 0.21, 0);
    ctx.quadraticCurveTo(-L * 0.11, L * 0.055, 0, L * 0.026);
    ctx.closePath();
    ctx.fillStyle = i === 0 ? red : 'rgba(255,250,248,0.9)';
    ctx.fill();
    ctx.strokeStyle = tone(SHRIMP_RED, depthT, 0.32, 0.8);
    ctx.lineWidth = Math.max(0.38, L * 0.016);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // --- legs: fine, swept back, barely there
  ctx.strokeStyle = tone([248, 232, 226], depthT, 0.22, 0.62);
  ctx.lineWidth = Math.max(0.4, L * 0.018);
  for (let i = 0; i < 4; i++) {
    const bx = L * (0.22 - i * 0.085);
    const k = Math.sin(w * 2.1 + i * 1.2) * L * 0.02;
    ctx.beginPath();
    ctx.moveTo(bx, L * 0.06);
    ctx.quadraticCurveTo(bx - L * 0.04, L * 0.12 + k, bx - L * 0.09, L * 0.15 + k);
    ctx.stroke();
  }
  // slim chelipeds reaching forward — the tools of the trade
  for (let i = 0; i < 2; i++) {
    const k = Math.sin(w * 1.7 + i * 2) * L * 0.012;
    ctx.beginPath();
    ctx.moveTo(L * 0.28, L * 0.05);
    ctx.quadraticCurveTo(L * 0.38, L * 0.1 + k, L * 0.47, L * 0.05 + k + i * L * 0.03);
    ctx.stroke();
  }

  // --- glassy body
  body();
  const bg = ctx.createLinearGradient(0, -L * 0.2, 0, L * 0.12);
  bg.addColorStop(0, 'rgba(206,226,236,0.72)');
  bg.addColorStop(0.55, 'rgba(246,250,252,0.62)');
  bg.addColorStop(1, 'rgba(255,255,255,0.5)');
  ctx.fillStyle = bg;
  ctx.fill();

  // --- bold banding, clipped to the body so it stops at the outline
  ctx.save();
  body();
  ctx.clip();
  ctx.fillStyle = red;
  const bands: ReadonlyArray<readonly [number, number, number]> = [
    [L * 0.27, L * 0.042, -0.3], // across the head
    [L * 0.05, L * 0.05, -0.42], // thorax / abdomen joint
    [-L * 0.15, L * 0.04, -0.6], // abdomen
  ];
  for (const [bx, bw, rot] of bands) {
    ctx.save();
    ctx.translate(bx, -flex * 0.5);
    ctx.rotate(rot);
    ctx.fillRect(-bw, -L * 0.3, bw * 2, L * 0.6);
    ctx.restore();
  }
  // abdominal segment seams — the giveaway that this is a crustacean
  ctx.strokeStyle = 'rgba(90,110,120,0.3)';
  ctx.lineWidth = Math.max(0.35, L * 0.014);
  for (let i = 0; i < 3; i++) {
    const bx = -L * (0.02 + i * 0.08);
    ctx.beginPath();
    ctx.moveTo(bx + L * 0.03, -L * 0.24);
    ctx.lineTo(bx - L * 0.03, L * 0.12);
    ctx.stroke();
  }
  // top-lit sheen along the arch, and a thin shadow above it
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(-L * 0.3, -L * 0.19, L * 0.75, L * 0.03);
  ctx.fillStyle = 'rgba(18,46,62,0.2)';
  ctx.fillRect(-L * 0.3, -L * 0.2, L * 0.75, L * 0.012);
  ctx.restore();

  body();
  ctx.strokeStyle = pale;
  ctx.lineWidth = Math.max(0.4, L * 0.018);
  ctx.stroke();

  // --- stalked eye, low on the head just behind the rostrum
  ctx.fillStyle = '#101418';
  ctx.beginPath();
  ctx.arc(L * 0.29, -L * 0.09, L * 0.023, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
};

// ----------------------------------------------------------------- sea turtle

const SHELL_TOP: RGB = [44, 68, 44];
const SHELL_MID: RGB = [104, 128, 62];
const SHELL_RIM: RGB = [196, 186, 122];
const SKIN_DARK: RGB = [86, 106, 62];
const SKIN_LIGHT: RGB = [206, 200, 146];

/** One paddle: drawn along +x from the shoulder, then rotated by the caller. */
function flipper(ctx: CanvasRenderingContext2D, len: number, wid: number): void {
  ctx.beginPath();
  ctx.moveTo(0, -wid * 0.55);
  ctx.quadraticCurveTo(len * 0.5, -wid * 0.92, len * 0.98, -wid * 0.22);
  ctx.quadraticCurveTo(len * 1.06, 0, len * 0.94, wid * 0.24);
  ctx.quadraticCurveTo(len * 0.5, wid * 0.7, 0, wid * 0.62);
  ctx.closePath();
}

/** Green sea turtle in profile: domed patterned carapace, long paddling arms. */
const seaTurtle: FishArt = ({ ctx, size: L, t, phase, depthT }) => {
  const w = t * 1.55 + phase * 1.6;
  const stroke = Math.sin(w);
  const sx = -L * 0.02;
  const sy = -L * 0.015;
  const rx = L * 0.33;
  const ry = L * 0.185;

  const shell = () => {
    ctx.beginPath();
    ctx.moveTo(sx + rx, sy + ry * 0.2);
    ctx.bezierCurveTo(
      sx + rx * 0.72,
      sy - ry * 1.05,
      sx - rx * 0.5,
      sy - ry * 1.18,
      sx - rx,
      sy - ry * 0.12,
    );
    ctx.bezierCurveTo(sx - rx * 1.04, sy + ry * 0.5, sx - rx * 0.5, sy + ry, sx, sy + ry);
    ctx.bezierCurveTo(sx + rx * 0.56, sy + ry, sx + rx * 0.96, sy + ry * 0.78, sx + rx, sy + ry * 0.2);
    ctx.closePath();
  };

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // --- far front flipper, behind the shell and half a beat out of step
  ctx.save();
  ctx.translate(L * 0.1, L * 0.05);
  ctx.rotate(0.66 + Math.sin(w + 1.9) * 0.48);
  flipper(ctx, L * 0.32, L * 0.11);
  ctx.fillStyle = tone([58, 74, 46], depthT, 0.24);
  ctx.fill();
  ctx.restore();

  // --- far rear flipper
  ctx.save();
  ctx.translate(-L * 0.26, L * 0.08);
  ctx.rotate(2.5 + stroke * 0.16);
  flipper(ctx, L * 0.17, L * 0.1);
  ctx.fillStyle = tone([54, 70, 44], depthT, 0.24);
  ctx.fill();
  ctx.restore();

  // --- neck + head, bobbing gently with the stroke
  ctx.save();
  ctx.translate(0, stroke * L * 0.008);
  ctx.beginPath();
  ctx.moveTo(L * 0.2, -L * 0.075);
  ctx.quadraticCurveTo(L * 0.35, -L * 0.125, L * 0.44, -L * 0.105);
  ctx.quadraticCurveTo(L * 0.51, -L * 0.085, L * 0.49, -L * 0.025);
  ctx.quadraticCurveTo(L * 0.45, L * 0.035, L * 0.34, L * 0.045);
  ctx.quadraticCurveTo(L * 0.25, L * 0.05, L * 0.19, L * 0.03);
  ctx.closePath();
  ctx.fillStyle = countershade(
    ctx,
    -L * 0.13,
    L * 0.05,
    [
      [0, SKIN_DARK],
      [0.6, [150, 158, 104] as RGB],
      [1, SKIN_LIGHT],
    ],
    depthT,
    0.22,
  );
  ctx.fill();

  // pale scale patches on the cheek — the green turtle's mottled face
  ctx.fillStyle = tone([226, 218, 158], depthT, 0.22, 0.75);
  ctx.beginPath();
  ctx.ellipse(L * 0.35, -L * 0.005, L * 0.045, L * 0.028, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(L * 0.44, -L * 0.055, L * 0.028, L * 0.02, 0.3, 0, Math.PI * 2);
  ctx.fill();

  // beak line + eye
  ctx.strokeStyle = tone([58, 66, 42], depthT, 0.2, 0.8);
  ctx.lineWidth = Math.max(0.5, L * 0.016);
  ctx.beginPath();
  ctx.moveTo(L * 0.485, -L * 0.03);
  ctx.quadraticCurveTo(L * 0.45, -L * 0.012, L * 0.42, -L * 0.018);
  ctx.stroke();
  ctx.fillStyle = '#12180f';
  ctx.beginPath();
  ctx.arc(L * 0.418, -L * 0.072, L * 0.023, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(240,248,225,0.8)';
  ctx.beginPath();
  ctx.arc(L * 0.424, -L * 0.079, L * 0.008, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // --- tail
  ctx.beginPath();
  ctx.moveTo(-L * 0.3, L * 0.02);
  ctx.quadraticCurveTo(-L * 0.4, L * 0.045, -L * 0.44, L * 0.02 + stroke * L * 0.012);
  ctx.quadraticCurveTo(-L * 0.38, L * 0.075, -L * 0.29, L * 0.07);
  ctx.closePath();
  ctx.fillStyle = tone(SKIN_DARK, depthT, 0.24);
  ctx.fill();

  // --- carapace
  shell();
  ctx.fillStyle = countershade(
    ctx,
    sy - ry * 1.1,
    sy + ry * 1.05,
    [
      [0, SHELL_TOP],
      [0.42, SHELL_MID],
      [0.78, [150, 158, 84] as RGB],
      [1, SHELL_RIM],
    ],
    depthT,
    0.2,
  );
  ctx.fill();

  // scute pattern, clipped to the shell
  ctx.save();
  shell();
  ctx.clip();
  ctx.strokeStyle = tone([34, 52, 34], depthT, 0.18, 0.5);
  ctx.lineWidth = Math.max(0.55, L * 0.019);
  for (let i = -2; i <= 2; i++) {
    const px = sx + i * rx * 0.36;
    ctx.beginPath();
    ctx.moveTo(px - rx * 0.06, sy - ry * 1.3);
    ctx.quadraticCurveTo(px + rx * 0.04, sy, px + rx * 0.02, sy + ry * 1.3);
    ctx.stroke();
  }
  // marginal-scute seam along the lower rim
  ctx.beginPath();
  ctx.moveTo(sx - rx * 1.1, sy + ry * 0.5);
  ctx.quadraticCurveTo(sx, sy + ry * 0.78, sx + rx * 1.1, sy + ry * 0.34);
  ctx.stroke();
  // top-light along the dome
  ctx.strokeStyle = 'rgba(214,236,190,0.28)';
  ctx.lineWidth = Math.max(0.7, L * 0.028);
  ctx.beginPath();
  ctx.moveTo(sx - rx * 0.72, sy - ry * 0.66);
  ctx.quadraticCurveTo(sx, sy - ry * 1.12, sx + rx * 0.7, sy - ry * 0.5);
  ctx.stroke();
  ctx.restore();

  shell();
  ctx.strokeStyle = tone([30, 46, 30], depthT, 0.18, 0.7);
  ctx.lineWidth = Math.max(0.5, L * 0.018);
  ctx.stroke();

  // --- near front flipper, in front of the shell and leading the stroke
  ctx.save();
  ctx.translate(L * 0.14, L * 0.075);
  ctx.rotate(0.74 + stroke * 0.5);
  flipper(ctx, L * 0.36, L * 0.125);
  const fg = ctx.createLinearGradient(0, -L * 0.09, 0, L * 0.09);
  fg.addColorStop(0, tone([74, 96, 52], depthT, 0.22));
  fg.addColorStop(1, tone([158, 166, 108], depthT, 0.22));
  ctx.fillStyle = fg;
  ctx.fill();
  ctx.strokeStyle = tone([40, 54, 34], depthT, 0.2, 0.8);
  ctx.lineWidth = Math.max(0.5, L * 0.018);
  ctx.stroke();
  // pale scale speckles on the paddle
  ctx.fillStyle = 'rgba(232,232,178,0.5)';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.ellipse(L * (0.08 + i * 0.09), -L * 0.012, L * 0.024, L * 0.016, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.restore();
};

// -------------------------------------------------------------------- export

export const SHALLOW_ART: Record<string, FishArt> = {
  sardine,
  clownfish,
  'cleaner-shrimp': cleanerShrimp,
  'sea-turtle': seaTurtle,
};
