/**
 * End-of-dive coaching.
 *
 * `buildDebrief` is a pure function: it reads the recorded dive profile and turns
 * it into one specific, numeric piece of advice — the single most useful thing the
 * diver could have done differently. `showDebrief` renders that, plus the dive
 * profile graph that lets you *see* your own mistake.
 */

import { CONFIG } from '../config';
import type { Debrief, DiveState, EndReason, ProfileSample } from '../types';
import { speciesById } from '../world/species';
import { ambientPressure as ambient } from '../sim/pressure';
import { bankedScore, diversityMultiplier } from '../sim/scoring';
import * as U from './units';
import { runWizard } from './wizard';

const STYLE_ID = 'debrief-styles';
/** Read per call: the reserve follows the player's training tradition. */
const reserve = () => U.reserveBar();
const SAFE_D = CONFIG.safetyStop.depthM;
const SAFE_TOL = CONFIG.safetyStop.toleranceM;

// ---------------------------------------------------------------- small helpers

const n0 = (v: number): string => String(Math.round(v));
const n1 = (v: number): string => (Math.round(v * 10) / 10).toFixed(1);

/** Dive-seconds → "12:04". */
function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/** Dive-seconds → "12" / "4.5" minutes. */
function minutes(sec: number): string {
  const m = sec / 60;
  if (m < 0.1) return '0';
  return m < 10 ? n1(m) : n0(m);
}
/** "the surface" / "18 m" — keeps the coaching copy from saying "0.0 m". */
function depthLabel(d: number): string {
  if (d < 1) return 'the surface';
  // Fractions only matter in the shallows, where a metre is a large fraction of
  // the depth; deeper than that they are noise in coaching copy.
  return U.depth(d, d < 10 ? 1 : 0);
}

/**
 * Bar needed to get from `depth` to the surface by the book: a 9 m/min ascent
 * (average pressure = halfway depth) plus the 3-minute stop at 5 m.
 */
function ascentGasBar(depth: number): number {
  const ascentMin = depth / CONFIG.maxAscentRateMpm;
  const stopMin = CONFIG.safetyStop.durationSec / 60;
  const litres =
    CONFIG.sacLpm * ambient(depth / 2) * ascentMin + CONFIG.sacLpm * ambient(SAFE_D) * stopMin;
  return litres / CONFIG.tank.volumeL;
}


// ---------------------------------------------------------------- profile analysis

interface Moment {
  t: number;
  depth: number;
}

export interface ProfileStats {
  durationSec: number;
  endDepth: number;
  endBar: number;
  maxDepth: number;
  deepest: Moment;
  /**
   * Fastest sustained ascent seen, m/min, plus the over-speed run it belonged to:
   * `depth` is where that run started (the honest "you came up from X m").
   */
  peakAscent: { rateMpm: number; t: number; depth: number; tEnd: number; toDepth: number } | null;
  timeBelow30Sec: number;
  /** Time spent within 5 m of the deepest point. */
  bottomTimeSec: number;
  /** First moment the tank fell to the reserve. */
  reserveCross: Moment | null;
  /** First moment a decompression ceiling appeared. */
  decoOnset: Moment | null;
  /** Last warning shot: NDL down to a handful of minutes, before deco. */
  ndlWarning: { t: number; depth: number; ndlMin: number } | null;
  /** Worst moment the diver was shallower than their ceiling. */
  ceilingBust: { t: number; depth: number; ceiling: number; byM: number } | null;
  /** First crossing of the recreational depth limit. */
  recLimitCross: { t: number; depth: number; ndlMin: number; tankBar: number } | null;
  minNdlMin: number;
  maxLoadPct: number;
  safetyStopSec: number;
  safetyStopDone: boolean;
}

/** Everything the coaching copy and the graph need, derived from the samples alone. */
export function analyseProfile(profile: ProfileSample[]): ProfileStats {
  const stats: ProfileStats = {
    durationSec: 0,
    endDepth: 0,
    endBar: CONFIG.tank.startBar,
    maxDepth: 0,
    deepest: { t: 0, depth: 0 },
    peakAscent: null,
    timeBelow30Sec: 0,
    bottomTimeSec: 0,
    reserveCross: null,
    decoOnset: null,
    ndlWarning: null,
    ceilingBust: null,
    recLimitCross: null,
    minNdlMin: Infinity,
    maxLoadPct: 0,
    safetyStopSec: 0,
    safetyStopDone: false,
  };
  if (profile.length === 0) return stats;

  const last = profile[profile.length - 1];
  stats.durationSec = last.t;
  stats.endDepth = last.depth;
  stats.endBar = last.tankBar;

  let prevNdl = Infinity;
  for (let i = 0; i < profile.length; i++) {
    const s = profile[i];
    const dt = i === 0 ? 0 : s.t - profile[i - 1].t;

    if (s.depth > stats.maxDepth) {
      stats.maxDepth = s.depth;
      stats.deepest = { t: s.t, depth: s.depth };
    }
    if (s.depth >= 30) stats.timeBelow30Sec += dt;
    if (Math.abs(s.depth - SAFE_D) <= SAFE_TOL) stats.safetyStopSec += dt;
    if (Number.isFinite(s.ndlMin)) stats.minNdlMin = Math.min(stats.minNdlMin, s.ndlMin);
    stats.maxLoadPct = Math.max(stats.maxLoadPct, s.loadPct);

    if (!stats.reserveCross && s.tankBar <= reserve()) stats.reserveCross = { t: s.t, depth: s.depth };
    if (!stats.decoOnset && s.ceiling > 0) stats.decoOnset = { t: s.t, depth: s.depth };
    // The last time the no-deco clock crossed *down* through 5 minutes before the
    // obligation appeared: the final moment going shallower would still have worked.
    if (!stats.decoOnset) {
      if (s.ndlMin <= 5 && prevNdl > 5) stats.ndlWarning = { t: s.t, depth: s.depth, ndlMin: s.ndlMin };
      prevNdl = s.ndlMin;
    }
    if (!stats.recLimitCross && s.depth >= CONFIG.recLimitM) {
      stats.recLimitCross = { t: s.t, depth: s.depth, ndlMin: s.ndlMin, tankBar: s.tankBar };
    }
    if (s.ceiling > 0 && s.depth < s.ceiling) {
      const by = s.ceiling - s.depth;
      if (!stats.ceilingBust || by > stats.ceilingBust.byM) {
        stats.ceilingBust = { t: s.t, depth: s.depth, ceiling: s.ceiling, byM: by };
      }
    }
  }

  // Bottom time: within 5 m of the deepest point.
  for (let i = 1; i < profile.length; i++) {
    if (profile[i].depth >= stats.maxDepth - 5) stats.bottomTimeSec += profile[i].t - profile[i - 1].t;
  }

  // Peak sustained ascent rate, measured over a ~4 dive-second window so a single
  // noisy sample cannot win.
  const WINDOW = 4;
  const rates = new Array<number>(profile.length).fill(0);
  let peakRate = 0;
  let peakIdx = -1;
  for (let i = 0; i < profile.length; i++) {
    let j = i;
    while (j > 0 && profile[i].t - profile[j].t < WINDOW) j--;
    if (j === i) continue;
    const dtSec = profile[i].t - profile[j].t;
    if (dtSec <= 0) continue;
    const rate = ((profile[j].depth - profile[i].depth) / dtSec) * 60;
    rates[i] = rate;
    if (rate > peakRate) {
      peakRate = rate;
      peakIdx = i;
    }
  }
  if (peakIdx >= 0) {
    // Widen to the whole continuous over-speed run so we can say where it began.
    const floor = Math.min(CONFIG.maxAscentRateMpm, peakRate * 0.6);
    let a = peakIdx;
    let b = peakIdx;
    while (a > 0 && rates[a - 1] >= floor) a--;
    while (b < profile.length - 1 && rates[b + 1] >= floor) b++;
    const start = Math.max(0, a - WINDOW);
    stats.peakAscent = {
      rateMpm: peakRate,
      t: profile[start].t,
      depth: profile[start].depth,
      tEnd: profile[b].t,
      toDepth: profile[b].depth,
    };
  }

  stats.safetyStopDone = stats.safetyStopSec >= CONFIG.safetyStop.durationSec;
  if (!Number.isFinite(stats.minNdlMin)) stats.minNdlMin = Infinity;
  return stats;
}

// ---------------------------------------------------------------- the coaching brain

function coachOutOfAir(st: ProfileStats): Pick<Debrief, 'title' | 'what' | 'advice' | 'detail'> {
  const endDepth = st.endDepth;
  const mult = ambient(endDepth);
  const title = `Out of air at ${depthLabel(endDepth)}`;
  const what =
    `Your tank read zero ${clock(st.durationSec)} into the dive, at ${depthLabel(endDepth)}. ` +
    `Every breath there cost ${n1(mult)}× what it costs at the surface, so the last of your gas ` +
    `went far faster than the first.`;

  let advice: string;
  if (st.reserveCross) {
    const d = st.reserveCross.depth;
    const need = ascentGasBar(d);
    const spare = reserve() - need;
    const budget =
      spare > 8
        ? `Turning the dive there would have cost about ${U.tankPressure(need)} to ascend at ${U.rate(CONFIG.maxAscentRateMpm,0)} and ` +
          `still make the 3-minute stop — you would have surfaced with ${U.tankPressure(spare)} in hand.`
        : `From that depth a proper ascent plus the safety stop needs about ${U.tankPressure(need)} — your ` +
          `whole reserve. That is the signal to be already heading up, not to keep looking.`;
    advice =
      `You crossed your ${U.reserveLabel()} reserve at ${depthLabel(d)}, ${minutes(st.reserveCross.t)} minutes in, ` +
      `burning ${n1(ambient(d))}× surface rate. ${budget}`;
  } else {
    advice =
      `You never got a reserve warning because the gas went in one long deep stretch: ` +
      `${minutes(st.timeBelow30Sec)} minutes below ${U.teach(30, 0)} at ${n1(ambient(st.maxDepth))}× surface rate. ` +
      `Set yourself a turn pressure before you descend and go up when you hit it.`;
  }

  return {
    title,
    what,
    advice,
    detail:
      `Deepest ${U.depth(st.maxDepth, 0)} · ${minutes(st.bottomTimeSec)} min of bottom time · ` +
      `${minutes(st.timeBelow30Sec)} min below ${U.teach(30, 0)}.`,
  };
}

function coachFastAscent(st: ProfileStats): Pick<Debrief, 'title' | 'what' | 'advice' | 'detail'> {
  const peak = st.peakAscent;
  const rate = peak ? peak.rateMpm : CONFIG.diver.maxAscentRate;
  const from = peak ? peak.depth : st.maxDepth;
  const to = peak ? peak.toDepth : 0;

  const overFactor = rate / CONFIG.maxAscentRateMpm;
  // Measured over the whole ascent the diver was committed to, not just the
  // segment that tripped the meter. They were on their way to the surface, and
  // "what would have happened" is the question the debrief is answering.
  const expansion = ambient(from) / CONFIG.surfacePressureBar;
  const properMin = from / CONFIG.maxAscentRateMpm;
  const atThisRateMin = from / rate;

  return {
    title: `Ascent too fast — ${U.rate(rate, 0)}`,
    what:
      `You came up at ${U.rate(rate, 0)} from ${depthLabel(from)} to ${depthLabel(to)}, ` +
      `${clock(peak ? peak.t : st.durationSec)} into the dive — ${n1(overFactor)}× the ` +
      `${U.rate(CONFIG.maxAscentRateMpm, 0)} limit. Two things go wrong at once. Your tissues were ` +
      `holding ${n0(st.maxLoadPct * 100)}% of the nitrogen they can carry at surface pressure, and ` +
      `dropping the surrounding pressure that fast gives the gas no time to diffuse back into your ` +
      `bloodstream and out through your lungs — so it comes out of solution where it already is, as ` +
      `bubbles in tissue and venous blood. Your lungs normally filter those bubbles; past a certain ` +
      `rate they get through to the arterial side, and from there they go wherever your blood goes. ` +
      `Meanwhile the gas in your chest was on its way to expanding ${n1(expansion)}× between ` +
      `${depthLabel(from)} and the surface, so holding your breath even briefly on that climb can ` +
      `tear lung tissue outright.`,
    advice:
      `Look at what the hurry was worth. From ${depthLabel(from)} a correct ascent reaches the ` +
      `surface in about ${n1(properMin)} minutes; at ${U.rate(rate, 0)} you would have been up in ` +
      `${n1(atThisRateMin)}. The entire saving was ${n1(Math.max(0.1, properMin - atThisRateMin))} ` +
      `minutes. Ascend slower than your own smallest bubbles — they rise at close to the right ` +
      `speed — and add the three-minute stop at ${depthLabel(CONFIG.safetyStop.depthM)} on top.`,
    detail:
      `What that costs a real diver: joint pain in the shoulders or knees within fifteen minutes to ` +
      `an hour, sometimes mottled skin, and in the worst case numbness or weakness in the legs as ` +
      `bubbles lodge in the spinal cord. The treatment is 100% oxygen straight away and ` +
      `recompression in a hyperbaric chamber, which from a dive site is usually hours away. Most ` +
      `divers who take a hit recover fully. Not all of them do.`,
  };
}

function coachCeiling(st: ProfileStats): Pick<Debrief, 'title' | 'what' | 'advice' | 'detail'> {
  const bust = st.ceilingBust;
  const onset = st.decoOnset;
  const ceil = bust ? bust.ceiling : 0;

  const built = onset
    ? `${minutes(onset.t)} minutes of diving, most of it around ${U.depth(st.maxDepth, 0)}, ` +
      `loaded enough nitrogen to put you into decompression at ${clock(onset.t)}`
    : `Your tissues went past the no-decompression limit`;

  const what = bust
    ? `${built}. That gave you a ceiling of ${depthLabel(bust.ceiling)} — the shallowest depth you were ` +
      `allowed to be — and you went up to ${depthLabel(bust.depth)}, ${U.depth(bust.byM)} above it.`
    : `${built}, and you surfaced still owing decompression time.`;

  let advice: string;
  if (st.ndlWarning) {
    advice =
      `The fix was earlier and shallower: at ${clock(st.ndlWarning.t)} you were at ` +
      `${depthLabel(st.ndlWarning.depth)} with ${n1(st.ndlWarning.ndlMin)} minutes of no-stop time left. ` +
      `Going up to ${U.teach(15, 0)}–${U.teach(18, 0)} right then would have refilled that clock instead of buying you a stop you ` +
      `then refused to pay.`;
  } else {
    advice =
      `Once the ceiling appears it is not negotiable — you have to hang at or below ` +
      `${depthLabel(Math.max(ceil, SAFE_D))} and let it rise on its own. Start up while your no-stop clock ` +
      `still reads double digits; ${minutes(st.timeBelow30Sec)} minutes below ${U.teach(30, 0)} is what bought the obligation.`;
  }

  return {
    title: bust
      ? `Decompression sickness — you came up through your ceiling`
      : `Decompression sickness — you surfaced still owing a stop`,
    what,
    advice,
    detail:
      `Deepest ${U.depth(st.maxDepth, 0)} · ${minutes(st.bottomTimeSec)} min of bottom time · ` +
      `loading peaked at ${n0(st.maxLoadPct * 100)}% of the surfacing limit.`,
  };
}

function coachDepthExceeded(st: ProfileStats): Pick<Debrief, 'title' | 'what' | 'advice' | 'detail'> {
  const cross = st.recLimitCross;
  const advice = cross
    ? `When you crossed ${U.teach(CONFIG.recLimitM, 0)} at ${clock(cross.t)} you had ` +
      `${Number.isFinite(cross.ndlMin) ? `${n1(cross.ndlMin)} minutes of no-stop time` : 'no-stop time already gone'} ` +
      `and ${U.tankPressure(cross.tankBar)} left, and you were still going down. Levelling off there was the whole ` +
      `decision — the fish below are worth a few more points and cost you the dive.`
    : `You went below the recreational limit within the first ${minutes(st.durationSec)} minutes. ` +
      `Pick a maximum depth before you descend and treat it as the seabed.`;

  return {
    title: `Past the limit — ${U.depth(st.maxDepth, 0)}`,
    what:
      `You went through ${U.teach(CONFIG.hardMaxDepthM, 0)} at ${clock(st.durationSec)}. Recreational diving stops at ` +
      `${U.teach(CONFIG.recLimitM, 0)} for two reasons: narcosis takes the edge off your judgement from about ` +
      `${U.teach(CONFIG.narcosisOnsetM, 0)}, and your no-stop time down there is single digits.`,
    advice,
    detail:
      `At ${U.depth(st.maxDepth, 0)} the ambient pressure is ${U.ambientPressureLabel(ambient(st.maxDepth))} and you burn air ` +
      `${n1(ambient(st.maxDepth))}× as fast as at the surface.`,
  };
}

function coachSuccess(
  st: ProfileStats,
  state: DiveState,
): Pick<Debrief, 'title' | 'what' | 'advice' | 'detail'> {
  const gasSpare = st.endBar - reserve();
  const ndlSpare = Number.isFinite(st.minNdlMin) ? st.minNdlMin : Infinity;
  const stopDone = state.safetyStopDone;

  // Never left the top 5 m: that is a snorkel, not a dive. None of the coaching
  // below applies — no gas pressure, no nitrogen, no ascent to get wrong — so say
  // the encouraging true thing and point at what the tank is actually for.
  if (st.maxDepth <= 5) {
    return {
      title: `A perfectly safe snorkel — ${n0(bankedScore(state))} points`,
      what:
        `${minutes(st.durationSec)} minutes, never deeper than ${U.depth(st.maxDepth)}, back up with ` +
        `${U.tankPressure(st.endBar)}. Nothing went wrong, and at that depth nothing really could: your ` +
        `no-stop time stayed unlimited, your tank barely moved, and there was no ascent worth ` +
        `taking slowly.`,
      advice:
        `You are wearing a tank — use it. Everything interesting is below you: the reef species ` +
        `start around ${U.teach(8, 0)}, octopus and squid live past ${U.teach(17, 0)}, and the rarest animals ` +
        `in the game are deeper than ${U.teach(26, 0)}. Descending is the safe part of a dive; it is coming back up that ` +
        `asks something of you, and you have ${U.tankPressure(st.endBar)} to practise with. Go down to ` +
        `${U.teach(15, 0)} next time, watch what your gas and no-stop time do, and come up slowly.`,
      detail:
        `At ${U.depth(st.maxDepth)} you were breathing ${n1(ambient(st.maxDepth))}x surface rate. ` +
        `At ${U.teach(30, 0)} it would be ${n1(ambient(30))}x — that is the trade the whole game is about.`,
    };
  }

  const what =
    `${minutes(st.durationSec)} minutes, ${U.depth(st.maxDepth, 0)} deepest, back on the surface with ` +
    `${U.tankPressure(st.endBar)} and no violations. ${
      stopDone
        ? 'You made the safety stop.'
        : `You skipped the safety stop — you were only in the ${U.teach(SAFE_D, 0)} window for ${minutes(state.safetyStopSec)} of the 3 minutes.`
    }`;

  let advice: string;
  if (!stopDone) {
    advice =
      `Do the safety stop. Three minutes hanging at ${U.teach(SAFE_D, 0)} costs about ` +
      `${U.tankPressure((CONFIG.sacLpm * ambient(SAFE_D) * 3) / CONFIG.tank.volumeL)} — you surfaced with ` +
      `${U.tankPressure(st.endBar)}, so you had it to spare — and it is the cheapest insurance in diving ` +
      `against the bubbles you cannot feel forming. It was also worth ${CONFIG.bonus.safetyStop} points.`;
  } else if (gasSpare > 60 && ndlSpare > 15) {
    advice =
      `You were too careful. You surfaced with ${U.tankPressure(gasSpare)} above your reserve and never got ` +
      `closer than ${n0(ndlSpare)} minutes to the no-stop limit — that is a whole second dive's worth of ` +
      `margin left unused. Next time take it ${U.teach(6, 0)} deeper and hold there; the rare fish live below ${U.teach(25, 0)}.`;
  } else if (gasSpare > 60) {
    advice =
      `Gas was never your limit — you came up with ${U.tankPressure(gasSpare)} above reserve. Your constraint was ` +
      `nitrogen (you got to within ${n1(ndlSpare)} minutes of the limit), so the way to score more is a ` +
      `flatter profile: reach your depth, stay there, and drift shallower as your no-stop clock winds down.`;
  } else if (ndlSpare > 15) {
    advice =
      `Nitrogen was never your limit — ${n0(ndlSpare)} minutes of no-stop time went unused — but gas was: ` +
      `you finished ${U.tankPressure(gasSpare)} over reserve. Slow, relaxed finning and less time below ${U.teach(30, 0)} buys ` +
      `you the bottom time you actually had budget for.`;
  } else {
    advice =
      `That is a well-run dive: ${U.depth(st.maxDepth, 0)} deepest, closest approach to the no-stop limit ` +
      `${n1(ndlSpare)} minutes, peak ascent ${U.rate(st.peakAscent ? st.peakAscent.rateMpm : 0, 0)} inside the ` +
      `${U.rate(CONFIG.maxAscentRateMpm, 0)} limit, and the full stop at ${U.teach(SAFE_D, 0)}. You spent your margins ` +
      `instead of hoarding them and still had some left. Do it deeper next time and it scores higher.`;
  }

  return {
    title: `Surfaced clean — ${n0(bankedScore(state))} points`,
    what,
    advice,
    detail:
      `${minutes(st.bottomTimeSec)} min of bottom time · ${minutes(st.timeBelow30Sec)} min below ${U.teach(30, 0)} · ` +
      `peak ascent ${U.rate(st.peakAscent ? st.peakAscent.rateMpm : 0, 0)}.`,
  };
}

/** Pure: dive state in, coaching out. */
export function buildDebrief(state: DiveState): Debrief {
  const profile = state.profile ?? [];
  const st = analyseProfile(profile);
  // The live state is authoritative where the profile is coarse.
  st.maxDepth = Math.max(st.maxDepth, state.maxDepth);
  st.durationSec = Math.max(st.durationSec, state.t);
  if (profile.length === 0) {
    st.endDepth = state.depth;
    st.endBar = state.tankBar;
  }

  const reason: EndReason = state.endReason ?? 'surfaced';
  const success = reason === 'surfaced';

  let copy: Pick<Debrief, 'title' | 'what' | 'advice' | 'detail'>;
  switch (reason) {
    case 'out-of-air':
      copy = coachOutOfAir(st);
      break;
    case 'ascent-too-fast':
      copy = coachFastAscent(st);
      break;
    case 'dcs-ceiling':
      copy = coachCeiling(st);
      break;
    case 'depth-exceeded':
      copy = coachDepthExceeded(st);
      break;
    default:
      copy = coachSuccess(st, state);
      break;
  }

  return {
    success,
    reason,
    title: copy.title,
    what: copy.what,
    advice: copy.advice,
    detail: copy.detail,
    // The score on screen is net of the ascent penalty; the breakdown shows both.
    score: bankedScore(state),
    ascentPenalty: Math.round(state.ascentPenalty),
    fishPoints: Object.values(state.awardedBySpecies).reduce((a, b) => a + b, 0),
    diversityMult: diversityMultiplier(state.observed.size),
    bonusPoints: state.bonusPoints,
    safetyStopDone: state.safetyStopDone,
    safetyStopSec: state.safetyStopSec,
    awardedBySpecies: { ...state.awardedBySpecies },
    maxDepth: st.maxDepth,
    duration: st.durationSec,
    profile,
    observedCounts: { ...state.observedCounts },
  };
}

// ---------------------------------------------------------------- the graph

const FAIL_LABEL: Record<EndReason, string> = {
  surfaced: 'surfaced',
  'out-of-air': 'out of air',
  'ascent-too-fast': 'ascent bust',
  'dcs-ceiling': 'ceiling broken',
  'depth-exceeded': 'depth limit',
};

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Ctx2 {
  ctx: CanvasRenderingContext2D;
  x: (min: number) => number;
  y: (depth: number) => number;
  padL: number;
  padT: number;
  w: number;
  h: number;
  /** Callout boxes already placed, so later ones can dodge them. */
  placed: Box[];
}

const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w + 4 && a.x + a.w + 4 > b.x && a.y < b.y + b.h + 4 && a.y + a.h + 4 > b.y;

function niceStep(spanMin: number): number {
  const candidates = [1, 2, 5, 10, 15, 20, 30, 60];
  for (const c of candidates) if (spanMin / c <= 8) return c;
  return 60;
}

/** Callout box with a leader line, flipped to whichever side has room. */
function annotate(
  g: Ctx2,
  px: number,
  py: number,
  lines: string[],
  color: string,
  preferBelow = false,
): void {
  const { ctx } = g;
  ctx.save();
  ctx.font = '600 11px system-ui, sans-serif';
  const wText = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const bw = wText + 14;
  const bh = lines.length * 13 + 9;
  const right = px < g.padL + g.w * 0.62;
  let bx = right ? px + 16 : px - 16 - bw;
  let by = preferBelow ? py + 14 : py - bh - 14;
  const clampX = (v: number): number => Math.max(g.padL + 2, Math.min(v, g.padL + g.w - bw - 2));
  const clampY = (v: number): number => Math.max(g.padT + 2, Math.min(v, g.padT + g.h - bh - 2));
  bx = clampX(bx);
  by = clampY(by);

  // Nudge clear of any callout already on the chart.
  const dir = preferBelow ? 1 : -1;
  for (let tries = 0; tries < 8; tries++) {
    const box: Box = { x: bx, y: by, w: bw, h: bh };
    if (!g.placed.some((p) => overlaps(box, p))) break;
    const moved = clampY(by + dir * (bh + 8));
    by = moved === by ? clampY(by - dir * (bh + 8)) : moved;
  }
  g.placed.push({ x: bx, y: by, w: bw, h: bh });

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(right ? bx : bx + bw, by + bh / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(4,20,34,.92)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(bx, by, bw, bh, 5);
  else ctx.rect(bx, by, bw, bh);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + 7, by + 5 + i * 13));

  // the marker itself
  ctx.beginPath();
  ctx.arc(px, py, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.75;
  ctx.strokeStyle = 'rgba(255,255,255,.9)';
  ctx.stroke();
  ctx.restore();
}

function drawGraph(canvas: HTMLCanvasElement, d: Debrief, st: ProfileStats): void {
  const W = 720;
  const H = 300;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const padL = 46;
  const padR = 16;
  const padT = 14;
  const padB = 34;
  const w = W - padL - padR;
  const h = H - padT - padB;

  const yMaxM = CONFIG.seabedM + 2;
  const durMin = Math.max(d.duration / 60, 0.5);
  const step = niceStep(durMin);
  const xMaxMin = Math.max(Math.ceil(durMin / step) * step, step);

  const x = (min: number): number => padL + (min / xMaxMin) * w;
  const y = (depth: number): number => padT + (Math.max(0, depth) / yMaxM) * h;
  const g: Ctx2 = { ctx, x, y, padL, padT, w, h, placed: [] };

  // --- water
  const water = ctx.createLinearGradient(0, padT, 0, padT + h);
  water.addColorStop(0, '#12628a');
  water.addColorStop(0.55, '#0a3a5c');
  water.addColorStop(1, '#04182c');
  ctx.fillStyle = water;
  ctx.fillRect(padL, padT, w, h);

  // --- seabed
  const bedY = y(CONFIG.seabedM);
  ctx.fillStyle = '#0d3229';
  ctx.beginPath();
  ctx.moveTo(padL, bedY + 3);
  for (let px = padL; px <= padL + w; px += 24) {
    ctx.lineTo(px + 12, bedY + (px % 48 === 0 ? -2 : 4));
  }
  ctx.lineTo(padL + w, padT + h);
  ctx.lineTo(padL, padT + h);
  ctx.closePath();
  ctx.fill();
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(150,220,200,.75)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText('seabed', padL + 6, bedY - 2);

  // --- decompression ceiling: the region you may not enter
  const runs: ProfileSample[][] = [];
  let run: ProfileSample[] = [];
  for (const s of d.profile) {
    if (s.ceiling > 0) run.push(s);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  for (const r of runs) {
    ctx.beginPath();
    ctx.moveTo(x(r[0].t / 60), padT);
    for (const s of r) ctx.lineTo(x(s.t / 60), y(s.ceiling));
    ctx.lineTo(x(r[r.length - 1].t / 60), padT);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,80,72,.26)';
    ctx.fill();
    ctx.beginPath();
    r.forEach((s, i) =>
      i === 0 ? ctx.moveTo(x(s.t / 60), y(s.ceiling)) : ctx.lineTo(x(s.t / 60), y(s.ceiling)),
    );
    ctx.strokeStyle = '#ff6b5a';
    ctx.lineWidth = 1.75;
    ctx.stroke();
  }
  if (runs.length) {
    const r0 = runs[0];
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillStyle = '#ff9a8c';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const label = 'decompression ceiling — no entry';
    const lx = Math.min(x(r0[0].t / 60) + 4, padL + w - ctx.measureText(label).width - 4);
    ctx.fillText(label, lx, padT + 4);
    g.placed.push({ x: lx, y: padT + 4, w: ctx.measureText(label).width, h: 13 });
  }

  // --- safety-stop window
  const sTop = y(SAFE_D - SAFE_TOL);
  const sBot = y(SAFE_D + SAFE_TOL);
  ctx.fillStyle = 'rgba(79,209,177,.16)';
  ctx.fillRect(padL, sTop, w, sBot - sTop);
  ctx.strokeStyle = 'rgba(79,209,177,.55)';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, y(SAFE_D));
  ctx.lineTo(padL + w, y(SAFE_D));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(120,235,205,.95)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('safety stop', padL + w - 6, y(SAFE_D));
  g.placed.push({
    x: padL + w - 6 - ctx.measureText('safety stop').width,
    y: y(SAFE_D) - 7,
    w: ctx.measureText('safety stop').width,
    h: 14,
  });

  // --- grid + axes
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let m = 0; m <= yMaxM; m += 10) {
    const gy = y(m);
    ctx.strokeStyle = 'rgba(200,230,245,.13)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(padL + w, gy);
    ctx.stroke();
    ctx.fillStyle = 'rgba(200,230,245,.62)';
    ctx.fillText(U.depth(m, 0), padL - 6, gy);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let m = 0; m <= xMaxMin + 0.001; m += step) {
    const gx = x(m);
    ctx.strokeStyle = 'rgba(200,230,245,.1)';
    ctx.beginPath();
    ctx.moveTo(gx, padT);
    ctx.lineTo(gx, padT + h);
    ctx.stroke();
    ctx.fillStyle = 'rgba(200,230,245,.62)';
    ctx.fillText(String(m), gx, padT + h + 6);
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(200,230,245,.5)';
  ctx.fillText('minutes', padL + w, padT + h + 19);
  ctx.strokeStyle = 'rgba(200,230,245,.35)';
  ctx.strokeRect(padL, padT, w, h);

  // --- the profile
  if (d.profile.length > 1) {
    ctx.beginPath();
    d.profile.forEach((s, i) => {
      const px = x(s.t / 60);
      const py = y(s.depth);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = 'rgba(0,0,0,.45)';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.strokeStyle = '#9fe8ff';
    ctx.lineWidth = 2.4;
    ctx.stroke();
  }

  // --- annotations, most useful first
  const last = d.profile[d.profile.length - 1];
  const endX = x((last ? last.t : d.duration) / 60);
  const endY = y(last ? last.depth : 0);

  if (st.deepest.depth > 0) {
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(159,232,255,.9)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const label = `max ${U.depth(st.deepest.depth, 0)}`;
    const lw = ctx.measureText(label).width;
    const lx = Math.max(padL + lw / 2 + 4, Math.min(x(st.deepest.t / 60), padL + w - lw / 2 - 4));
    // Below the trace, unless that would fall off the bottom of the chart.
    const below = y(st.deepest.depth) + 12 < padT + h;
    const ly = below ? y(st.deepest.depth) + 7 : y(st.deepest.depth) - 18;
    ctx.fillText(label, lx, ly);
    g.placed.push({ x: lx - lw / 2, y: ly, w: lw, h: 13 });
  }

  if (d.reason === 'out-of-air' && st.reserveCross) {
    annotate(
      g,
      x(st.reserveCross.t / 60),
      y(st.reserveCross.depth),
      [`${U.reserveLabel()} reserve`, `${U.depth(st.reserveCross.depth, 0)} · ${clock(st.reserveCross.t)}`],
      '#ffd166',
      true,
    );
  }
  if (d.reason === 'ascent-too-fast' && st.peakAscent) {
    const p = st.peakAscent;
    // Mark the middle of the over-speed run, where the line is visibly steep.
    annotate(
      g,
      x((p.t + p.tEnd) / 120),
      y((p.depth + p.toDepth) / 2),
      [U.rate(p.rateMpm, 0), `limit ${U.rate(CONFIG.maxAscentRateMpm, 0)}`],
      '#ffd166',
    );
  }
  if (d.reason === 'dcs-ceiling' && st.ceilingBust) {
    annotate(
      g,
      x(st.ceilingBust.t / 60),
      y(st.ceilingBust.depth),
      [`${U.depth(st.ceilingBust.byM)} above ceiling`, `ceiling was ${U.depth(st.ceilingBust.ceiling)}`],
      '#ff6b5a',
      true,
    );
  }

  annotate(
    g,
    endX,
    endY,
    [FAIL_LABEL[d.reason], `${clock(d.duration)} · ${U.depth(last ? last.depth : 0, 0)}`],
    d.success ? '#4fd1b1' : '#ff6b5a',
    endY < padT + h * 0.4,
  );
}

// ---------------------------------------------------------------- styles

const CSS = `
.debrief{width:100%;display:flex;justify-content:center;color:var(--ink,#e9f6ff);
  font-family:var(--font-ui,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif)}
.debrief *{box-sizing:border-box}
.debrief .db-panel{max-width:880px;width:min(880px,100%);padding:20px 22px;
  /* This panel always overflows — headline, coaching, profile graph, stats, score
     breakdown and logbook never fit at once — so keep the gutter permanently
     rather than having a scrollbar appear and reflow the content mid-read. */
  overflow-y:scroll;scrollbar-gutter:stable;
  scrollbar-width:thin;scrollbar-color:var(--panel-brd-strong) transparent;
  display:flex;flex-direction:column;gap:13px;line-height:1.45}
.debrief .db-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.debrief .db-badge{font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;
  padding:4px 9px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}
.debrief .db-badge.ok{color:var(--ok,#43d69b)}
.debrief .db-badge.bad{color:var(--danger,#ff4f63)}
.debrief h1{margin:0;font-size:26px;line-height:1.12;letter-spacing:-.015em;color:var(--ink,#e9f6ff)}
.debrief .db-score{margin-left:auto;text-align:right;line-height:1}
.debrief .db-score b{font-size:30px;font-family:var(--font-num,ui-monospace,monospace);
  color:var(--accent,#3fe0d8)}
.debrief .db-score span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;
  color:var(--muted,#7e9bb1);margin-top:5px}
.debrief .db-what{margin:0;font-size:14.5px;line-height:1.5;color:var(--ink-dim,#b7cede)}
.debrief .db-advice{border-left:3px solid var(--accent,#3fe0d8);
  background:var(--accent-dim,rgba(63,224,216,.16));border-radius:0 8px 8px 0;padding:10px 14px}
.debrief .db-advice .lbl{display:block;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;
  font-weight:800;color:var(--accent,#3fe0d8);margin-bottom:5px}
.debrief .db-advice p{margin:0;font-size:14.5px;line-height:1.5;color:var(--ink,#e9f6ff)}
.debrief .db-detail{margin:0;font-size:12px;color:var(--muted,#7e9bb1)}
.debrief .db-figure{margin:0}
.debrief .db-figure canvas{display:block;width:100%;height:auto;border-radius:var(--radius,10px);
  border:1px solid var(--panel-brd,rgba(120,190,235,.16));background:#04182c}
.debrief .db-legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:7px;font-size:11px;
  color:var(--muted,#7e9bb1)}
.debrief .db-legend i{display:inline-block;width:11px;height:11px;border-radius:3px;
  margin-right:5px;vertical-align:-1px}
.debrief .db-cols{display:grid;grid-template-columns:1.1fr 1fr 1.2fr;gap:16px}
.debrief .db-cols h3{margin:0 0 7px;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--muted,#7e9bb1);font-weight:800}
.debrief .db-panel::-webkit-scrollbar{width:10px}
.debrief .db-panel::-webkit-scrollbar-track{background:rgba(255,255,255,.04);border-radius:5px}
.debrief .db-panel::-webkit-scrollbar-thumb{background:var(--panel-brd-strong);border-radius:5px;
  border:2px solid transparent;background-clip:padding-box}
.debrief .db-panel::-webkit-scrollbar-thumb:hover{background:var(--muted);background-clip:padding-box}

.debrief .db-rows{display:flex;flex-direction:column;gap:4px;font-size:12.5px;
  color:var(--ink-dim,#b7cede)}
.debrief .db-row{display:flex;gap:8px;align-items:baseline}
.debrief .db-row span:last-child{margin-left:auto;font-family:var(--font-num,ui-monospace,monospace);
  color:var(--ink,#e9f6ff);white-space:nowrap}
.debrief .db-row.total{border-top:1px solid var(--panel-brd,rgba(120,190,235,.16));
  padding-top:5px;margin-top:2px;font-weight:700}
.debrief .db-row.total span:last-child{color:var(--accent,#3fe0d8)}
.debrief .db-row.warn span:last-child{color:var(--warn,#ffb636)}
.debrief .db-empty{margin:0;font-size:12.5px;color:var(--muted,#7e9bb1)}
/* the panel scrolls internally, so keep the actions pinned in view */
.debrief .db-actions{position:sticky;bottom:-20px;z-index:1;display:flex;gap:10px;align-items:center;
  margin:0 -22px -20px;padding:12px 22px 18px;
  background:var(--panel-bg-solid,#071a2a);
  border-top:1px solid var(--panel-brd,rgba(120,190,235,.16))}
.debrief .db-actions .sp{margin-left:auto}
@media (max-width:720px){
  .debrief .db-cols{grid-template-columns:1fr}
  .debrief h1{font-size:21px}
  .debrief .db-score b{font-size:24px}
}
`;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

// ---------------------------------------------------------------- render

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/**
 * The score column, as data. Exported so tests assert against the same arithmetic
 * the panel renders rather than re-implementing it — the last three scoring bugs
 * in this file were all a second copy of a calculation drifting from the first.
 *
 * LAW: `fishPoints × diversityMult` (rounded) `+ stopBonus + gasBonus − penalty`
 * must equal `total`, and the two bonus rows must partition `bonusPoints`.
 */
export function scoreBreakdown(d: Debrief): {
  fishPoints: number;
  diversityMult: number;
  stopBonus: number;
  gasBonus: number;
  penalty: number;
  total: number;
} {
  // The engine's verdict, not the profile's, and gated on success: a failed dive
  // banks nothing, so every bonus row must read zero or the column contradicts
  // its own total.
  const stopBonus = d.success && d.safetyStopDone ? CONFIG.bonus.safetyStop : 0;
  const gasBonus = Math.max(0, d.bonusPoints - stopBonus);
  return {
    fishPoints: d.fishPoints,
    diversityMult: d.diversityMult,
    stopBonus,
    gasBonus,
    penalty: d.ascentPenalty,
    total: d.score,
  };
}

export function showDebrief(root: HTMLElement, d: Debrief, onRestart: () => void): void {
  injectStyles();
  root.innerHTML = ''; // #overlay:not(:empty) supplies the scrim + pointer events

  const st = analyseProfile(d.profile);
  st.maxDepth = Math.max(st.maxDepth, d.maxDepth);

  // score breakdown
  const entries = Object.entries(d.observedCounts).filter(([, c]) => c > 0);
  const fishPoints = d.fishPoints;
  const speciesRows = entries
    .map(([id, count]) => {
      const sp = speciesById(id);
      // Use what the engine actually awarded. Recomputing `points x count` here
      // ignores repeat-sighting decay and makes the breakdown contradict the score.
      const pts = d.awardedBySpecies[id] ?? 0;
      const label = `${sp?.emoji ?? '🐟'} ${sp?.name ?? id}`;
      return { label, count, pts, depth: sp?.minDepth ?? 0 };
    })
    .sort((a, b) => b.pts - a.pts);

  const { stopBonus, gasBonus } = scoreBreakdown(d);
  const speciesCount = Object.keys(d.observedCounts).length;

  const wrap = document.createElement('div');
  wrap.className = 'debrief';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', 'Dive debrief');
  wrap.innerHTML = `
    <div class="panel db-panel">
      <div class="db-head">
        <span class="db-badge ${d.success ? 'ok' : 'bad'}">${d.success ? 'Dive complete' : 'Dive over'}</span>
        <h1>${esc(d.title)}</h1>
        <div class="db-score"><b>${n0(d.score)}</b><span>points</span></div>
      </div>

      <p class="db-what">${esc(d.what)}</p>

      <div class="db-advice">
        <span class="lbl">Do this differently</span>
        <p>${esc(d.advice)}</p>
      </div>
      ${d.detail ? `<p class="db-detail">${esc(d.detail)}</p>` : ''}

      <figure class="db-figure">
        <canvas data-graph width="720" height="300" role="img"
          aria-label="Dive profile: depth against time, with the decompression ceiling and the failure point marked"></canvas>
        <div class="db-legend">
          <span><i style="background:#9fe8ff"></i>your depth</span>
          <span><i style="background:rgba(255,80,72,.45);border:1px solid #ff6b5a"></i>ceiling — you may not ascend into this</span>
          <span><i style="background:rgba(79,209,177,.35);border:1px solid rgba(79,209,177,.7)"></i>safety-stop window</span>
          <span><i style="background:#0d3229"></i>seabed</span>
        </div>
      </figure>

      <div class="db-cols">
        <div>
          <h3>The dive</h3>
          <div class="db-rows">
            <div class="db-row"><span>Duration</span><span>${clock(d.duration)}</span></div>
            <div class="db-row"><span>Max depth</span><span>${U.depth(st.maxDepth, 0)}</span></div>
            <div class="db-row"><span>Below ${U.teach(30, 0)}</span><span>${minutes(st.timeBelow30Sec)} min</span></div>
            <div class="db-row"><span>Gas left</span><span>${U.tankPressure(st.endBar)}</span></div>
            <div class="db-row ${st.peakAscent && st.peakAscent.rateMpm > CONFIG.maxAscentRateMpm ? 'warn' : ''}">
              <span>Peak ascent</span><span>${U.rate(st.peakAscent ? st.peakAscent.rateMpm : 0, 0)}</span></div>
            <div class="db-row ${d.safetyStopDone ? '' : 'warn'}">
              <span>Safety stop</span><span>${d.safetyStopDone ? 'done' : `${minutes(d.safetyStopSec)}/3 min`}</span></div>
            <div class="db-row"><span>Peak N₂ loading</span><span>${n0(st.maxLoadPct * 100)}%</span></div>
          </div>
        </div>
        <div>
          <h3>Score</h3>
          <div class="db-rows">
            <div class="db-row"><span>Fish observed</span><span>${n0(fishPoints)}</span></div>
            <div class="db-row"><span>Variety (${speciesCount} species)</span><span>×${d.diversityMult.toFixed(2)}</span></div>
            <div class="db-row"><span>Safety stop</span><span>${stopBonus ? `+${n0(stopBonus)}` : '—'}</span></div>
            <div class="db-row"><span>Reserve intact + spare gas</span><span>${gasBonus ? `+${n0(gasBonus)}` : '—'}</span></div>
            <div class="db-row${d.ascentPenalty ? ' penalty' : ''}"><span>Ascending too fast</span><span>${
              d.ascentPenalty ? `−${n0(d.ascentPenalty)}` : '—'
            }</span></div>
            ${
              d.success
                ? ''
                : `<div class="db-row penalty"><span>Dive not completed</span><span>nothing banked</span></div>`
            }
            <div class="db-row total"><span>${d.success ? 'Total' : 'Banked'}</span><span>${n0(d.score)}</span></div>
          </div>
        </div>
        <div>
          <h3>Logbook</h3>
          ${
            speciesRows.length
              ? `<div class="db-rows">${speciesRows
                  .map(
                    (r) =>
                      `<div class="db-row"><span>${esc(r.label)}${r.count > 1 ? ` ×${r.count}` : ''}</span><span>${n0(r.pts)}</span></div>`,
                  )
                  .join('')}</div>`
              : `<p class="db-empty">Nothing logged. Fish only count when you get close — swim within a few metres of them.</p>`
          }
        </div>
      </div>

      <div class="db-actions">
        <button class="btn btn-primary" data-restart type="button">Dive again</button>
        <button class="btn" data-concepts type="button">Show me the concepts again</button>
        <span class="sp"></span>
        <span class="db-detail">Enter to dive again</span>
      </div>
    </div>`;
  root.appendChild(wrap);

  const canvas = wrap.querySelector('[data-graph]') as HTMLCanvasElement | null;
  if (canvas) {
    // A drawing failure must never take the results panel (or the game) with it.
    try {
      drawGraph(canvas, d, st);
    } catch (err) {
      console.error('debrief: profile graph failed to draw', err);
      canvas.remove();
    }
  }

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onKey, true);
    wrap.remove();
  };
  const restart = (): void => {
    close();
    onRestart();
  };
  function onKey(e: KeyboardEvent): void {
    // Someone else may have taken over the overlay (e.g. a new dive started).
    if (!wrap.isConnected) {
      close();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      restart();
    }
  }

  (wrap.querySelector('[data-restart]') as HTMLButtonElement).addEventListener('click', restart);
  (wrap.querySelector('[data-concepts]') as HTMLButtonElement).addEventListener('click', () => {
    close();
    // Re-read the slides, then drop straight back into a new dive.
    void runWizard(root, { force: true }).then(onRestart);
  });
  window.addEventListener('keydown', onKey, true);
}
