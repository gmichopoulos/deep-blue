import * as U from './units';
/**
 * ui/tooltips.ts — the "learn more" layer.
 *
 * TOPICS carries most of the educational payload of the game: eight short
 * explainers, written for someone who has never dived. Each answers three
 * questions in order — what it is, why it physically happens, what to do.
 *
 * `urgentTopic()` picks the single most relevant explainer for the player's
 * situation right now; hud.ts uses it to make that widget's ⓘ badge pulse, so
 * the explanation surfaces at the exact moment it becomes useful.
 */

import { CONFIG } from '../config';
import type { DiveState } from '../types';

export type TopicKey =
  | 'pressure'
  | 'gas'
  | 'ndl'
  | 'deco'
  | 'ascent'
  | 'safety-stop'
  | 'narcosis'
  | 'score';

export interface Topic {
  title: string;
  /** Trusted HTML authored in this file. Never built from user input. */
  body: string;
}

// ---------------------------------------------------------------- copy

/**
 * Rebuilt on every open rather than held as a const: the player can change units
 * mid-dive, and stale copy that says "30 m" under a feet-and-psi gauge is worse
 * than no explanation at all.
 */
export function buildTopics(): Record<TopicKey, Topic> {
  const d = (m: number, dec = 0) => U.teach(m, dec);
  const amb = (bar: number) => `${bar} ${U.getUnits() === 'metric' ? 'bar' : 'ata'}`;
  const rate = (mpm: number) => U.rate(mpm, 0);
  const unitWord = U.getUnits() === 'metric' ? 'metres' : 'feet';
  return {
  pressure: {
    title: 'Pressure: why the shallow water is the tricky part',
    body: `
      <p>At the surface the atmosphere already presses on you with <strong>${amb(1)}</strong>.
      Water is heavy: every <strong>${d(10)}</strong> adds another. So ${d(10)} is ${amb(2)},
      ${d(20)} is ${amb(3)}, ${d(30)} is ${amb(4)}.</p>

      <p>Watch the <em>ratio</em>, not the number. Surface to ${d(10)} <strong>doubles</strong>
      the pressure on you. ${d(30)} to ${d(40)} adds the same amount but is only a <strong>25%
      increase</strong>. And gas obeys Boyle's law — squeeze it twice as hard and it takes
      half the space, so anything air-filled in you or your gear shrinks going down and
      swells coming up.</p>

      <span class="rule">Deep water changes pressure slowly. Shallow water changes it fast.
      That is why the last ${d(10)} of an ascent is the part you take most carefully — and why
      you never hold your breath on the way up.</span>
    `,
  },

  gas: {
    title: 'Gas: your tank empties faster the deeper you go',
    body: `
      <p>Your regulator delivers air at whatever pressure you are under, so your lungs can
      inflate. At ${d(30)} that is ${amb(4)} — meaning every breath contains <strong>four times as
      many molecules</strong> as the same breath at the surface.</p>

      <p>You are not breathing harder. Each breath just costs the tank four times as much.
      A tank that lasts 80 minutes at the surface lasts about <strong>20 at ${d(30)}</strong>.</p>

      <span class="rule">Same breathing rate. Four times the depth pressure. A quarter of
      the bottom time.</span>

      <p><strong>What to do:</strong> read the "minutes at this depth" estimate, not the bar
      number — it already accounts for where you are. ${U.reserveLabel()} is your
      reserve: the gas that gets you up slowly, with a stop on the way. It is not spare.</p>
    `,
  },

  ndl: {
    title: 'No-stop time: the clock you cannot see',
    body: `
      <p>Nitrogen dissolves into your tissues under pressure, and faster the deeper you go.
      Your <strong>no-stop time</strong> is how long you may stay at this depth and still be
      free to swim straight up (slowly) without pausing on the way.</p>

      <p>Depth sets how fast it counts down: about an hour at ${d(18)}, twenty minutes at
      ${d(30)}, single digits at ${d(40)}. Going deeper drops it immediately; going shallower gives some
      back, as your tissues start offloading instead of absorbing. Divers and dive computers
      call this the no-decompression limit, written <strong>NDL</strong>.</p>

      <span class="rule">It is not a warning that something is about to break. It is the line
      between "I may leave whenever I want" and "I now owe the water a stop first".</span>

      <p><strong>What to do:</strong> at five minutes left, start drifting shallower. A gentle
      climb resets the clock — you do not have to rush up.</p>
    `,
  },

  deco: {
    title: 'Decompression obligation: you now owe the water a stop',
    body: `
      <p>You stayed past your no-stop time, so your tissues now hold more nitrogen than they
      can carry straight to the surface. You owe the water a stop before you may leave.</p>

      <p>The <strong>ceiling</strong> is the shallowest depth you are currently allowed. It is
      not a physical barrier — nothing stops you swimming through it. It is a pressure you have
      to stay under while the excess nitrogen leaves through your lungs. Wait below it and it
      rises on its own until it reaches the surface and you are free to go.</p>

      <span class="rule">Ascending above the ceiling, or surfacing while you still have one, is
      how you get decompression sickness.</span>

      <p><strong>What to do:</strong> hang at or just below the red line and be patient. Check
      your gas — waiting costs air, and you still owe a slow ascent afterwards.</p>
    `,
  },

  ascent: {
    title: 'Ascent rate: the one number that hurts people',
    body: `
      <p>Open a fizzy bottle slowly and it hisses; crack it fast and it foams over. Dissolved
      gas comes out of solution when pressure drops, and how fast it drops decides whether it
      leaves gently or forms bubbles.</p>

      <p>Your bloodstream is the bottle. Ascend slowly and the nitrogen travels to your lungs
      and you breathe it away. Ascend fast and it comes out where it is — in your joints, your
      spine, your brain. That is decompression sickness, the bends.</p>

      <span class="rule">Never come up faster than ${rate(CONFIG.maxAscentRateMpm)} — slower
      than your own smallest bubbles.</span>

      <p><strong>What to do:</strong> keep the ascent gauge in the green. If it goes red, stop
      climbing and let yourself settle before continuing. Points are docked for the time you
      spend over the limit, even when you get away with it.</p>
    `,
  },

  'safety-stop': {
    title: 'Safety stop: three minutes of cheap insurance',
    body: `
      <p>A <strong>safety stop</strong> is three minutes spent at about
      ${d(CONFIG.safetyStop.depthM)} before you finish the dive. Nothing has gone wrong when you
      make one — it is routine, and it is different from the mandatory stop you owe after
      overstaying your no-stop time.</p>

      <p>It is placed there because pressure changes fastest in the last few ${unitWord}, which is
      exactly where dissolved nitrogen is most likely to come out as bubbles. Pausing gives your
      blood time to carry it to your lungs instead.</p>

      <span class="rule">Three minutes and a few bar of gas, for a large cut in risk. It is the
      cheapest insurance in diving.</span>

      <p><strong>What to do:</strong> plan the gas for it before you descend, and hold the depth
      until the counter fills. This game scores you for completing it.</p>
    `,
  },

  narcosis: {
    title: 'Nitrogen narcosis: the depth that makes you stupid',
    body: `
      <p>Under pressure, nitrogen starts acting like an anaesthetic. From around
      ${d(CONFIG.narcosisOnsetM)} most divers feel it: warm, slightly euphoric, a bit dreamy.
      Divers call it <em>narcosis</em>, or the rapture of the deep.</p>

      <p>It does not hurt — that is the problem. What it costs you is reaction time, memory and
      judgement, exactly what you need to read a gauge or handle something going wrong. The old
      rule of thumb: every ${d(10)} below about ${d(20)} feels like one drink on an empty stomach. It
      clears completely within a minute or two of going shallower.</p>

      <span class="rule">Narcosis is one reason recreational diving stops at
      ${d(CONFIG.recLimitM)}. The other is oxygen: deeper than that, the share of pressure it
      carries gets high enough to risk a seizure.</span>

      <p><strong>What to do:</strong> if you feel vague or fixated, go up ${d(5)}.</p>
    `,
  },

  score: {
    title: 'Score: the best dive is not the deepest one',
    body: `
      <p>Rare species live deep, and deep costs you gas, no-stop time and a longer ascent. That
      trade is the whole game.</p>

      <p>Species you have already logged pay less each time you see them again — down to a single
      point — so a shallow dive spent counting the same sardines will not out-score a well-run
      deep one.
      Finishing well pays too: a completed safety stop and gas left above your reserve both add
      points, and time spent above the ascent-rate limit takes them away.</p>

      <span class="rule">The best dive is not the deepest one. It is the one with the most to
      show for the risk you actually took.</span>
    `,
  },
  };
}

// ---------------------------------------------------------------- popover

let scrim: HTMLDivElement | null = null;
let lastFocus: HTMLElement | null = null;

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation();
    closeTopic();
  }
}

/** Render a dismissible modal explaining `key`. Re-opening swaps the content. */
export function openTopic(key: TopicKey): void {
  const topic = buildTopics()[key];
  if (!topic) return;

  closeTopic();
  lastFocus = document.activeElement as HTMLElement | null;

  scrim = document.createElement('div');
  scrim.className = 'topic-scrim';
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) closeTopic();
  });

  const card = document.createElement('div');
  card.className = 'topic-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', topic.title);

  const kicker = document.createElement('div');
  kicker.className = 'topic-kicker';
  kicker.textContent = 'Dive briefing';

  const title = document.createElement('h2');
  title.className = 'topic-title';
  title.textContent = topic.title;

  const body = document.createElement('div');
  body.className = 'topic-body';
  body.innerHTML = topic.body; // trusted: authored in this file

  const close = document.createElement('button');
  close.className = 'topic-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '×';
  close.addEventListener('click', () => closeTopic());

  const foot = document.createElement('div');
  foot.className = 'topic-foot';
  foot.textContent = 'Esc or click outside to close';

  card.append(close, kicker, title, body, foot);
  scrim.append(card);
  document.body.append(scrim);

  document.addEventListener('keydown', onKeyDown, true);
  close.focus();
}

export function closeTopic(): void {
  if (!scrim) return;
  document.removeEventListener('keydown', onKeyDown, true);
  scrim.remove();
  scrim = null;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  lastFocus = null;
}

/** True while an explainer is on screen (main.ts may want to pause). */
export function isTopicOpen(): boolean {
  return scrim !== null;
}

// ---------------------------------------------------------------- urgency

const SAFETY_WINDOW_TOP =
  CONFIG.safetyStop.depthM - CONFIG.safetyStop.toleranceM;
const SAFETY_WINDOW_BOTTOM =
  CONFIG.safetyStop.depthM + CONFIG.safetyStop.toleranceM;

/**
 * The single most relevant topic for the situation the player is in, or null
 * when nothing is pressing. Ordered by how quickly the situation can hurt you.
 */
export function urgentTopic(state: DiveState): TopicKey | null {
  if (state.phase !== 'diving') return null;

  // 1. Ascending too fast — seconds matter, and it is instantly fixable.
  const ascentRate = -state.verticalRate; // positive = going up, m/min
  if (state.ascentStrike > 0.05 || ascentRate > CONFIG.maxAscentRateMpm) {
    return 'ascent';
  }

  // 2. Gas below reserve — the reserve *is* the ascent.
  if (state.tankBar < U.reserveBar()) return 'gas';

  // 3. Already in deco: there is a ceiling to respect before surfacing.
  if (state.inDeco || state.ceiling > 0) return 'deco';

  // 4. NDL running out — the moment to start drifting shallower.
  if (state.ndlMin < 5) return 'ndl';

  // 5. Deep enough for narcosis to be affecting judgement.
  if (state.depth >= CONFIG.narcosisOnsetM) return 'narcosis';

  // 6. In the safety-stop window and the clock has not been paid yet.
  if (
    !state.safetyStopDone &&
    state.depth >= SAFETY_WINDOW_TOP &&
    state.depth <= SAFETY_WINDOW_BOTTOM
  ) {
    return 'safety-stop';
  }

  return null;
}
