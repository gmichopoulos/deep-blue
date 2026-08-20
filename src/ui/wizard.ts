import * as U from './units';
import { CONFIG } from '../config';
import { drawDiverSprite } from '../world/render';
import { FISH_ART } from '../world/art';
import { speciesById } from '../world/species';
/**
 * Onboarding wizard — the slides that orient a non-diver before their first dive.
 * Slide count comes from SLIDE_COUNT; the copy inside them follows the unit choice.
 *
 * Owns nothing but the overlay element it is handed. Uses Agent C's `.panel`,
 * `.btn`, `.btn-primary` classes and palette custom properties; every extra rule
 * it needs is injected once, namespaced under `.wizard`.
 */

const STORAGE_KEY = 'deepblue.wizard.seen.v1';
const STYLE_ID = 'wizard-styles';

export function hasSeenWizard(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* private mode — just re-show the wizard next time */
  }
}

// ---------------------------------------------------------------- slide content

interface Slide {
  title: string;
  /** Under ~60 words. The game does the teaching; this just orients. */
  body: string;
  /** One sentence: what it means for how you play. */
  takeaway: string;
  /** Inline SVG, 320×180 viewBox. */
  art: string;
  /** Optional extra HTML under the body (used for the control keycaps). */
  extra?: string;
  /** Called after `art` is inserted, for slides that paint a live canvas. */
  onMount?: (host: HTMLElement) => void;
}

/** Slide count is fixed; only the wording inside them varies with units. */
const SLIDE_COUNT = 8;

/** Animation clock the wizard's static diver is posed at. */
const POSE_T = 1.1;

function buildSlides(): Slide[] {
  // Local shorthands keep the copy readable.
  const d = (m: number, dec = 0) => U.teach(m, dec);
  const amb = (bar: number) => `${bar} ${U.getUnits() === 'metric' ? 'bar' : 'ata'}`;
  const rate = (mpm: number) => U.rate(mpm, 0);
  const unitWord = U.getUnits() === 'metric' ? 'metres' : 'feet';
  return [
  {
    title: 'Deep Blue',
    body:
      'A diving game about the one trade-off every diver makes: the interesting animals are deep, ' +
      'and deep costs you air, bottom time and a longer way back up. Nothing here is memorised — ' +
      'you learn the science by feeling it push back.',
    takeaway: `${SLIDE_COUNT - 1} short screens, then you are in the water. None of this is a test.`,
    art: `<svg viewBox="0 0 320 180" role="img" aria-label="The Deep Blue title over a lit water column fading into darkness">
      <defs>
        <linearGradient id="wz-hero" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#6fd3ee"/><stop offset="0.45" stop-color="#166a96"/>
          <stop offset="1" stop-color="#03192c"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="320" height="180" rx="6" fill="url(#wz-hero)"/>
      <g fill="#eaf7ff" opacity="0.16">
        <path d="M40 0 l26 0 -46 180 -26 0 Z"/><path d="M150 0 l34 0 -52 180 -34 0 Z"/>
        <path d="M258 0 l22 0 -40 180 -22 0 Z"/>
      </g>
      <text x="160" y="78" text-anchor="middle" font-size="34" font-weight="800"
            fill="#f2fbff" letter-spacing="1">DEEP BLUE</text>
      <text x="160" y="99" text-anchor="middle" font-size="10.5" fill="#bfe6f5"
            letter-spacing="3">LEARN TO DIVE BY DIVING</text>
      <g fill="#04121c" opacity="0.32"><ellipse cx="160" cy="176" rx="150" ry="12"/></g>
    </svg>`,
  },
  {
    title: 'Which units do you think in?',
    body:
      'Diving is taught in two systems, and which one you learn is mostly an accident of ' +
      'geography. Pick whichever feels more intuitive — you can switch any time from the toggle ' +
      'above the gauges.',
    takeaway: 'The physics is identical either way. Only the labels change.',
    extra: `<div class="wz-units" data-units>
        <button type="button" class="btn wz-unit" data-unit="metric">
          <strong>Metres &amp; bar</strong>
          <em>Used almost everywhere. Depth in metres ÷ 10 is the added pressure in bar.</em>
        </button>
        <button type="button" class="btn wz-unit" data-unit="imperial">
          <strong>Feet &amp; psi</strong>
          <em>Standard in the US. A full tank reads ~3000 psi; the depth limit is 130 ft.</em>
        </button>
      </div>`,
    art: `<svg viewBox="0 0 320 180" role="img" aria-label="The same dive shown in metres and bar alongside feet and psi">
      <defs>
        <linearGradient id="wz-u" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#3fa9c9"/><stop offset="1" stop-color="#052540"/>
        </linearGradient>
      </defs>
      <rect x="10" y="18" width="300" height="148" rx="6" fill="url(#wz-u)"/>
      <g stroke="#eaf7ff" stroke-width="1" opacity="0.35">
        <line x1="160" y1="22" x2="160" y2="162"/>
        <line x1="14" y1="52" x2="306" y2="52"/><line x1="14" y1="98" x2="306" y2="98"/>
        <line x1="14" y1="144" x2="306" y2="144"/>
      </g>
      <g font-size="11" font-weight="700" fill="#eaf7ff" text-anchor="end">
        <text x="150" y="42">0 m · 1 bar</text>
        <text x="150" y="88">10 m · 2 bar</text>
        <text x="150" y="134">40 m · 5 bar</text>
      </g>
      <g font-size="11" font-weight="700" fill="#ffd9a0">
        <text x="172" y="42">0 ft · 15 psi</text>
        <text x="172" y="88">33 ft · 29 psi</text>
        <text x="172" y="134">130 ft · 73 psi</text>
      </g>
      <text x="86" y="160" font-size="9.5" fill="#9fb3c4" text-anchor="middle">metric</text>
      <text x="234" y="160" font-size="9.5" fill="#9fb3c4" text-anchor="middle">imperial</text>
      <text x="160" y="14" font-size="9.5" fill="#7e9bb1" text-anchor="middle">the same water, two vocabularies</text>
    </svg>`,
  },
  {
    title: 'You are the diver',
    body:
      'You swim the length of a reef at a steady pace. Get close to a fish to log it — the rare, ' +
      'high-scoring ones live deep. Then come back to the surface alive. That last part is the hard one.',
    takeaway: 'The points are down there. So is everything that can go wrong.',
    art: `<canvas class="wz-canvas" width="640" height="360"
      role="img" aria-label="The diver in the water column with a shallow fish and a rarer deep one"></canvas>`,
    onMount: (host) => {
      // The real diver and the real fish art, so the wizard cannot drift out of
      // sync with what the player is about to see.
      const c = host.querySelector('canvas');
      const g = c?.getContext('2d');
      if (!c || !g) return;
      const W = c.width;
      const H = c.height;
      g.setTransform(2, 0, 0, 2, 0, 0); // draw in CSS pixels on a 2x buffer
      const w = W / 2;
      const h = H / 2;

      const water = g.createLinearGradient(0, 0, 0, h);
      water.addColorStop(0, '#5fc2dd');
      water.addColorStop(0.45, '#1a6f97');
      water.addColorStop(1, '#04203a');
      g.fillStyle = water;
      g.fillRect(0, 0, w, h);

      g.fillStyle = 'rgba(233,255,255,0.75)';
      g.fillRect(0, 0, w, 7);
      g.fillStyle = '#123f33';
      g.fillRect(0, h - 12, w, 12);

      const fish = (id: string, x: number, y: number, scale: number, flip: boolean) => {
        const sp = speciesById(id);
        const art = FISH_ART[id];
        if (!sp || !art) return;
        g.save();
        g.translate(x, y);
        g.scale(flip ? -scale : scale, scale);
        art({ ctx: g, size: sp.size, t: 1.4, phase: x * 0.13, depthT: y / h });
        g.restore();
      };
      fish('clownfish', 60, 42, 1.5, true);
      fish('sea-turtle', 252, 50, 1.3, false);
      fish('octopus', 232, 128, 1.6, true);

      g.save();
      g.translate(122, 92);
      drawDiverSprite(g, POSE_T); // animation clock, not a scale factor
      g.restore();

      g.font = '700 11px system-ui, sans-serif';
      g.fillStyle = '#ffd9a0';
      g.textAlign = 'center';
      g.fillText('rare · big points', 232, 158);
      g.textAlign = 'left';
      g.fillStyle = 'rgba(234,247,255,0.9)';
      g.font = '10px system-ui, sans-serif';
      g.fillText(d(0), 8, 20);
      g.fillText(d(CONFIG.seabedM), 8, h - 18);
    },
    extra: `<div class="wz-keys">
        <span class="wz-key">↑</span><span class="wz-key">W</span><em>hold to ascend</em>
        <span class="wz-key">↓</span><span class="wz-key">S</span><em>hold to descend</em>
        <span class="wz-key wz-key--wide">Space</span><em>pause</em>
      </div>
      <p class="wz-note">Let go and you hold your depth. You never steer forward — the reef comes to you.</p>
      <p class="wz-note">A species pays less every time you log it again, down to a single point, and a
        dive that finds many different animals scores a multiplier. Variety and depth beat counting the
        same fish twice.</p>`,
  },
  {
    title: `The first ${d(10)} are the big ones`,
    body:
      `At the surface you carry ${amb(1)}. At ${d(10)} it is ${amb(2)} — the pressure on you has ` +
      `doubled and any trapped air has halved. At ${d(40)} it is ${amb(5)}. Nothing later in the ` +
      `dive changes as fast as that first ${d(10)} does.`,
    takeaway: 'Pressure climbs in a straight line, but it hurts most where it doubles.',
    art: `<svg viewBox="0 0 320 180" role="img" aria-label="1 bar at the surface, 2 bar at 10 metres, 5 bar at 40 metres, with a bubble of air shrinking as the pressure rises">
      <defs>
        <linearGradient id="wz-col2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#57bfdd"/><stop offset="1" stop-color="#04203a"/>
        </linearGradient>
      </defs>
      <rect x="10" y="14" width="16" height="156" rx="4" fill="url(#wz-col2)"/>
      <g stroke="#eaf7ff" stroke-width="1.4" opacity="0.7">
        <line x1="10" y1="30" x2="30" y2="30"/><line x1="10" y1="86" x2="30" y2="86"/><line x1="10" y1="150" x2="30" y2="150"/>
      </g>
      <path d="M22 40 v34" stroke="#ffb636" stroke-width="2" marker-end=""/>
      <path d="M18 68 l4 8 l4 -8" fill="none" stroke="#ffb636" stroke-width="2"/>

      <g font-size="12" font-weight="700" fill="#e9f6ff">
        <text x="38" y="34">${d(0)}</text><text x="38" y="90">${d(10)}</text><text x="38" y="154">${d(40)}</text>
      </g>
      <g fill="#cdeeff" opacity="0.95" stroke="#eaf7ff" stroke-width="1.1">
        <circle cx="96" cy="30" r="15"/><circle cx="96" cy="86" r="11.9"/><circle cx="96" cy="150" r="8.8"/>
      </g>
      <g font-size="14" font-weight="800">
        <text x="122" y="34" fill="#9fe8ff">${amb(1)}</text>
        <text x="122" y="90" fill="#ffb636">${amb(2)}</text>
        <text x="122" y="154" fill="#ff6b5a">${amb(5)}</text>
      </g>
      <g font-size="9" fill="#9fb3c4">
        <text x="170" y="34">what you feel on land</text>
        <text x="170" y="90">pressure doubled · air halved</text>
        <text x="170" y="154">pressure ×5 · air cut to a fifth</text>
      </g>
      <text x="170" y="103" font-size="9" font-weight="700" fill="#ffb636">${d(10)} of water did that</text>
      <text x="170" y="167" font-size="9" fill="#7e9bb1">the next ${d(30)}: only ×2.5 more</text>
    </svg>`,
  },
  {
    title: 'Depth eats your air',
    body:
      'You breathe the same volume every minute at any depth — but down there each lungful is ' +
      `compressed. At ${d(30)} the ambient pressure is ${amb(4)}, so the identical breath drains four times ` +
      'as much from the tank. Same diver, same effort, quarter of the dive.',
    takeaway: `${U.reserveLabel()} is your reserve — plan to start ascending long before you reach it.`,
    art: `<svg viewBox="0 0 320 180" role="img" aria-label="Two tanks after twenty minutes: nearly full at the surface, under half at thirty metres">
      <defs>
        <linearGradient id="wz-gas" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#4fd1b1"/><stop offset="1" stop-color="#1e8f79"/>
        </linearGradient>
        <linearGradient id="wz-gas2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ff9d6b"/><stop offset="1" stop-color="#d1503a"/>
        </linearGradient>
      </defs>
      <text x="160" y="14" text-anchor="middle" font-size="11" fill="#9fb3c4">the same tank, after the same 20 minutes</text>

      <g transform="translate(46 26)">
        <rect x="18" y="-8" width="12" height="10" rx="2" fill="#8fa3b3"/>
        <rect x="0" y="0" width="48" height="118" rx="16" fill="#0d2233" stroke="#48627a" stroke-width="2"/>
        <rect x="4" y="20" width="40" height="94" rx="12" fill="url(#wz-gas)"/>
        <text x="24" y="76" text-anchor="middle" font-size="15" font-weight="800" fill="#04203a">${U.tankPressureNum(171)}</text>
        <text x="24" y="90" text-anchor="middle" font-size="9" font-weight="700" fill="#04203a">${U.pressureUnit()}</text>
        <text x="24" y="136" text-anchor="middle" font-size="11" fill="#eaf7ff" font-weight="700">at the surface</text>
        <text x="24" y="150" text-anchor="middle" font-size="10" fill="#9fb3c4">${amb(1)} · normal breathing</text>
      </g>

      <g transform="translate(206 26)">
        <rect x="18" y="-8" width="12" height="10" rx="2" fill="#8fa3b3"/>
        <rect x="0" y="0" width="48" height="118" rx="16" fill="#0d2233" stroke="#48627a" stroke-width="2"/>
        <rect x="4" y="63" width="40" height="51" rx="12" fill="url(#wz-gas2)"/>
        <text x="24" y="94" text-anchor="middle" font-size="15" font-weight="800" fill="#2a0d06">${U.tankPressureNum(85)}</text>
        <text x="24" y="106" text-anchor="middle" font-size="9" font-weight="700" fill="#2a0d06">${U.pressureUnit()}</text>
        <text x="24" y="136" text-anchor="middle" font-size="11" fill="#eaf7ff" font-weight="700">at ${d(30)}</text>
        <text x="24" y="150" text-anchor="middle" font-size="10" fill="#ff9d6b">${amb(4)} · 4× the gas</text>
      </g>

      <g transform="translate(160 84)">
        <text x="0" y="-14" text-anchor="middle" font-size="22" font-weight="800" fill="#ff9d6b">4×</text>
        <text x="0" y="2" text-anchor="middle" font-size="10" fill="#9fb3c4">the gas</text>
        <text x="0" y="14" text-anchor="middle" font-size="10" fill="#9fb3c4">per breath</text>
        <path d="M-28 -22 L-44 -22" stroke="#48627a" stroke-width="1.5"/>
        <path d="M28 -22 L44 -22" stroke="#48627a" stroke-width="1.5"/>
      </g>
    </svg>`,
  },
  {
    title: 'Nitrogen loads up',
    body:
      'Under pressure your body dissolves nitrogen out of the air you breathe, and it dissolves faster ' +
      'the deeper you go. The no-decompression limit — the game calls it your no-stop time — is how long ' +
      'you may stay before you owe a stop on the way up. It is a budget, and depth spends it fast.',
    takeaway: 'Watch your no-stop clock. When it runs short, go shallower — shallow water refills it.',
    art: `<svg viewBox="0 0 320 180" role="img" aria-label="Bar chart of no-decompression limits: about 60 minutes at 18 metres, 20 at 30 metres, 9 at 40 metres">
      <text x="8" y="14" font-size="11" fill="#9fb3c4">no-decompression limit, minutes</text>
      <g transform="translate(0 26)">
        <g transform="translate(0 0)">
          <text x="46" y="16" text-anchor="end" font-size="12" font-weight="700" fill="#eaf7ff">${d(18)}</text>
          <rect x="54" y="3" width="200" height="18" rx="5" fill="#4fd1b1"/>
          <text x="262" y="17" font-size="12" font-weight="800" fill="#4fd1b1">60</text>
        </g>
        <g transform="translate(0 44)">
          <text x="46" y="16" text-anchor="end" font-size="12" font-weight="700" fill="#eaf7ff">${d(30)}</text>
          <rect x="54" y="3" width="67" height="18" rx="5" fill="#ffb636"/>
          <text x="129" y="17" font-size="12" font-weight="800" fill="#ffb636">20</text>
        </g>
        <g transform="translate(0 88)">
          <text x="46" y="16" text-anchor="end" font-size="12" font-weight="700" fill="#eaf7ff">${d(40)}</text>
          <rect x="54" y="3" width="30" height="18" rx="5" fill="#ff6b5a"/>
          <text x="92" y="17" font-size="12" font-weight="800" fill="#ff6b5a">9</text>
        </g>
        <line x1="54" y1="-2" x2="54" y2="114" stroke="#48627a" stroke-width="1.5"/>
        <path d="M256 6 q 4 44 -168 98" fill="none" stroke="#48627a" stroke-width="1.5" stroke-dasharray="4 4"/>
      </g>
      <text x="168" y="172" text-anchor="middle" font-size="10" fill="#9fb3c4">${d(22)} deeper costs 51 of those minutes</text>
    </svg>`,
  },
  {
    title: 'Coming up is the risky part',
    body:
      'Dissolved nitrogen leaves you the way carbonation leaves a bottle. Open it slowly and it fizzes ' +
      'off gently; crack it fast and it foams over — in your bloodstream, causing decompression ' +
      `sickness. It can mean joint pain, or nerve damage that does not fully heal, and the only ` +
      `treatment is a hyperbaric chamber. So never come up faster than ${rate(CONFIG.maxAscentRateMpm)}.`,
    takeaway: `The last ${d(10)} deserve more patience than the first ${d(30)}.`,
    art: `<svg viewBox="0 0 320 180" role="img" aria-label="A bottle opened slowly fizzes gently while one cracked open fast foams over">
      <g transform="translate(52 42)">
        <path d="M30 12 h24 v10 l10 16 v66 a8 8 0 0 1 -8 8 h-28 a8 8 0 0 1 -8 -8 v-66 l10 -16 Z" fill="#0d2233" stroke="#4fd1b1" stroke-width="2"/>
        <path d="M22 62 h44 v40 a8 8 0 0 1 -8 8 h-28 a8 8 0 0 1 -8 -8 Z" fill="#1e8f79" opacity="0.55"/>
        <g fill="#cdeeff" opacity="0.9"><circle cx="36" cy="80" r="2"/><circle cx="48" cy="72" r="1.6"/><circle cx="42" cy="94" r="1.8"/><circle cx="42" cy="2" r="2"/><circle cx="38" cy="-8" r="1.5"/></g>
        <text x="42" y="126" text-anchor="middle" font-size="10" fill="#4fd1b1" font-weight="700">opened slowly</text>
      </g>
      <g transform="translate(136 42)">
        <path d="M30 12 h24 v10 l10 16 v66 a8 8 0 0 1 -8 8 h-28 a8 8 0 0 1 -8 -8 v-66 l10 -16 Z" fill="#0d2233" stroke="#ff6b5a" stroke-width="2"/>
        <path d="M22 62 h44 v40 a8 8 0 0 1 -8 8 h-28 a8 8 0 0 1 -8 -8 Z" fill="#d1503a" opacity="0.5"/>
        <g fill="#ffd9cf"><circle cx="42" cy="2" r="5"/><circle cx="31" cy="-6" r="4"/><circle cx="53" cy="-7" r="4.5"/><circle cx="24" cy="-15" r="3"/><circle cx="60" cy="-16" r="3.4"/><circle cx="42" cy="-19" r="3.8"/><circle cx="48" cy="-28" r="2.6"/><circle cx="34" cy="-29" r="2.2"/></g>
        <g fill="#ffd9cf" opacity="0.85"><circle cx="36" cy="76" r="2.6"/><circle cx="50" cy="84" r="2.2"/><circle cx="42" cy="66" r="2.4"/></g>
        <text x="42" y="126" text-anchor="middle" font-size="10" fill="#ff6b5a" font-weight="700">cracked fast</text>
      </g>
    </svg>`,
  },
  {
    title: 'Finish with a safety stop',
    body:
      `Before you surface, pause for three minutes at about ${d(CONFIG.safetyStop.depthM)}. Nothing has gone wrong when you ` +
      'do this — it is routine insurance on every dive, not a rescue. Pressure changes fastest in ' +
      `those last few ${unitWord}, which is exactly where nitrogen is most likely to come out of ` +
      'solution, so the pause lets your blood carry it to your lungs instead.',
    takeaway: `Three minutes and a little gas. This game gives you points for it.`,
    art: `<svg viewBox="0 0 320 180" role="img" aria-label="A dive profile rising from the bottom at nine metres per minute, pausing three minutes at five metres, then surfacing">
      <defs>
        <linearGradient id="wz-ss" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#2e88ad"/><stop offset="1" stop-color="#06243c"/>
        </linearGradient>
      </defs>
      <rect x="10" y="20" width="300" height="146" rx="5" fill="url(#wz-ss)"/>
      <path d="M10 22 q 18 -5 36 0 t 36 0 t 36 0 t 36 0 t 36 0 t 36 0 t 36 0 t 36 0"
            fill="none" stroke="#cdf3ff" stroke-width="2" opacity="0.9"/>

      <!-- the stop window, pushed deeper so the label above it has room -->
      <rect x="10" y="52" width="300" height="16" fill="#4fd1b1" opacity="0.18"/>
      <line x1="10" y1="60" x2="310" y2="60" stroke="#4fd1b1" stroke-width="1"
            stroke-dasharray="4 4" opacity="0.85"/>

      <!-- the profile: up from the bottom, hold, then out -->
      <path d="M22 158 L150 60" fill="none" stroke="#9fe8ff" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M150 60 H244" fill="none" stroke="#4fd1b1" stroke-width="4.5" stroke-linecap="round"/>
      <path d="M244 60 L286 25" fill="none" stroke="#9fe8ff" stroke-width="2.5" stroke-linecap="round"/>

      <g font-size="9.5" fill="#9fb3c4">
        <text x="14" y="17">${d(0)} — the surface</text>
        <text x="14" y="163">the bottom</text>
      </g>
      <text x="14" y="48" font-size="9.5" font-weight="700" fill="#4fd1b1">${d(CONFIG.safetyStop.depthM)}</text>
      <text x="197" y="44" font-size="11" text-anchor="middle" font-weight="800" fill="#4fd1b1">wait 3 minutes here</text>
      <text x="74" y="112" font-size="9.5" fill="#9fe8ff" transform="rotate(-38 74 112)">up at ${rate(CONFIG.maxAscentRateMpm)}</text>
      <text x="292" y="19" font-size="9.5" fill="#9fe8ff" text-anchor="end">then surface</text>
    </svg>`,
  },
  ];
}

// ---------------------------------------------------------------- styles

const CSS = `
.wizard{width:100%;display:flex;justify-content:center;outline:none;
  font-family:var(--font-ui,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);
  color:var(--ink,#e9f6ff)}
.wizard *{box-sizing:border-box}
.wizard .wz-panel{max-width:780px;width:min(780px,100%);padding:20px 22px 16px;
  display:flex;flex-direction:column;gap:13px;line-height:1.45}
.wizard .wz-top{display:flex;align-items:center;gap:12px}
.wizard .wz-kicker{font-size:11px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--muted,#7e9bb1);font-weight:700}
.wizard .wz-dots{display:flex;gap:6px;margin-left:auto}
.wizard .wz-dot{width:9px;height:9px;border-radius:50%;border:0;padding:0;cursor:pointer;
  background:var(--muted,#7e9bb1);opacity:.35;transition:opacity .15s,transform .15s}
.wizard .wz-dot:hover{opacity:.7}
.wizard .wz-dot[aria-current="true"]{opacity:1;transform:scale(1.25);
  background:var(--accent,#3fe0d8)}
.wizard .wz-skip{background:none;border:0;color:var(--muted,#7e9bb1);font:inherit;font-size:12px;
  cursor:pointer;text-decoration:underline;text-underline-offset:3px;padding:2px 4px}
.wizard .wz-skip:hover{color:var(--ink,#e9f6ff)}
.wizard h2{margin:0;font-size:25px;line-height:1.12;letter-spacing:-.015em;color:var(--ink,#e9f6ff)}
.wizard .wz-body{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start}
.wizard .wz-art{background:var(--deep,#05121e);border-radius:var(--radius,10px);padding:8px;
  border:1px solid var(--panel-brd,rgba(120,190,235,.16))}
.wizard .wz-art svg{display:block;width:100%;height:auto}
.wizard .wz-copy p{margin:0 0 10px;font-size:14.5px;line-height:1.5;color:var(--ink-dim,#b7cede)}
.wizard .wz-take{margin:0;padding:9px 12px;border-left:3px solid var(--accent,#3fe0d8);
  background:var(--accent-dim,rgba(63,224,216,.16));border-radius:0 6px 6px 0;
  font-size:13.5px!important;line-height:1.4;font-weight:650;color:var(--accent,#3fe0d8)!important}
.wizard .wz-keys{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 10px}
.wizard .wz-keys em{font-style:normal;font-size:12px;color:var(--muted,#7e9bb1);margin-right:10px}
.wizard .wz-key{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;
  padding:0 6px;border-radius:5px;font-size:12px;font-weight:700;color:var(--ink,#e9f6ff);
  background:rgba(255,255,255,.07);border:1px solid var(--panel-brd-strong,rgba(120,190,235,.34));
  border-bottom-width:2px}
.wizard .wz-key--wide{min-width:52px}
.wizard .wz-note{font-size:12px!important;color:var(--muted,#7e9bb1)!important}
.wizard .wz-foot{display:flex;align-items:center;gap:10px;padding-top:12px;
  border-top:1px solid var(--panel-brd,rgba(120,190,235,.16))}
.wizard .wz-hint{font-size:11.5px;color:var(--muted-2,#5c778c)}
.wizard .wz-foot .wz-spacer{margin-left:auto}
.wizard .wz-go{animation:wz-go 1.6s ease-out infinite}
@keyframes wz-go{
  0%{box-shadow:0 0 0 0 var(--accent-dim,rgba(63,224,216,.5))}
  70%{box-shadow:0 0 0 8px rgba(63,224,216,0)}
  100%{box-shadow:0 0 0 0 rgba(63,224,216,0)}}
.wizard .wz-fade{animation:wz-in .22s ease-out}
@keyframes wz-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (max-width:640px){
  .wizard .wz-body{grid-template-columns:1fr}
  .wizard h2{font-size:21px}
}
@media (prefers-reduced-motion:reduce){
  .wizard .wz-fade,.wizard .wz-go{animation:none}
}
`;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

// ---------------------------------------------------------------- wizard

/**
 * Mounts the onboarding wizard into `root` (the `#overlay` element) and resolves
 * when the player starts the dive (or skips). Returning players skip it entirely
 * unless `opts.force` is set.
 */
export function runWizard(root: HTMLElement, opts?: { force?: boolean }): Promise<void> {
  if (!opts?.force && hasSeenWizard()) return Promise.resolve();

  injectStyles();
  root.innerHTML = ''; // #overlay:not(:empty) supplies the scrim + pointer events

  const wrap = document.createElement('div');
  wrap.className = 'wizard';
  wrap.tabIndex = -1;
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', 'How diving works');
  wrap.innerHTML = `
    <div class="panel wz-panel">
      <div class="wz-top">
        <span class="wz-kicker" data-kicker></span>
        <button class="wz-skip" data-skip type="button">Skip &amp; dive</button>
        <div class="wz-dots" data-dots></div>
      </div>
      <h2 data-title></h2>
      <div class="wz-body wz-fade" data-fade>
        <div class="wz-art" data-art></div>
        <div class="wz-copy">
          <p data-text></p>
          <div data-extra></div>
          <p class="wz-take" data-take></p>
        </div>
      </div>
      <div class="wz-foot">
        <span class="wz-hint">← → to move · Enter to continue</span>
        <span class="wz-spacer"></span>
        <button class="btn" data-prev type="button">Back</button>
        <button class="btn btn-primary" data-next type="button">Next</button>
      </div>
    </div>`;
  root.appendChild(wrap);

  const q = <T extends HTMLElement>(sel: string): T => wrap.querySelector(sel) as T;
  const elKicker = q('[data-kicker]');
  const elTitle = q('[data-title]');
  const elArt = q('[data-art]');
  const elText = q('[data-text]');
  const elTake = q('[data-take]');
  const elExtra = q('[data-extra]');
  const elFade = q('[data-fade]');
  const elDots = q('[data-dots]');
  const btnPrev = q<HTMLButtonElement>('[data-prev]');
  const btnNext = q<HTMLButtonElement>('[data-next]');
  const btnSkip = q<HTMLButtonElement>('[data-skip]');

  let i = 0;
  const dots = Array.from({ length: SLIDE_COUNT }, (_, n) => {
    const d = document.createElement('button');
    d.className = 'wz-dot';
    d.type = 'button';
    d.setAttribute('aria-label', `Slide ${n + 1}`);
    d.addEventListener('click', () => go(n));
    elDots.appendChild(d);
    return d;
  });

  /** The units slide carries two buttons; keep them in sync with the stored choice. */
  function wireUnitPicker(root: HTMLElement): void {
    const picker = root.querySelector('[data-units]');
    if (!picker) return;
    const paint = () => {
      picker.querySelectorAll<HTMLButtonElement>('[data-unit]').forEach((b) => {
        b.classList.toggle('is-on', b.dataset.unit === U.getUnits());
        b.setAttribute('aria-pressed', String(b.dataset.unit === U.getUnits()));
      });
    };
    picker.querySelectorAll<HTMLButtonElement>('[data-unit]').forEach((b) => {
      b.addEventListener('click', () => {
        U.setUnits(b.dataset.unit === 'imperial' ? 'imperial' : 'metric');
        paint();
      });
    });
    paint();
  }

  function render(): void {
    const s = buildSlides()[i];
    elKicker.textContent = `Slide ${i + 1} of ${SLIDE_COUNT}`;
    elTitle.textContent = s.title;
    elArt.innerHTML = s.art;
    s.onMount?.(elArt);
    elText.textContent = s.body;
    elTake.textContent = s.takeaway;
    elExtra.innerHTML = s.extra ?? '';
    wireUnitPicker(elExtra);
    dots.forEach((d, n) => d.setAttribute('aria-current', String(n === i)));
    btnPrev.style.visibility = i === 0 ? 'hidden' : 'visible';
    const last = i === SLIDE_COUNT - 1;
    btnNext.textContent = last ? 'Start the dive' : 'Next';
    // NB: not `.pulse` — that recolours text/border to amber, which fights .btn-primary.
    btnNext.classList.toggle('wz-go', last);
    btnSkip.style.visibility = last ? 'hidden' : 'visible';
    // restart the entrance animation
    elFade.classList.remove('wz-fade');
    void elFade.offsetWidth;
    elFade.classList.add('wz-fade');
  }

  function go(n: number): void {
    const next = Math.max(0, Math.min(SLIDE_COUNT - 1, n));
    if (next === i) return;
    i = next;
    render();
  }

  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      markSeen();
      window.removeEventListener('keydown', onKey, true);
      wrap.remove();
      resolve();
    };

    function onKey(e: KeyboardEvent): void {
      // Something else took over the overlay — stand down rather than eating keys.
      if (!wrap.isConnected) {
        finish();
        return;
      }
      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
          e.preventDefault();
          if (i === SLIDE_COUNT - 1) finish();
          else go(i + 1);
          break;
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          go(i - 1);
          break;
        case 'Enter':
          e.preventDefault();
          if (i === SLIDE_COUNT - 1) finish();
          else go(i + 1);
          break;
        case 'Escape':
          e.preventDefault();
          finish();
          break;
        default:
          break;
      }
      e.stopPropagation();
    }

    btnNext.addEventListener('click', () => {
      if (i === SLIDE_COUNT - 1) finish();
      else go(i + 1);
    });
    btnPrev.addEventListener('click', () => go(i - 1));
    btnSkip.addEventListener('click', finish);
    window.addEventListener('keydown', onKey, true);

    render();
    wrap.focus();
  });
}
