/**
 * Trophy species — the 26–41 m payoff: grey reef shark, humpback whale and the
 * chambered nautilus.
 *
 * Everything here is drawn facing +x (nose at +size/2, tail at −size/2) and
 * centred on the origin; the renderer mirrors the canvas for creatures swimming
 * the other way, so no direction is ever baked in.
 *
 * The shark and the whale share a spine-and-profile rig (`makeBody`): a body is
 * a centreline `spine(u)` plus separate dorsal/ventral half-thickness profiles,
 * with `u` running 0 at the nose to 1 at the tail tip. Outline points are offset
 * along the spine *normal*, so when the travelling wave bends the body the
 * silhouette bends with it instead of shearing. Fins hang off `at(u)` and rotate
 * with the local tangent, which is what makes a tail flick read as one motion.
 */

import type { FishArt } from './types';

// ---------------------------------------------------------------- tiny utils

interface Pt {
  x: number;
  y: number;
}

type RGB = readonly [number, number, number];

/**
 * Colour with a gentle depth correction: water eats red first, so warm channels
 * creep toward the local luminance as `depthT` rises. Kept deliberately weak —
 * the renderer already lays a global tint over the whole scene.
 */
function col(c: RGB, depthT: number, a = 1): string {
  const m = depthT * 0.2;
  const lum = 0.32 * c[0] + 0.52 * c[1] + 0.16 * c[2];
  const r = Math.round(c[0] + (lum - c[0]) * m);
  const g = Math.round(c[1] + (lum - c[1]) * m * 0.45);
  const b = Math.round(c[2]);
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}

function smooth(k: number): number {
  return k * k * (3 - 2 * k);
}

/** Deterministic 0..1 jitter, so a nautilus's stripes never crawl. */
function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/** Smoothstep-interpolated keyframe table: u → half-thickness, as a fraction of size. */
function profile(keys: ReadonlyArray<readonly [number, number]>): (u: number) => number {
  return (u: number): number => {
    if (u <= keys[0][0]) return keys[0][1];
    const last = keys[keys.length - 1];
    if (u >= last[0]) return last[1];
    for (let i = 1; i < keys.length; i++) {
      if (u <= keys[i][0]) {
        const a = keys[i - 1];
        const b = keys[i];
        return a[1] + (b[1] - a[1]) * smooth((u - a[0]) / (b[0] - a[0] || 1));
      }
    }
    return last[1];
  };
}

/** Midpoint-quadratic polyline: keeps sampled outlines from faceting. */
function polyPath(ctx: CanvasRenderingContext2D, pts: readonly Pt[], close: boolean): void {
  if (pts.length < 2) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
  if (close) ctx.closePath();
}

interface Body {
  /** Centreline point and local tangent angle (0 = pointing at the nose). */
  at(u: number): { x: number; y: number; a: number };
  /** Point on the outline: side +1 dorsal, −1 ventral; k scales in from the edge. */
  edge(u: number, side: number, k?: number): Pt;
  /** Closed silhouette sampled over [u0,u1]. */
  outline(u0: number, u1: number, n: number): Pt[];
  /** A band between two k-levels on one side — belly washes, throat pleats, sheen. */
  band(u0: number, u1: number, side: number, k0: number, k1: number, n: number): Pt[];
  /** A contour line at fixed k — pleat grooves, lateral line. */
  contour(u0: number, u1: number, side: number, k: number, n: number): Pt[];
}

function makeBody(
  S: number,
  spine: (u: number) => number,
  top: (u: number) => number,
  bot: (u: number) => number,
): Body {
  const X = (u: number): number => S * 0.5 - u * S;
  const slope = (u: number): number => {
    const e = 0.005;
    const a = Math.max(0, u - e);
    const b = Math.min(1, u + e);
    return (spine(b) - spine(a)) / (b - a);
  };
  /** Unit normal pointing "up" out of the back. */
  const nrm = (u: number): Pt => {
    const s = slope(u);
    const L = Math.hypot(S, s);
    return { x: -s / L, y: -S / L };
  };
  const edge = (u: number, side: number, k = 1): Pt => {
    const n = nrm(u);
    const h = (side > 0 ? top(u) : -bot(u)) * S * k;
    return { x: X(u) + n.x * h, y: spine(u) + n.y * h };
  };
  const contour = (u0: number, u1: number, side: number, k: number, n: number): Pt[] => {
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) pts.push(edge(u0 + ((u1 - u0) * i) / n, side, k));
    return pts;
  };
  return {
    at: (u: number) => ({ x: X(u), y: spine(u), a: Math.atan2(-slope(u), S) }),
    edge,
    contour,
    band: (u0, u1, side, k0, k1, n) =>
      contour(u0, u1, side, k0, n).concat(contour(u1, u0, side, k1, n)),
    outline: (u0: number, u1: number, n: number): Pt[] =>
      contour(u0, u1, 1, 1, n).concat(contour(u1, u0, -1, 1, n)),
  };
}

/**
 * Travelling wave down the body. Amplitude ramps from `hold` (head, nearly
 * still) to the tail and the phase lags with distance back, so the animal
 * undulates instead of rocking rigidly. `phase` is folded into the time term.
 */
function swimSpine(
  S: number,
  t: number,
  phase: number,
  freqHz: number,
  amp: number,
  lag: number,
  hold: number,
): (u: number) => number {
  const w = 2 * Math.PI * freqHz;
  return (u: number): number => {
    const r = Math.max(0, (u - hold) / (1 - hold));
    const th = w * t + phase;
    // Rear amplitude plus a small counter-swing at the snout, so the head is
    // not nailed in place but barely moves either.
    return (
      Math.sin(th - u * lag) * amp * S * Math.pow(r, 1.7) -
      Math.sin(th) * amp * S * 0.16 * (1 - r)
    );
  };
}

// ------------------------------------------------------------- grey reef shark

// A long flat wedge of a head — the dorsal line climbs slowly, the belly fills
// out behind the gills. Get this wrong and a shark reads as a dolphin.
const SHARK_TOP = profile([
  [0.0, 0.011],
  [0.03, 0.025],
  [0.09, 0.048],
  [0.17, 0.073],
  [0.28, 0.096],
  [0.4, 0.106],
  [0.52, 0.098],
  [0.64, 0.075],
  [0.73, 0.047],
  [0.8, 0.03],
]);
const SHARK_BOT = profile([
  [0.0, 0.01],
  [0.03, 0.023],
  [0.08, 0.05],
  [0.15, 0.086],
  [0.27, 0.122],
  [0.39, 0.132],
  [0.51, 0.118],
  [0.63, 0.087],
  [0.73, 0.05],
  [0.8, 0.028],
]);

const SHARK_FIN: RGB = [72, 85, 93];
const SHARK_TIP: RGB = [24, 30, 35];

const reefShark: FishArt = ({ ctx, size: S, t, phase, depthT }) => {
  const spine = swimSpine(S, t, phase, 1.1, 0.05, 4.2, 0.1);
  const body = makeBody(S, spine, SHARK_TOP, SHARK_BOT);
  const beat = Math.sin(2 * Math.PI * 1.1 * t + phase);

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const M = (x: number, y: number): void => ctx.moveTo(x * S, y * S);
  const Q = (a: number, b: number, x: number, y: number): void =>
    ctx.quadraticCurveTo(a * S, b * S, x * S, y * S);
  const C = (a: number, b: number, c: number, d: number, x: number, y: number): void =>
    ctx.bezierCurveTo(a * S, b * S, c * S, d * S, x * S, y * S);

  // -- far-side pectoral, behind everything: a depth cue, nothing more.
  {
    const p = body.edge(0.26, -1, 0.3);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(body.at(0.26).a + 0.42 + beat * 0.05);
    ctx.beginPath();
    M(0.02, -0.01);
    C(-0.01, 0.06, -0.06, 0.12, -0.13, 0.155);
    Q(-0.085, 0.08, -0.025, 0.02);
    ctx.closePath();
    ctx.fillStyle = col([38, 48, 56], depthT);
    ctx.fill();
    ctx.restore();
  }

  // -- fins first, bases buried inside the body so the joins stay clean.
  const fin = (u: number, side: number, k: number, extra: number, draw: () => void): void => {
    const p = body.edge(u, side, k);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(body.at(u).a + extra);
    ctx.beginPath();
    draw();
    ctx.closePath();
    ctx.fillStyle = col(SHARK_FIN, depthT);
    ctx.fill();
    ctx.restore();
  };

  // First dorsal — tall, strongly raked, concave trailing edge.
  fin(0.35, 1, 0.5, beat * 0.03, () => {
    M(0.08, 0.02);
    C(0.05, -0.055, 0.005, -0.125, -0.05, -0.178);
    Q(-0.052, -0.095, -0.1, 0.02);
  });
  // Second dorsal, small, just ahead of the tail.
  fin(0.7, 1, 0.45, beat * 0.05, () => {
    M(0.035, 0.015);
    Q(0.014, -0.026, -0.026, -0.055);
    Q(-0.03, -0.018, -0.052, 0.015);
  });
  // Pelvic pair.
  fin(0.57, -1, 0.45, -beat * 0.04, () => {
    M(0.04, -0.01);
    Q(0.012, 0.042, -0.042, 0.072);
    Q(-0.038, 0.026, -0.058, -0.01);
  });
  // Anal.
  fin(0.71, -1, 0.45, -beat * 0.05, () => {
    M(0.03, -0.01);
    Q(0.008, 0.03, -0.03, 0.05);
    Q(-0.03, 0.018, -0.048, -0.01);
  });

  // -- caudal: heterocercal crescent, long upper lobe, short lower one. Pitched
  //    off a point further back than its root so the blade lags the peduncle.
  {
    const p = body.at(0.79);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(body.at(0.94).a * 1.2);
    ctx.beginPath();
    M(0.03, -0.028);
    C(-0.04, -0.078, -0.12, -0.13, -0.208, -0.192); // upper lobe leading edge
    Q(-0.142, -0.112, -0.118, -0.048); // concave trailing edge
    Q(-0.1, -0.014, -0.074, 0.005); // subterminal notch into the fork
    Q(-0.118, 0.05, -0.15, 0.098); // lower lobe trailing edge
    C(-0.106, 0.075, -0.055, 0.048, 0.03, 0.028); // lower lobe leading edge
    const g = ctx.createLinearGradient(0, -0.19 * S, 0, 0.1 * S);
    g.addColorStop(0, col([44, 55, 63], depthT));
    g.addColorStop(0.6, col(SHARK_FIN, depthT));
    g.addColorStop(1, col([104, 117, 124], depthT));
    ctx.fillStyle = g;
    ctx.fill();
    // The grey reef shark's field mark: a broad black margin on the whole
    // trailing edge of the tail.
    ctx.beginPath();
    M(-0.208, -0.192);
    Q(-0.142, -0.112, -0.118, -0.048);
    Q(-0.1, -0.014, -0.074, 0.005);
    Q(-0.118, 0.05, -0.15, 0.098);
    ctx.strokeStyle = col(SHARK_TIP, depthT, 0.85);
    ctx.lineWidth = 0.013 * S;
    ctx.stroke();
    ctx.restore();
  }

  // -- body: countershaded, and the pale belly kept low where it belongs.
  ctx.beginPath();
  polyPath(ctx, body.outline(0, 0.8, 46), true);
  const mid = spine(0.34);
  const g = ctx.createLinearGradient(0, mid - 0.108 * S, 0, mid + 0.133 * S);
  g.addColorStop(0.0, col([46, 57, 65], depthT));
  g.addColorStop(0.34, col([62, 75, 84], depthT));
  g.addColorStop(0.58, col([100, 113, 120], depthT));
  g.addColorStop(0.72, col([160, 172, 176], depthT));
  g.addColorStop(0.83, col([226, 234, 234], depthT));
  g.addColorStop(1.0, col([238, 244, 243], depthT));
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  ctx.clip();

  // Specular sheen along the upper flank.
  ctx.beginPath();
  polyPath(ctx, body.band(0.14, 0.66, 1, 0.44, 0.7, 16), true);
  ctx.fillStyle = col([200, 214, 218], depthT, 0.09);
  ctx.fill();

  // Lateral line.
  ctx.beginPath();
  polyPath(ctx, body.contour(0.2, 0.78, -1, 0.14, 20), false);
  ctx.strokeStyle = col([232, 240, 240], depthT, 0.28);
  ctx.lineWidth = 0.007 * S;
  ctx.stroke();

  // Gill slits — five, short, raked back across the mid flank.
  ctx.strokeStyle = col([34, 42, 48], depthT, 0.5);
  ctx.lineWidth = 0.0085 * S;
  for (let i = 0; i < 5; i++) {
    const u = 0.19 + i * 0.026;
    const a = body.edge(u, 1, 0.3);
    const b = body.edge(u + 0.026, -1, 0.28);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo((a.x + b.x) / 2 + 0.008 * S, (a.y + b.y) / 2, b.x, b.y);
    ctx.stroke();
  }
  ctx.restore(); // end clip

  // -- head
  // Mouth: a wide crescent slung well under the snout, corner back past the eye.
  {
    const a = body.edge(0.05, -1, 0.55);
    const c = body.edge(0.125, -1, 0.9);
    const b = body.edge(0.2, -1, 0.6);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
    ctx.strokeStyle = col([26, 33, 38], depthT, 0.78);
    ctx.lineWidth = 0.011 * S;
    ctx.stroke();
  }

  // Ampullae of Lorenzini, on the snout: the pores it found you with.
  ctx.fillStyle = col([46, 56, 63], depthT, 0.32);
  for (let i = 0; i < 9; i++) {
    const u = 0.012 + hash(i * 3.1) * 0.06;
    const k = -0.8 + hash(i * 7.7) * 1.6;
    const p = body.edge(u, k > 0 ? 1 : -1, Math.abs(k) * 0.7);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 0.0045 * S, 0, Math.PI * 2);
    ctx.fill();
  }

  // Eye — small, black, set high on the head.
  {
    const e = body.edge(0.135, 1, 0.42);
    ctx.beginPath();
    ctx.ellipse(e.x, e.y, 0.0155 * S, 0.0135 * S, 0, 0, Math.PI * 2);
    ctx.fillStyle = col([214, 224, 224], depthT, 0.28);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(e.x, e.y, 0.0105 * S, 0.0095 * S, 0, 0, Math.PI * 2);
    ctx.fillStyle = col([10, 13, 16], depthT);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(e.x + 0.004 * S, e.y - 0.003 * S, 0.003 * S, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fill();
  }

  // -- near pectoral, over the body: narrow, swept, dusky-tipped.
  {
    const p = body.edge(0.28, -1, 0.38);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(body.at(0.28).a + 0.42 + beat * 0.07);
    ctx.beginPath();
    M(0.05, -0.02);
    C(0.022, 0.058, -0.045, 0.14, -0.15, 0.205); // leading edge out to the tip
    Q(-0.098, 0.125, -0.042, 0.045); // concave trailing edge
    Q(-0.018, 0.012, -0.014, -0.018);
    ctx.closePath();
    const pg = ctx.createLinearGradient(0.05 * S, -0.02 * S, -0.15 * S, 0.205 * S);
    pg.addColorStop(0, col([154, 167, 173], depthT));
    pg.addColorStop(0.45, col([104, 117, 124], depthT));
    pg.addColorStop(1, col([34, 42, 49], depthT));
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
};

// ------------------------------------------------------------- humpback whale

const WHALE_TOP = profile([
  [0.0, 0.016],
  [0.03, 0.048],
  [0.08, 0.078],
  [0.16, 0.1],
  [0.28, 0.11],
  [0.4, 0.105],
  [0.5, 0.094],
  [0.56, 0.088],
  [0.6, 0.091], // the hump the fin sits on
  [0.66, 0.08],
  [0.74, 0.057],
  [0.82, 0.036],
  [0.88, 0.022],
]);
const WHALE_BOT = profile([
  [0.0, 0.012],
  [0.03, 0.052],
  [0.09, 0.098],
  [0.18, 0.126],
  [0.3, 0.132],
  [0.42, 0.122],
  [0.54, 0.1],
  [0.66, 0.071],
  [0.76, 0.046],
  [0.84, 0.03],
  [0.88, 0.022],
]);

const whale: FishArt = ({ ctx, size: S, t, phase, depthT }) => {
  // Humpbacks beat slowly, and the whole rear third moves.
  const spine = swimSpine(S, t, phase, 0.32, 0.05, 3.0, 0.16);
  const body = makeBody(S, spine, WHALE_TOP, WHALE_BOT);
  const beat = Math.sin(2 * Math.PI * 0.32 * t + phase);

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const M = (x: number, y: number): void => ctx.moveTo(x * S, y * S);
  const Q = (a: number, b: number, x: number, y: number): void =>
    ctx.quadraticCurveTo(a * S, b * S, x * S, y * S);
  const C = (a: number, b: number, c: number, d: number, x: number, y: number): void =>
    ctx.bezierCurveTo(a * S, b * S, c * S, d * S, x * S, y * S);

  /**
   * One flipper: a long narrow scythe, local +x distal, local −y the leading
   * edge — which is where the tubercles go. Nothing else on a whale looks
   * remotely like it, so it carries most of the identification.
   */
  const flipper = (len: number, wide: number, knobs: number, fill: string | CanvasGradient): void => {
    // Sampled fine enough that the tubercles survive the path smoothing.
    const n = 64;
    const pts: Pt[] = [];
    // Widest a third of the way out, tapering to a near point.
    const chord = (k: number): number =>
      wide * Math.pow(Math.sin(Math.PI * (0.18 + 0.8 * k)), 0.7);
    const bow = (k: number): number => -0.09 * len * k * k; // bows forward
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      // Nine tubercles down the leading edge — the humpback's signature.
      const lump = Math.abs(Math.sin(k * Math.PI * 4.5)) * wide * knobs * (1 - k * 0.45);
      pts.push({ x: k * len * S, y: (-chord(k) - lump + bow(k)) * S });
    }
    for (let i = n; i >= 0; i--) {
      const k = i / n;
      pts.push({ x: k * len * S, y: (chord(k) * 0.72 + bow(k)) * S });
    }
    ctx.beginPath();
    polyPath(ctx, pts, true);
    ctx.fillStyle = fill;
    ctx.fill();
  };

  // -- far flipper, behind the body.
  {
    const p = body.edge(0.3, -1, 0.25);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(2.52 + beat * 0.07);
    flipper(0.24, 0.02, 0.3, col([44, 55, 63], depthT));
    ctx.restore();
  }

  // -- fluke, drawn under the body so the peduncle covers its root.
  {
    const p = body.at(0.88);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(body.at(1.0).a * 1.3);
    ctx.beginPath();
    M(0.035, -0.014);
    C(-0.005, -0.072, -0.045, -0.145, -0.1, -0.204); // upper lobe leading edge
    Q(-0.086, -0.128, -0.056, -0.06); // concave trailing edge
    Q(-0.046, -0.03, -0.034, -0.003); // into the central notch
    Q(-0.046, 0.03, -0.056, 0.06);
    Q(-0.086, 0.128, -0.1, 0.204); // lower lobe trailing edge
    C(-0.045, 0.145, -0.005, 0.072, 0.035, 0.014); // lower lobe leading edge
    ctx.closePath();
    const fg = ctx.createLinearGradient(0, -0.204 * S, 0, 0.204 * S);
    fg.addColorStop(0, col([22, 29, 35], depthT));
    fg.addColorStop(0.45, col([44, 55, 63], depthT));
    fg.addColorStop(0.72, col([104, 118, 126], depthT));
    fg.addColorStop(1, col([196, 208, 211], depthT)); // white underside catching light
    ctx.fillStyle = fg;
    ctx.fill();
    ctx.beginPath();
    M(-0.1, -0.204);
    Q(-0.07, -0.1, -0.034, -0.003);
    Q(-0.07, 0.1, -0.1, 0.204);
    ctx.strokeStyle = col([16, 22, 27], depthT, 0.45);
    ctx.lineWidth = 0.007 * S;
    ctx.stroke();
    ctx.restore();
  }

  // -- dorsal fin, sitting on its hump.
  {
    const p = body.edge(0.6, 1, 0.75);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(body.at(0.6).a);
    ctx.beginPath();
    M(0.06, 0.02);
    C(0.04, -0.008, 0.016, -0.03, -0.014, -0.05);
    Q(-0.02, -0.018, -0.052, 0.018);
    ctx.closePath();
    ctx.fillStyle = col([34, 43, 50], depthT);
    ctx.fill();
    ctx.restore();
  }

  // -- body
  ctx.beginPath();
  polyPath(ctx, body.outline(0, 0.88, 54), true);
  const mid = spine(0.3);
  const g = ctx.createLinearGradient(0, mid - 0.11 * S, 0, mid + 0.132 * S);
  g.addColorStop(0.0, col([20, 27, 33], depthT));
  g.addColorStop(0.26, col([32, 41, 48], depthT));
  g.addColorStop(0.54, col([62, 75, 84], depthT));
  g.addColorStop(0.7, col([124, 139, 147], depthT));
  g.addColorStop(0.84, col([214, 226, 228], depthT));
  g.addColorStop(1.0, col([242, 248, 248], depthT));
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  ctx.clip();

  // Pale pleated throat, tapering shut at the navel instead of stopping dead.
  {
    const pts: Pt[] = [];
    for (let i = 0; i <= 24; i++) {
      const u = 0.005 + (i / 24) * 0.55;
      const k = 0.32 + 0.71 * smooth(Math.min(1, Math.max(0, (u - 0.3) / 0.25)));
      pts.push(body.edge(u, -1, k));
    }
    for (let i = 24; i >= 0; i--) pts.push(body.edge(0.005 + (i / 24) * 0.55, -1, 1.03));
    ctx.beginPath();
    polyPath(ctx, pts, true);
    ctx.fillStyle = col([236, 244, 244], depthT, 0.5);
    ctx.fill();
  }

  // The pleats themselves: contour lines of the belly, converging at the chin
  // and fanning out to different lengths the way real ventral grooves do.
  ctx.lineWidth = 0.007 * S;
  ctx.strokeStyle = col([104, 120, 126], depthT, 0.36);
  for (let i = 0; i < 11; i++) {
    const k = 0.3 + (i / 10) * 0.68;
    ctx.beginPath();
    polyPath(ctx, body.contour(0.008, 0.3 + k * 0.24, -1, k, 24), false);
    ctx.stroke();
  }

  // Faint white flank mottling — humpbacks are individually marked.
  ctx.fillStyle = col([236, 244, 245], depthT, 0.1);
  for (let i = 0; i < 5; i++) {
    const p = body.edge(0.55 + hash(i * 5.3) * 0.28, -1, 0.2 + hash(i * 9.1) * 0.5);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, (0.018 + hash(i * 2.7) * 0.026) * S, 0.012 * S, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore(); // end clip

  // -- knobs, drawn over the outline so they break the silhouette. Tubercles on
  //    the rostrum and chin, and the ridge of bumps down the tail stock.
  const knob = (u: number, side: number, r: number): void => {
    const p = body.edge(u, side, 1);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * S, 0, Math.PI * 2);
    ctx.fillStyle = col(side > 0 ? [44, 55, 62] : [156, 170, 175], depthT);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x - 0.003 * S, p.y - 0.004 * S, r * 0.5 * S, 0, Math.PI * 2);
    ctx.fillStyle = col(side > 0 ? [72, 86, 94] : [206, 218, 220], depthT, 0.6);
    ctx.fill();
  };
  for (let i = 0; i < 7; i++) knob(0.012 + i * 0.02, 1, 0.011 - i * 0.0004);
  for (let i = 0; i < 6; i++) knob(0.008 + i * 0.019, -1, 0.008 - i * 0.0003);
  for (let i = 0; i < 4; i++) knob(0.7 + i * 0.04, 1, 0.007);

  // Jawline: long, arched, running back past the eye.
  {
    const a = body.edge(0.002, -1, 0.4);
    const c = body.edge(0.1, -1, 0.9);
    const b = body.edge(0.24, -1, 0.44);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
    ctx.strokeStyle = col([16, 22, 27], depthT, 0.62);
    ctx.lineWidth = 0.011 * S;
    ctx.stroke();
  }

  // Blowhole.
  {
    const p = body.edge(0.07, 1, 0.9);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 0.015 * S, 0.007 * S, -0.2, 0, Math.PI * 2);
    ctx.fillStyle = col([14, 19, 24], depthT, 0.8);
    ctx.fill();
  }

  // Eye, low and far forward, just behind the corner of the mouth.
  {
    const e = body.edge(0.25, -1, 0.36);
    ctx.beginPath();
    ctx.ellipse(e.x, e.y, 0.014 * S, 0.011 * S, 0.2, 0, Math.PI * 2);
    ctx.fillStyle = col([206, 218, 220], depthT, 0.35);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(e.x, e.y, 0.0095 * S, 0.008 * S, 0.2, 0, Math.PI * 2);
    ctx.fillStyle = col([10, 13, 16], depthT);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(e.x + 0.0035 * S, e.y - 0.003 * S, 0.0028 * S, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fill();
  }

  // -- near flipper: nearly a third of the body, white, knobbly, swept back.
  {
    const p = body.edge(0.31, -1, 0.5);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(2.34 + beat * 0.11);
    // Lit along the leading edge, shadowed along the trailing one, so it reads
    // as a blade with thickness rather than a flat stripe.
    const fg = ctx.createLinearGradient(0.05 * S, -0.045 * S, 0.12 * S, 0.045 * S);
    fg.addColorStop(0, col([250, 252, 252], depthT));
    fg.addColorStop(0.5, col([220, 231, 233], depthT));
    fg.addColorStop(1, col([142, 158, 165], depthT));
    flipper(0.33, 0.021, 0.62, fg);
    // Barnacle clusters near the tip.
    ctx.fillStyle = col([240, 242, 234], depthT, 0.5);
    for (let i = 0; i < 3; i++) {
      const k = 0.46 + i * 0.17;
      ctx.beginPath();
      ctx.arc(
        k * 0.33 * S,
        (-0.02 - 0.09 * 0.33 * k * k) * S,
        0.005 * S,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.restore();
};

// -------------------------------------------------------- chambered nautilus

const nautilus: FishArt = ({ ctx, size: S, t, phase, depthT }) => {
  // A real logarithmic spiral: the radius multiplies by W every turn, which is
  // what gives a nautilus its off-centre roundness and the step at the aperture
  // where the body whorl begins. The visible flank IS the outer whorl, so its
  // growth stripes span exactly one turn and everything older is buried.
  const W = 3.05;
  const b = Math.log(W) / (2 * Math.PI);
  const R1 = 0.35 * S; // radius at the aperture
  const cx = -0.15 * S;
  const cy = -0.115 * S;
  // Aperture bearing chosen so the shell hangs above and behind while the head
  // emerges forward from beneath it — the pose a nautilus actually holds.
  const th1 = -1.25;
  const R = (th: number): number => R1 * Math.exp(b * (th - th1));
  const P = (th: number, r: number): Pt => ({
    x: cx + Math.cos(th) * r,
    y: cy - Math.sin(th) * r,
  });

  const drift = t * 0.9 + phase;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Slow hang-and-sway; a nautilus hovers rather than swims.
  ctx.rotate(Math.sin(t * 0.45 + phase) * 0.05);
  ctx.translate(0, Math.sin(t * 0.62 + phase * 1.3) * 0.012 * S);

  const apOut = P(th1, R1);
  const apIn = P(th1 - 2 * Math.PI, R1 / W);
  const head = { x: 0.2 * S, y: 0.125 * S }; // where the tentacle crown sits

  // -- jet funnel (hyponome) under the head, aimed astern. It pulses.
  {
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.0 + phase * 1.7);
    ctx.save();
    ctx.translate(0.115 * S, 0.236 * S);
    ctx.rotate(3.02);
    // A short muscular nozzle that narrows as it squeezes.
    const squeeze = 1 - pulse * 0.3;
    ctx.beginPath();
    ctx.moveTo(-0.01 * S, -0.036 * S);
    ctx.quadraticCurveTo(0.05 * S, -0.031 * S * squeeze, 0.085 * S, -0.016 * S * squeeze);
    ctx.quadraticCurveTo(0.094 * S, 0, 0.085 * S, 0.016 * S * squeeze);
    ctx.quadraticCurveTo(0.05 * S, 0.034 * S * squeeze, -0.01 * S, 0.038 * S);
    ctx.closePath();
    const jg = ctx.createLinearGradient(0, -0.036 * S, 0, 0.038 * S);
    jg.addColorStop(0, col([186, 144, 120], depthT));
    jg.addColorStop(1, col([132, 92, 74], depthT));
    ctx.fillStyle = jg;
    ctx.fill();
    // Dark mouth of the funnel, so it reads as a tube rather than a ledge.
    ctx.beginPath();
    ctx.ellipse(0.088 * S, 0, 0.008 * S, 0.016 * S * squeeze, 0, 0, Math.PI * 2);
    ctx.fillStyle = col([58, 34, 26], depthT, 0.8);
    ctx.fill();
    // The jet itself: a faint pulse of moved water.
    ctx.beginPath();
    ctx.moveTo(0.095 * S, -0.016 * S);
    ctx.quadraticCurveTo(0.22 * S, 0, 0.095 * S, 0.016 * S);
    ctx.fillStyle = `rgba(206,234,240,${0.2 * pulse})`;
    ctx.fill();
    ctx.restore();
  }

  // -- tentacles: dozens of cirri, drifting out of the crown.
  const tentacle = (
    i: number,
    a: number,
    len: number,
    w: number,
    r0: number,
    colr: RGB,
    alpha: number,
  ): void => {
    const wob = Math.sin(drift * 1.1 + i * 0.9) * 0.28 + Math.sin(drift * 0.55 + i * 1.7) * 0.15;
    const ox = head.x + Math.cos(a) * r0;
    const oy = head.y + Math.sin(a) * r0;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.quadraticCurveTo(
      ox + Math.cos(a + wob * 0.3) * len * 0.55,
      oy + Math.sin(a + wob * 0.3) * len * 0.55,
      ox + Math.cos(a + wob * 0.85) * len,
      oy + Math.sin(a + wob * 0.85) * len,
    );
    ctx.strokeStyle = col(colr, depthT, alpha);
    ctx.lineWidth = w;
    ctx.stroke();
  };
  for (let i = 0; i < 11; i++) {
    // Short inner cirri, darker, packed around the mouth.
    const a = -0.3 + (i / 10) * 1.6;
    tentacle(i + 40, a, (0.08 + hash(i * 2.3) * 0.05) * S, 0.012 * S, 0.015 * S, [176, 120, 96], 0.9);
  }
  for (let i = 0; i < 21; i++) {
    const k = i / 20;
    const a = -0.6 + k * 1.95;
    // Uneven lengths: a crown of cirri never sits flush.
    const len = (0.13 + 0.06 * Math.sin(k * Math.PI) + hash(i * 4.2) * 0.075) * S;
    tentacle(i, a, len, (0.014 - hash(i * 1.7) * 0.004) * S, 0.042 * S, [232, 200, 172], 0.88);
  }

  // -- head: the soft body filling and spilling out of the aperture.
  {
    ctx.beginPath();
    ctx.moveTo(apIn.x, apIn.y);
    ctx.quadraticCurveTo(0.11 * S, -0.01 * S, 0.225 * S, 0.078 * S);
    ctx.quadraticCurveTo(0.245 * S, 0.19 * S, 0.08 * S, 0.235 * S);
    ctx.quadraticCurveTo(0.0 * S, 0.242 * S, apOut.x, apOut.y);
    ctx.closePath();
    // Lit across the upper flank, shadowed underneath: without the shading the
    // head, the funnel and the shell lip merge into one cream slab.
    const hg = ctx.createLinearGradient(0, -0.02 * S, 0, 0.25 * S);
    hg.addColorStop(0, col([236, 208, 182], depthT));
    hg.addColorStop(0.4, col([228, 196, 168], depthT));
    hg.addColorStop(0.78, col([186, 148, 124], depthT));
    hg.addColorStop(1, col([140, 102, 84], depthT));
    ctx.fillStyle = hg;
    ctx.fill();
    // Contact shadow along the ventral edge.
    ctx.beginPath();
    ctx.moveTo(0.2 * S, 0.212 * S);
    ctx.quadraticCurveTo(0.08 * S, 0.252 * S, apOut.x + 0.005 * S, apOut.y + 0.004 * S);
    ctx.strokeStyle = col([96, 62, 48], depthT, 0.3);
    ctx.lineWidth = 0.018 * S;
    ctx.stroke();
  }

  // -- the hood: a thick leathery lid over the whole top of the head, which is
  //    what plugs the aperture when the animal pulls in. Mottled dark red.
  {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(apIn.x, apIn.y);
    ctx.quadraticCurveTo(0.12 * S, -0.014 * S, 0.228 * S, 0.082 * S);
    ctx.quadraticCurveTo(0.222 * S, 0.132 * S, 0.16 * S, 0.146 * S);
    ctx.quadraticCurveTo(0.05 * S, 0.135 * S, -0.04 * S, 0.09 * S);
    ctx.quadraticCurveTo(-0.09 * S, 0.055 * S, apIn.x, apIn.y);
    ctx.closePath();
    ctx.fillStyle = col([130, 70, 46], depthT);
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = col([76, 38, 26], depthT, 0.5);
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      ctx.arc(
        (-0.05 + hash(i * 3.7) * 0.28) * S,
        (0.0 + hash(i * 8.3) * 0.11) * S,
        (0.007 + hash(i * 5.1) * 0.014) * S,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    // Pale rim along the hood's lower margin.
    ctx.beginPath();
    ctx.moveTo(0.228 * S, 0.086 * S);
    ctx.quadraticCurveTo(0.16 * S, 0.15 * S, -0.04 * S, 0.094 * S);
    ctx.strokeStyle = col([214, 168, 140], depthT, 0.5);
    ctx.lineWidth = 0.014 * S;
    ctx.stroke();
    ctx.restore();
  }

  // Shadow cast by the shell lip across the soft parts. The outer half is
  // painted over by the shell a moment later, leaving only the part that reads
  // as the head sitting down inside the aperture.
  ctx.beginPath();
  ctx.moveTo(apOut.x, apOut.y);
  ctx.lineTo(apIn.x, apIn.y);
  ctx.strokeStyle = col([78, 46, 32], depthT, 0.3);
  ctx.lineWidth = 0.06 * S;
  ctx.stroke();

  // Pinhole eye — an open cup flooded with seawater, no lens at all.
  {
    const ex = 0.196 * S;
    const ey = 0.152 * S;
    ctx.beginPath();
    ctx.arc(ex, ey, 0.028 * S, 0, Math.PI * 2);
    ctx.fillStyle = col([206, 168, 140], depthT);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex, ey, 0.014 * S, 0, Math.PI * 2);
    ctx.fillStyle = col([20, 16, 16], depthT);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex - 0.004 * S, ey - 0.005 * S, 0.004 * S, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fill();
  }

  // -- the shell, laid over the head so the aperture reads as an opening the
  //    animal is coming out of.
  const turns = 2.9;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  for (let th = th1 - turns * 2 * Math.PI; th <= th1 + 1e-6; th += 0.05) {
    const p = P(th, R(th));
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();

  const sg = ctx.createRadialGradient(
    cx - 0.06 * S,
    cy - 0.12 * S,
    0.02 * S,
    cx,
    cy,
    R1 * 1.1,
  );
  sg.addColorStop(0, col([252, 246, 232], depthT));
  sg.addColorStop(0.5, col([244, 232, 210], depthT));
  sg.addColorStop(1, col([198, 180, 152], depthT));
  ctx.fillStyle = sg;
  ctx.fill();

  ctx.save();
  ctx.clip();

  // Growth stripes: one full turn of them, brown flames over the outer flank,
  // fading out before the white umbilical area.
  const stripes = 26;
  for (let i = 0; i < stripes; i++) {
    // Jittered spacing and width, and a slight wave down each flame: evenly
    // spaced wedges read as a pinwheel, not a shell.
    const th = th1 - 2 * Math.PI * ((i + 0.35 + hash(i * 1.9) * 0.4) / stripes);
    const rOut = R(th) * 1.03;
    const rIn = rOut * (0.38 + hash(i * 3.3) * 0.16);
    const hw = 0.042 + hash(i * 6.1) * 0.026;
    const outer: Pt[] = [];
    const inner: Pt[] = [];
    for (let j = 0; j <= 10; j++) {
      const k = j / 10;
      const r = rIn + (rOut - rIn) * k;
      const a = th - 0.1 * k * k + Math.sin(k * 3.4 + i) * 0.016;
      const w = hw * smooth(Math.min(1, k * 1.9));
      outer.push(P(a + w, r));
      inner.push(P(a - w, r));
    }
    ctx.beginPath();
    polyPath(ctx, outer.concat(inner.reverse()), true);
    ctx.fillStyle = col(i % 3 === 0 ? [102, 48, 28] : [142, 78, 44], depthT, 0.88);
    ctx.fill();
  }

  // Chamber divisions: fewer, finer, embossed sutures sweeping to the rim.
  const chambers = 9;
  for (let i = 0; i <= chambers; i++) {
    const th = th1 - 2 * Math.PI * (i / chambers);
    const rOut = R(th) * 1.02;
    const pts: Pt[] = [];
    for (let j = 0; j <= 8; j++) {
      const k = j / 8;
      // Stop well short of the pole: sutures that all meet in the middle turn
      // the shell into a wagon wheel.
      pts.push(P(th - 0.22 * k * k, rOut * (0.26 + 0.74 * k)));
    }
    ctx.beginPath();
    polyPath(ctx, pts, false);
    ctx.strokeStyle = col([104, 82, 58], depthT, 0.28);
    ctx.lineWidth = 0.011 * S;
    ctx.stroke();
    ctx.beginPath();
    polyPath(
      ctx,
      pts.map((p) => ({ x: p.x + 0.005 * S, y: p.y + 0.006 * S })),
      false,
    );
    ctx.strokeStyle = col([255, 250, 234], depthT, 0.34);
    ctx.lineWidth = 0.007 * S;
    ctx.stroke();
  }

  // Umbilical dimple, and the shadow of the outer whorl riding over the one
  // before it — without that the spiral flattens into a disc.
  {
    const ug = ctx.createRadialGradient(cx, cy, 0, cx, cy, R1 * 0.1);
    ug.addColorStop(0, col([158, 132, 100], depthT, 0.5));
    ug.addColorStop(1, col([158, 132, 100], depthT, 0));
    ctx.beginPath();
    ctx.arc(cx, cy, R1 * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = ug;
    ctx.fill();
  }
  ctx.beginPath();
  for (let th = th1 - 2 * Math.PI; th >= th1 - 2 * Math.PI - 2.2; th -= 0.05) {
    const p = P(th, R(th));
    if (th > th1 - 2 * Math.PI - 0.06) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = col([126, 104, 76], depthT, 0.16);
  ctx.lineWidth = 0.02 * S;
  ctx.stroke();

  ctx.restore(); // end shell clip

  // Outer rim: a thin keel line around the venter, and the aperture lip.
  ctx.beginPath();
  for (let th = th1 - 2 * Math.PI * 1.05; th <= th1 + 1e-6; th += 0.05) {
    const p = P(th, R(th));
    if (th <= th1 - 2 * Math.PI * 1.05 + 0.06) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = col([124, 98, 66], depthT, 0.45);
  ctx.lineWidth = 0.012 * S;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(apOut.x, apOut.y);
  ctx.lineTo(apIn.x, apIn.y);
  ctx.strokeStyle = col([164, 132, 94], depthT, 0.55);
  ctx.lineWidth = 0.014 * S;
  ctx.stroke();

  ctx.restore();
};

export const TROPHY_ART: Record<string, FishArt> = {
  'reef-shark': reefShark,
  whale,
  nautilus,
};
