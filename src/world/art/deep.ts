/**
 * Procedural art for the 17–31 m band: octopus, squid, spiny lobster.
 *
 * These are the "worth the bottom time" animals, so they carry more silhouette
 * and more motion than the shallow filler. Everything is drawn facing +x and
 * centred on the origin; the renderer mirrors the canvas for the other heading.
 *
 * The rules that keep the two cephalopods apart at 30 px:
 *   octopus — round finless mantle, eight arms fanning and curling behind
 *   squid   — hard triangular fins on a torpedo mantle, two straight tentacles
 * Both jet mantle-first, which is also what puts their limbs behind them.
 */

import type { FishArt, FishArtArgs } from './types';

interface Pt {
  x: number;
  y: number;
}

/**
 * Water eats red first. Pull warm channels toward the ambient blue-grey as
 * depth rises — gently, because the renderer already grades the whole scene.
 */
function ink(depthT: number, r: number, g: number, b: number, a = 1): string {
  const k = 0.3 * depthT;
  const rr = Math.round(r + (54 - r) * k);
  const gg = Math.round(g + (96 - g) * k * 0.55);
  const bb = Math.round(b + (126 - b) * k * 0.3);
  return a >= 1 ? `rgb(${rr},${gg},${bb})` : `rgba(${rr},${gg},${bb},${a})`;
}

/**
 * Walk a limb outward from a base point. `curl` bends it progressively toward
 * the tip; the wave term is what makes each limb drift on its own clock.
 */
function limb(
  x0: number,
  y0: number,
  ang0: number,
  len: number,
  curl: number,
  waveAmp: number,
  wavePhase: number,
  waveFreq: number,
  segs: number,
): Pt[] {
  const pts: Pt[] = [{ x: x0, y: y0 }];
  const step = len / segs;
  let x = x0;
  let y = y0;
  for (let k = 1; k <= segs; k++) {
    const u = (k - 0.5) / segs;
    const ang =
      ang0 + curl * u * u + waveAmp * u * Math.sin(wavePhase + u * waveFreq);
    x += Math.cos(ang) * step;
    y += Math.sin(ang) * step;
    pts.push({ x, y });
  }
  return pts;
}

/** Widths along a limb: `w0` at the base easing to `w1` at the tip. */
function taper(n: number, w0: number, w1: number, power = 1): number[] {
  const w: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    w.push(w1 + (w0 - w1) * Math.pow(1 - u, power));
  }
  return w;
}

/** Build a closed tapered ribbon around a centreline. Leaves the path current. */
function ribbon(ctx: CanvasRenderingContext2D, pts: Pt[], w: number[]): void {
  const n = pts.length;
  const nx: number[] = [];
  const ny: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i > 0 ? i - 1 : 0];
    const b = pts[i < n - 1 ? i + 1 : n - 1];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    nx.push(-dy);
    ny.push(dx);
  }
  ctx.beginPath();
  ctx.moveTo(pts[0].x + nx[0] * w[0], pts[0].y + ny[0] * w[0]);
  for (let i = 1; i < n; i++) {
    ctx.lineTo(pts[i].x + nx[i] * w[i], pts[i].y + ny[i] * w[i]);
  }
  for (let i = n - 1; i >= 0; i--) {
    ctx.lineTo(pts[i].x - nx[i] * w[i], pts[i].y - ny[i] * w[i]);
  }
  ctx.closePath();
}

// --------------------------------------------------------------- octopus
const octopus: FishArt = ({ ctx, size: s, t, phase, depthT }: FishArtArgs) => {
  const skin = ink(depthT, 176, 84, 104);
  const skinLit = ink(depthT, 226, 150, 152);
  const skinDark = ink(depthT, 96, 38, 66);
  const armDark = ink(depthT, 116, 46, 76);

  ctx.save();
  ctx.lineJoin = 'round';

  // Eight arms fan from a crown behind the head, each on its own clock.
  const crownX = -0.05 * s;
  const crownY = 0.02 * s;
  const drawArm = (i: number, front: boolean) => {
    const f = i / 7; // 0 = topmost arm, 1 = bottom
    const base = Math.PI + (f - 0.5) * 1.5;
    const bx = crownX + Math.cos(base) * 0.07 * s;
    const by = crownY + Math.sin(base) * 0.09 * s;
    // Outer arms hook outward, inner arms stay straighter: reads as a fan.
    // The middle pair is pushed apart so the two lit arms never fuse into a slab.
    const split = i === 3 ? -0.5 : i === 4 ? 0.45 : 0;
    const curl = (f - 0.5) * 1.5 + split + Math.sin(phase * 2.3 + i * 1.7) * 0.45;
    const len = (0.36 + 0.05 * Math.sin(i * 2.1 + phase)) * s;
    const pts = limb(
      bx,
      by,
      base,
      len,
      curl,
      0.6,
      t * 0.22 + phase * 1.7 + i * 0.85,
      3.6,
      13,
    );
    ribbon(ctx, pts, taper(pts.length, 0.038 * s, 0.004 * s, 1.5));
    ctx.fillStyle = front ? skin : armDark;
    ctx.fill();
    if (front) {
      // A hint of suckers on the two arms nearest the viewer.
      ctx.fillStyle = ink(depthT, 250, 212, 202, 0.65);
      for (let k = 3; k < pts.length - 4; k += 2) {
        const u = k / (pts.length - 1);
        ctx.beginPath();
        ctx.arc(pts[k].x, pts[k].y, 0.011 * s * (1 - u * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  for (const i of [0, 1, 6, 7]) drawArm(i, false);

  // Webbing at the arm bases: mass under the head, not a hard shape.
  ctx.fillStyle = ink(depthT, 104, 40, 68, 0.9);
  ctx.beginPath();
  ctx.ellipse(-0.11 * s, 0.03 * s, 0.14 * s, 0.11 * s, -0.25, 0, Math.PI * 2);
  ctx.fill();

  // Mantle: a bulb that breathes. Round and finless — the whole point.
  ctx.save();
  ctx.scale(1, 1 + 0.05 * Math.sin(t * 0.5 + phase));
  ctx.beginPath();
  ctx.moveTo(-0.09 * s, 0.12 * s);
  ctx.bezierCurveTo(0.02 * s, 0.2 * s, 0.26 * s, 0.2 * s, 0.36 * s, 0.05 * s);
  ctx.bezierCurveTo(0.45 * s, -0.1 * s, 0.32 * s, -0.27 * s, 0.14 * s, -0.26 * s);
  ctx.bezierCurveTo(0.02 * s, -0.25 * s, -0.02 * s, -0.12 * s, -0.09 * s, 0.12 * s);
  ctx.closePath();
  const g = ctx.createLinearGradient(0.1 * s, -0.26 * s, 0.22 * s, 0.16 * s);
  g.addColorStop(0, skinLit);
  g.addColorStop(0.55, skin);
  g.addColorStop(1, skinDark);
  ctx.fillStyle = g;
  ctx.fill();

  // Mottling and rim light, clipped so nothing floats off the body.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = ink(depthT, 86, 32, 58, 0.35);
  for (let i = 0; i < 5; i++) {
    const a = i * 1.9 + phase;
    ctx.beginPath();
    ctx.ellipse(
      (0.12 + 0.16 * Math.abs(Math.sin(a))) * s,
      (-0.1 + 0.18 * Math.cos(a * 1.7)) * s,
      0.03 * s,
      0.021 * s,
      a,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.strokeStyle = ink(depthT, 252, 216, 208, 0.32);
  ctx.lineWidth = Math.max(1, 0.022 * s);
  ctx.beginPath();
  ctx.moveTo(0.04 * s, -0.19 * s);
  ctx.quadraticCurveTo(0.24 * s, -0.28 * s, 0.37 * s, -0.06 * s);
  ctx.stroke();
  ctx.restore();
  ctx.restore();

  for (const i of [2, 5]) drawArm(i, false);
  for (const i of [3, 4]) drawArm(i, true);

  // Brow + big eye at the base of the mantle.
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(0.06 * s, -0.06 * s, 0.105 * s, 0.088 * s, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ink(depthT, 246, 226, 176);
  ctx.beginPath();
  ctx.ellipse(0.06 * s, -0.07 * s, 0.068 * s, 0.058 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0b1016';
  ctx.beginPath();
  ctx.ellipse(0.062 * s, -0.07 * s, 0.052 * s, 0.018 * s, 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.arc(0.035 * s, -0.095 * s, 0.015 * s, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
};

// ----------------------------------------------------------------- squid
const squid: FishArt = ({ ctx, size: s, t, phase, depthT }: FishArtArgs) => {
  const body = ink(depthT, 224, 152, 154);
  const bodyDark = ink(depthT, 146, 72, 90);
  const belly = ink(depthT, 244, 214, 202);
  const finCol = ink(depthT, 232, 176, 186, 0.92);

  ctx.save();
  ctx.lineJoin = 'round';

  const headX = -0.08 * s;

  // --- eight short arms in a tight cone behind the head
  for (let i = 0; i < 6; i++) {
    const f = i / 5 - 0.5;
    const pts = limb(
      headX - 0.07 * s,
      f * 0.055 * s,
      Math.PI + f * 1.25,
      (0.12 + 0.05 * (1 - Math.abs(f) * 2)) * s,
      f * 0.5,
      0.3,
      t * 0.6 + phase + i,
      2.6,
      6,
    );
    ribbon(ctx, pts, taper(pts.length, 0.019 * s, 0.003 * s, 1.2));
    ctx.fillStyle = i % 2 ? body : bodyDark;
    ctx.fill();
  }

  // --- the two long feeding tentacles, trailing nearly straight behind
  for (let i = 0; i < 2; i++) {
    const sgn = i === 0 ? -1 : 1;
    const pts = limb(
      headX - 0.05 * s,
      sgn * 0.035 * s,
      Math.PI + sgn * 0.26,
      0.34 * s,
      -sgn * 0.1,
      0.16,
      t * 0.45 + phase * 1.3 + i * 2.1,
      3.4,
      10,
    );
    ribbon(ctx, pts, taper(pts.length, 0.013 * s, 0.005 * s, 1.5));
    ctx.fillStyle = i === 0 ? bodyDark : body;
    ctx.fill();
    // Feeding club on the tip.
    const tip = pts[pts.length - 1];
    const prev = pts[pts.length - 3];
    ctx.save();
    ctx.translate(tip.x, tip.y);
    ctx.rotate(Math.atan2(tip.y - prev.y, tip.x - prev.x));
    ctx.fillStyle = i === 0 ? bodyDark : body;
    ctx.beginPath();
    ctx.ellipse(-0.025 * s, 0, 0.04 * s, 0.016 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // --- fins: hard triangles, short leading edge and a long rippling trail
  for (const sgn of [-1, 1]) {
    const flap = Math.sin(t * 1.15 + phase * 2) * 0.035 * s;
    const peakX = 0.345 * s;
    const peakY = sgn * 0.185 * s + flap * sgn;
    ctx.beginPath();
    ctx.moveTo(0.44 * s, sgn * 0.035 * s);
    ctx.lineTo(peakX, peakY);
    for (let k = 1; k <= 8; k++) {
      const u = k / 8;
      const ripple =
        Math.sin(t * 1.15 + phase * 2 + u * 4.2) * 0.055 * s * Math.sin(u * Math.PI);
      ctx.lineTo(
        peakX + (-0.05 * s - peakX) * u,
        peakY + (sgn * 0.07 * s - peakY) * u + ripple * sgn,
      );
    }
    ctx.closePath();
    ctx.fillStyle = finCol;
    ctx.fill();
    ctx.strokeStyle = ink(depthT, 252, 230, 220, 0.5);
    ctx.lineWidth = Math.max(0.8, 0.016 * s);
    ctx.stroke();
  }

  // --- torpedo mantle, jetting tail-first
  const mg = ctx.createLinearGradient(0, -0.13 * s, 0, 0.13 * s);
  mg.addColorStop(0, bodyDark);
  mg.addColorStop(0.5, body);
  mg.addColorStop(0.86, belly);
  mg.addColorStop(1, body);
  ctx.fillStyle = mg;
  ctx.beginPath();
  ctx.moveTo(0.47 * s, 0);
  ctx.bezierCurveTo(0.38 * s, -0.09 * s, 0.14 * s, -0.12 * s, headX, -0.085 * s);
  ctx.lineTo(headX, 0.085 * s);
  ctx.bezierCurveTo(0.14 * s, 0.12 * s, 0.38 * s, 0.09 * s, 0.47 * s, 0);
  ctx.closePath();
  ctx.fill();
  // Outline so the mantle stays a hard shape against the pale fins.
  ctx.strokeStyle = ink(depthT, 118, 54, 74, 0.75);
  ctx.lineWidth = Math.max(0.8, 0.015 * s);
  ctx.stroke();

  // Chromatophore speckle + a thin iridescent flank line.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = ink(depthT, 138, 52, 74, 0.5);
  for (let i = 0; i < 8; i++) {
    const a = i * 2.4 + phase;
    ctx.beginPath();
    ctx.arc(
      (0.0 + 0.42 * ((i * 0.37 + phase * 0.11) % 1)) * s,
      Math.sin(a) * 0.055 * s,
      0.014 * s,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(226,250,255,0.4)';
  ctx.lineWidth = Math.max(0.7, 0.013 * s);
  ctx.beginPath();
  ctx.moveTo(0.42 * s, 0.015 * s);
  ctx.lineTo(headX + 0.01 * s, 0.045 * s);
  ctx.stroke();
  ctx.restore();

  // --- head + funnel + eye, at the rear of the mantle
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(headX - 0.04 * s, 0, 0.08 * s, 0.078 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = bodyDark;
  ctx.beginPath();
  ctx.moveTo(headX + 0.02 * s, 0.045 * s);
  ctx.quadraticCurveTo(headX - 0.03 * s, 0.105 * s, headX - 0.08 * s, 0.065 * s);
  ctx.quadraticCurveTo(headX - 0.03 * s, 0.055 * s, headX + 0.02 * s, 0.015 * s);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = ink(depthT, 236, 236, 210);
  ctx.beginPath();
  ctx.arc(headX - 0.045 * s, -0.02 * s, 0.042 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#080d12';
  ctx.beginPath();
  // The famous W-shaped pupil, reduced to a kinked bar at this size.
  ctx.ellipse(
    headX - 0.045 * s,
    -0.015 * s,
    0.032 * s,
    0.017 * s,
    -0.35,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(headX - 0.06 * s, -0.04 * s, 0.012 * s, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
};

// --------------------------------------------------------------- lobster
const lobster: FishArt = ({ ctx, size: s, t, phase, depthT }: FishArtArgs) => {
  const shell = ink(depthT, 188, 68, 46);
  const shellLit = ink(depthT, 236, 128, 80);
  const shellDark = ink(depthT, 108, 32, 32);
  const legCol = ink(depthT, 152, 58, 46);

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const flex = Math.sin(t * 0.3 + phase) * 0.07;

  /** One claw: upper arm, palm, and two fingers that open and close. */
  const drawClaw = (near: boolean) => {
    const gape =
      0.14 + 0.16 * (0.5 + 0.5 * Math.sin(t * 0.42 + phase * 2 + (near ? 0 : 1.7)));
    const lift = Math.sin(t * 0.34 + phase + (near ? 0 : 2.2)) * 0.16;
    ctx.save();
    // The far claw is held up and forward so both claws clear the carapace.
    ctx.translate(near ? 0.2 * s : 0.25 * s, near ? 0.085 * s : 0.0);
    ctx.rotate((near ? -0.04 : -0.16) + lift * 0.25);
    const scale = near ? 1 : 0.82;
    ctx.scale(scale, scale);

    ctx.strokeStyle = near ? shell : shellDark;
    ctx.lineWidth = Math.max(1.2, 0.052 * s);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0.09 * s, -0.02 * s);
    ctx.stroke();

    ctx.save();
    ctx.translate(0.11 * s, -0.025 * s);
    ctx.rotate(-0.06);
    const pg = ctx.createLinearGradient(0, -0.09 * s, 0, 0.09 * s);
    pg.addColorStop(0, near ? shellLit : shell);
    pg.addColorStop(1, shellDark);
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.ellipse(0.06 * s, 0, 0.095 * s, 0.075 * s, 0.05, 0, Math.PI * 2);
    ctx.fill();

    // Pincer fingers: two short thick wedges with a clear V between them.
    for (const fs of [-1, 1]) {
      ctx.save();
      ctx.rotate(fs * gape);
      ctx.fillStyle = fs < 0 ? (near ? shellLit : shell) : near ? shell : shellDark;
      ctx.beginPath();
      ctx.moveTo(0.08 * s, -0.062 * s * fs);
      ctx.quadraticCurveTo(0.17 * s, -0.058 * s * fs, 0.21 * s, -0.012 * s * fs);
      ctx.quadraticCurveTo(0.15 * s, 0.0 * s, 0.08 * s, 0.012 * s * fs);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    ctx.restore();
  };

  /** One antenna: a long whip sweeping ahead of the animal. */
  const drawAntenna = (near: boolean) => {
    const sweep = Math.sin(t * 0.3 + phase * 1.6 + (near ? 1.2 : 0)) * 0.3;
    // Both antennae sweep up and forward, clear of the claws below them.
    const pts = limb(
      0.23 * s,
      (near ? -0.09 : -0.12) * s,
      (near ? -0.62 : -0.86) + sweep * 0.3,
      0.31 * s,
      (near ? 0.85 : 0.6) + sweep,
      0.24,
      t * 0.35 + phase + (near ? 1.9 : 0),
      3.2,
      10,
    );
    ribbon(ctx, pts, taper(pts.length, 0.018 * s, 0.003 * s, 1.3));
    ctx.fillStyle = near ? legCol : shellDark;
    ctx.fill();
  };

  /** Walking legs; `off` staggers the near and far banks. */
  const drawLegs = (near: boolean) => {
    ctx.strokeStyle = near ? legCol : shellDark;
    ctx.lineWidth = Math.max(1, 0.024 * s);
    for (let i = 0; i < 4; i++) {
      const step =
        Math.sin(t * 0.55 + phase * 2 + i * 1.4 + (near ? 0 : 1.6)) * 0.045 * s;
      const bx = (0.2 - i * 0.06) * s;
      ctx.beginPath();
      ctx.moveTo(bx, 0.06 * s);
      ctx.quadraticCurveTo(
        bx - 0.02 * s + step,
        0.15 * s,
        bx - 0.05 * s + step * 1.7,
        0.22 * s,
      );
      ctx.stroke();
    }
  };

  drawAntenna(false);
  drawLegs(false);

  // --- armoured segmented tail, tapering and curling under
  let tx = 0.04 * s;
  let ty = -0.01 * s;
  let tAng = 0;
  for (let i = 0; i < 6; i++) {
    const u = i / 5;
    tAng += 0.07 + flex * (0.5 + u);
    const seg = 0.058 * s;
    const nx2 = tx - Math.cos(tAng) * seg;
    const ny2 = ty + Math.sin(tAng) * seg;
    const h = (0.115 - u * 0.055) * s;
    ctx.save();
    ctx.translate((tx + nx2) / 2, (ty + ny2) / 2);
    ctx.rotate(-tAng);
    const sg = ctx.createLinearGradient(0, -h, 0, h);
    sg.addColorStop(0, shellLit);
    sg.addColorStop(0.45, shell);
    sg.addColorStop(1, shellDark);
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.roundRect(-seg * 0.82, -h, seg * 1.64, h * 2, 0.03 * s);
    ctx.fill();
    ctx.strokeStyle = ink(depthT, 74, 22, 24, 0.8);
    ctx.lineWidth = Math.max(0.7, 0.015 * s);
    ctx.stroke();
    ctx.restore();
    tx = nx2;
    ty = ny2;
  }

  // --- tail fan
  ctx.save();
  ctx.translate(tx, ty);
  ctx.rotate(-tAng);
  for (const b of [-1, 0, 1]) {
    ctx.fillStyle = b === 0 ? shell : shellDark;
    ctx.beginPath();
    ctx.moveTo(0.01 * s, 0);
    ctx.quadraticCurveTo(-0.07 * s, b * 0.08 * s, -0.14 * s, b * 0.13 * s);
    ctx.quadraticCurveTo(-0.09 * s, b * 0.02 * s, -0.01 * s, -0.03 * s);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // --- carapace
  ctx.beginPath();
  ctx.moveTo(0.0 * s, 0.1 * s);
  ctx.bezierCurveTo(0.12 * s, 0.14 * s, 0.24 * s, 0.12 * s, 0.31 * s, 0.03 * s);
  ctx.bezierCurveTo(0.36 * s, -0.04 * s, 0.26 * s, -0.16 * s, 0.11 * s, -0.15 * s);
  ctx.bezierCurveTo(0.03 * s, -0.145 * s, 0.005 * s, -0.04 * s, 0.0 * s, 0.1 * s);
  ctx.closePath();
  const cg = ctx.createLinearGradient(0, -0.16 * s, 0, 0.13 * s);
  cg.addColorStop(0, shellLit);
  cg.addColorStop(0.5, shell);
  cg.addColorStop(1, shellDark);
  ctx.fillStyle = cg;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = ink(depthT, 250, 190, 150, 0.4);
  ctx.lineWidth = Math.max(0.8, 0.016 * s);
  ctx.beginPath();
  ctx.moveTo(0.02 * s, 0.05 * s);
  ctx.quadraticCurveTo(0.18 * s, 0.09 * s, 0.3 * s, 0.0 * s);
  ctx.stroke();
  ctx.restore();

  // Spines along the back — this is a spiny lobster.
  ctx.fillStyle = shellDark;
  for (let i = 0; i < 4; i++) {
    const x = (0.25 - i * 0.07) * s;
    const y = -0.125 * s + i * 0.012 * s;
    ctx.beginPath();
    ctx.moveTo(x - 0.02 * s, y + 0.03 * s);
    ctx.lineTo(x + 0.022 * s, y + 0.035 * s);
    ctx.lineTo(x + 0.032 * s, y - 0.035 * s);
    ctx.closePath();
    ctx.fill();
  }

  // Far claw sits above and behind the near one: two claws, clearly stacked.
  drawClaw(false);

  // Eye on a short stalk.
  ctx.strokeStyle = shellDark;
  ctx.lineWidth = Math.max(1, 0.022 * s);
  ctx.beginPath();
  ctx.moveTo(0.25 * s, -0.06 * s);
  ctx.lineTo(0.29 * s, -0.1 * s);
  ctx.stroke();
  ctx.fillStyle = '#0a0f14';
  ctx.beginPath();
  ctx.arc(0.3 * s, -0.11 * s, 0.028 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.arc(0.292 * s, -0.119 * s, 0.01 * s, 0, Math.PI * 2);
  ctx.fill();

  drawLegs(true);
  drawClaw(true);
  drawAntenna(true);

  ctx.restore();
};

export const DEEP_ART: Record<string, FishArt> = {
  octopus,
  squid,
  lobster,
};
