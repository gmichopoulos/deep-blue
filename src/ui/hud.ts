/**
 * ui/hud.ts — the dive computer.
 *
 * The DOM is built exactly once in `createHud`. `update()` runs every frame and
 * only ever writes text content, inline widths and state classes — never
 * innerHTML. All colour lives in styles.css, driven by the `.ok / .warn /
 * .danger` class on each widget.
 */

import { CONFIG } from '../config';
import type { DiveState } from '../types';
import { ambientPressure, pressureMultiplier } from '../sim/pressure';
import { minutesOfGasLeft } from '../sim/gas';
import { netScore, diversityMultiplier } from '../sim/scoring';
import * as U from './units';
import { openTopic, urgentTopic, type TopicKey } from './tooltips';

export interface Hud {
  update(state: DiveState): void;
  destroy(): void;
}

type WidgetState = 'ok' | 'warn' | 'danger';

// ---------------------------------------------------------------- scales

/** Tissue bar runs 0 → 1.25 of the surfacing limit; the 1.0 tick sits at 80%. */
const LOAD_SCALE_MAX = 1.25;
const LOAD_TICK_PCT = (1 / LOAD_SCALE_MAX) * 100;

/** Ascent gauge runs 0 → the diver's terminal ascent speed. */
const ASC_SCALE_MAX = CONFIG.diver.maxAscentRate;
const ASC_ZONE_PCT = (CONFIG.maxAscentRateMpm / ASC_SCALE_MAX) * 100;

/** The safety-stop widget appears once you are shallower than this. */
const SAFETY_SHOW_DEPTH = 10;

// ---------------------------------------------------------------- dom helpers

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Write text only when it actually changed — keeps layout thrash off the frame. */
function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function setWidth(node: HTMLElement, pct: number): void {
  const v = `${clamp(pct, 0, 100).toFixed(1)}%`;
  if (node.style.width !== v) node.style.width = v;
}

function setLeft(node: HTMLElement, pct: number): void {
  const v = `${clamp(pct, 0, 100).toFixed(1)}%`;
  if (node.style.left !== v) node.style.left = v;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function mmss(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

// ---------------------------------------------------------------- widget

class Widget {
  readonly root: HTMLDivElement = el('div', 'widget ok');
  readonly badge: HTMLButtonElement = el('button', 'info-badge');
  readonly body: HTMLDivElement = el('div', 'widget-body');
  readonly labelEl: HTMLSpanElement = el('span', 'widget-label');
  topic: TopicKey;

  private state: WidgetState = 'ok';
  private shown = true;
  private pulsing = false;

  private readonly onBadge = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    openTopic(this.topic);
  };

  constructor(label: string, topic: TopicKey) {
    this.topic = topic;
    this.root.dataset.widget = topic;
    this.labelEl.textContent = label;

    this.badge.type = 'button';
    this.badge.textContent = 'i';
    this.badge.setAttribute('aria-label', `What is this? — ${label}`);
    this.badge.addEventListener('click', this.onBadge);

    const head = el('div', 'widget-head');
    head.append(this.labelEl, this.badge);
    this.root.append(head, this.body);
  }

  setLabel(text: string): void {
    setText(this.labelEl, text);
  }

  setState(s: WidgetState): void {
    if (s === this.state) return;
    this.root.classList.remove(this.state);
    this.root.classList.add(s);
    this.state = s;
  }

  setShown(on: boolean): void {
    if (on === this.shown) return;
    this.root.classList.toggle('hidden', !on);
    this.shown = on;
  }

  setPulsing(on: boolean): void {
    if (on === this.pulsing) return;
    this.badge.classList.toggle('pulse', on);
    this.pulsing = on;
  }

  dispose(): void {
    this.badge.removeEventListener('click', this.onBadge);
    this.root.remove();
  }
}

function meter(extra = ''): { root: HTMLDivElement; fill: HTMLDivElement } {
  const root = el('div', `meter${extra ? ' ' + extra : ''}`);
  const fill = el('div', 'meter-fill');
  root.append(fill);
  return { root, fill };
}

// ---------------------------------------------------------------- which widget owns which topic

const TOPIC_WIDGET: Record<TopicKey, string> = {
  pressure: 'depth',
  narcosis: 'depth',
  gas: 'gas',
  ndl: 'ndl',
  deco: 'ndl',
  ascent: 'ascent',
  'safety-stop': 'safety',
  score: 'score',
};

// ---------------------------------------------------------------- factory

export function createHud(root: HTMLElement): Hud {
  const widgets: Record<string, Widget> = {};

  // ---- 1. depth + ambient pressure -------------------------------------
  // Unit switch, above the gauges: the wizard sets it once, this changes it any time.
  const unitToggle = el('button', 'unit-toggle');
  unitToggle.type = 'button';
  const paintToggle = () => {
    unitToggle.textContent = U.getUnits() === 'metric' ? 'm · bar' : 'ft · psi';
    unitToggle.title = `Switch to ${U.getUnits() === 'metric' ? 'feet and psi' : 'metres and bar'}`;
  };
  unitToggle.addEventListener('click', () => {
    U.toggleUnits();
    paintToggle();
  });
  paintToggle();
  root.append(unitToggle);

  const wDepth = new Widget('Depth', 'pressure');
  const depthValue = el('span', 'value', '0.0');
  const depthUnit = el('span', 'unit', 'm');
  const depthRow = el('div', 'readout');
  depthRow.append(depthValue, depthUnit);
  const depthSub = el('div', 'sub', '1.0 bar · ×1.0 surface pressure');
  const narcChip = el('span', 'chip hidden', 'Narcosis');
  narcChip.addEventListener('click', () => openTopic('narcosis'));
  wDepth.body.append(depthRow, depthSub, narcChip);
  widgets.depth = wDepth;

  // ---- 2. dive time ------------------------------------------------------
  const wTime = new Widget('Dive time', 'ndl');
  const timeValue = el('span', 'value sm', '0:00');
  const timeRow = el('div', 'readout');
  timeRow.append(timeValue);
  const timeSub = el('div', 'sub dim', 'max 0.0 m');
  wTime.body.append(timeRow, timeSub);
  widgets.time = wTime;

  // ---- 3. gas ------------------------------------------------------------
  const wGas = new Widget('Gas', 'gas');
  const gasValue = el('span', 'value', String(CONFIG.tank.startBar));
  const gasUnit = el('span', 'unit', 'bar');
  const gasRow = el('div', 'readout');
  gasRow.append(gasValue, gasUnit);
  const gasMeter = meter('tall');
  const gasMin = el('div', 'sub', '≈ — min at this depth');
  const gasRate = el('div', 'sub dim', 'breathing 1.0× surface rate');
  wGas.body.append(gasRow, gasMeter.root, gasMin, gasRate);
  widgets.gas = wGas;

  // ---- 4. NDL / deco -----------------------------------------------------
  const wNdl = new Widget('No-stop time', 'ndl');
  const ndlValue = el('span', 'value', '∞');
  const ndlUnit = el('span', 'unit', 'min');
  const ndlRow = el('div', 'readout');
  ndlRow.append(ndlValue, ndlUnit);
  const ndlSub = el('div', 'sub dim', 'clear to surface');
  const ndlNote = el('div', 'note', '');
  ndlNote.style.display = 'none';
  wNdl.body.append(ndlRow, ndlSub, ndlNote);
  widgets.ndl = wNdl;

  // ---- 5. tissue nitrogen ------------------------------------------------
  const wLoad = new Widget('Tissue nitrogen', 'ndl');
  const loadValue = el('span', 'value sm', '0');
  const loadUnit = el('span', 'unit', '% of limit');
  const loadRow = el('div', 'readout');
  loadRow.append(loadValue, loadUnit);
  const loadMeter = meter('tall');
  // the marked threshold: 1.0 = the surfacing limit, drawn at 80% of the track
  const loadTick = el('div', 'meter-tick');
  loadTick.style.left = `${LOAD_TICK_PCT}%`;
  loadMeter.root.append(loadTick);
  const loadScale = el('div', 'meter-label');
  loadScale.append(el('span', undefined, 'clean'), el('span', undefined, 'must stop'));
  wLoad.body.append(loadRow, loadMeter.root, loadScale);
  widgets.load = wLoad;

  // ---- 6. ascent rate ----------------------------------------------------
  const wAsc = new Widget('Ascent rate', 'ascent');
  const ascValue = el('span', 'value sm', '0.0');
  const ascUnit = el('span', 'unit', 'm/min');
  const ascRow = el('div', 'readout');
  ascRow.append(ascValue, ascUnit);
  const ascMeter = el('div', 'meter zoned tall');
  ascMeter.style.setProperty('--zone', `${ASC_ZONE_PCT}%`);
  const ascNeedle = el('div', 'meter-needle');
  ascNeedle.style.left = '0%';
  ascMeter.append(ascNeedle);
  const ascScale = el('div', 'meter-label');
  const ascScaleLimit = el('span', undefined, '');
  const ascScaleMax = el('span', undefined, '');
  ascScale.append(
    el('span', undefined, '0'),
    ascScaleLimit,
    ascScaleMax,
  );
  const strikeMeter = meter('thin');
  const strikeLabel = el('div', 'meter-label');
  strikeLabel.append(el('span', undefined, 'ascent warning'));
  wAsc.body.append(ascRow, ascMeter, ascScale, strikeMeter.root, strikeLabel);
  widgets.ascent = wAsc;

  // ---- 7. safety stop ----------------------------------------------------
  const wSafe = new Widget('Safety stop', 'safety-stop');
  const safeValue = el('span', 'value sm', mmss(CONFIG.safetyStop.durationSec));
  const safeUnit = el('span', 'unit', '');
  const safeRow = el('div', 'readout');
  safeRow.append(safeValue, safeUnit);
  const safeMeter = meter('tall');
  const safeSub = el('div', 'sub dim', 'hold 5 m to start the clock');
  wSafe.body.append(safeRow, safeMeter.root, safeSub);
  wSafe.setShown(false);
  widgets.safety = wSafe;

  // ---- 8. score ----------------------------------------------------------
  const wScore = new Widget('Score', 'score');
  const scoreValue = el('span', 'value sm', '0');
  const scoreUnit = el('span', 'unit', 'pts');
  const scoreRow = el('div', 'readout');
  scoreRow.append(scoreValue, scoreUnit);
  const scoreSub = el('div', 'sub dim', '0 species observed');
  wScore.body.append(scoreRow, scoreSub);
  widgets.score = wScore;

  // Score first: it is the thing the player is optimising, and at the bottom of an
  // eight-card stack it was the first casualty of a short viewport.
  const order = [wScore, wDepth, wTime, wGas, wNdl, wLoad, wAsc, wSafe];
  for (const w of order) root.append(w.root);

  let pulsingWidget: Widget | null = null;

  // -------------------------------------------------------------- update
  function update(state: DiveState): void {
    const depth = Math.max(0, state.depth);

    // 1. depth ------------------------------------------------------------
    setText(depthValue, U.depthNum(depth));
    setText(depthUnit, U.depthUnit());
    setText(
      depthSub,
      `${U.ambientPressureLabel(ambientPressure(depth))} · ×${pressureMultiplier(depth).toFixed(1)} surface pressure`,
    );
    const narced = depth >= CONFIG.narcosisOnsetM;
    // Gloss the term inline — this chip is where most players meet the word for
    // the first time, and a bare label would be jargon they cannot act on.
    setText(narcChip, narced && depth >= CONFIG.recLimitM ? 'Narcosis — judgement dulled' : 'Narcosis — thinking slows');
    narcChip.classList.toggle('hidden', !narced);
    wDepth.topic = narced ? 'narcosis' : 'pressure';
    wDepth.setState(
      depth >= CONFIG.recLimitM ? 'danger' : narced ? 'warn' : 'ok',
    );

    // 2. dive time --------------------------------------------------------
    setText(timeValue, mmss(state.t));
    setText(timeSub, `max ${U.depth(state.maxDepth)}`);

    // 3. gas --------------------------------------------------------------
    const bar = Math.max(0, state.tankBar);
    setText(gasValue, U.tankPressureNum(bar));
    setText(gasUnit, U.pressureUnit());
    setWidth(gasMeter.fill, (bar / CONFIG.tank.startBar) * 100);
    const minsLeft = minutesOfGasLeft(bar, depth);
    setText(
      gasMin,
      Number.isFinite(minsLeft)
        ? `≈ ${Math.max(0, Math.floor(minsLeft))} min at this depth`
        : '≈ — min at this depth',
    );
    const rateX = state.sacNowLpm > 0 ? state.sacNowLpm / CONFIG.sacLpm : 1;
    setText(gasRate, `breathing ${rateX.toFixed(1)}× surface rate`);
    wGas.setState(
      bar <= U.reserveBar() * 0.5
        ? 'danger'
        : bar < U.reserveBar()
          ? 'warn'
          : 'ok',
    );

    // 4. NDL / deco -------------------------------------------------------
    if (state.inDeco || state.ceiling > 0) {
      wNdl.setLabel('Decompression');
      wNdl.topic = 'deco';
      setText(ndlValue, 'STOP');
      if (!ndlValue.classList.contains('sm')) ndlValue.classList.add('sm');
      setText(ndlUnit, '');
      setText(ndlSub, `go no higher than ${U.depth(state.ceiling)}`);
      setText(ndlNote, 'You must stop before surfacing.');
      if (ndlNote.style.display !== '') ndlNote.style.display = '';
      wNdl.setState('danger');
    } else {
      wNdl.setLabel('No-stop time');
      wNdl.topic = 'ndl';
      const unlimited = !Number.isFinite(state.ndlMin);
      const mins = unlimited ? Infinity : Math.max(0, Math.floor(state.ndlMin));
      setText(ndlValue, unlimited ? '∞' : String(mins));
      if (unlimited) ndlValue.classList.remove('sm');
      else if (!ndlValue.classList.contains('sm')) ndlValue.classList.add('sm');
      setText(ndlUnit, unlimited ? '' : 'min');
      setText(ndlSub, unlimited ? 'clear to surface' : 'left at this depth');
      if (ndlNote.style.display !== 'none') ndlNote.style.display = 'none';
      wNdl.setState(mins <= 0 ? 'danger' : mins < 5 ? 'warn' : 'ok');
    }

    // 5. tissue loading ---------------------------------------------------
    const load = Math.max(0, state.loadPct);
    setText(loadValue, String(Math.round(load * 100)));
    setWidth(loadMeter.fill, (load / LOAD_SCALE_MAX) * 100);
    wLoad.setState(load >= 1 ? 'danger' : load >= 0.8 ? 'warn' : 'ok');
    wLoad.topic = load >= 1 ? 'deco' : 'ndl';

    // 6. ascent rate ------------------------------------------------------
    const up = -state.verticalRate; // positive when ascending
    if (up > 0.3) {
      setText(ascValue, U.rateValue(up).toFixed(U.depthUnit() === 'm' ? 1 : 0));
      setText(ascUnit, `${U.rateUnit()} ↑`);
    } else if (state.verticalRate > 0.3) {
      setText(ascValue, U.rateValue(state.verticalRate).toFixed(U.depthUnit() === 'm' ? 1 : 0));
      setText(ascUnit, `${U.rateUnit()} ↓`);
    } else {
      setText(ascValue, '0.0');
      setText(ascUnit, 'holding');
    }
    setLeft(ascNeedle, (Math.max(0, up) / ASC_SCALE_MAX) * 100);
    setWidth(strikeMeter.fill, clamp(state.ascentStrike, 0, 1) * 100);
    const overSpeed = up > CONFIG.maxAscentRateMpm;
    wAsc.setState(
      state.ascentStrike > 0.6
        ? 'danger'
        : overSpeed || state.ascentStrike > 0.02
          ? 'warn'
          : 'ok',
    );

    // 7. safety stop ------------------------------------------------------
    // only relevant once you have been deep and are on the way back up
    const showSafety =
      depth <= SAFETY_SHOW_DEPTH &&
      (state.maxDepth > SAFETY_SHOW_DEPTH || state.safetyStopSec > 0);
    wSafe.setShown(showSafety);
    if (showSafety) {
      const total = CONFIG.safetyStop.durationSec;
      const done = state.safetyStopDone;
      const remain = Math.max(0, total - state.safetyStopSec);
      const inWindow =
        depth >= CONFIG.safetyStop.depthM - CONFIG.safetyStop.toleranceM &&
        depth <= CONFIG.safetyStop.depthM + CONFIG.safetyStop.toleranceM;
      setText(safeValue, done ? '✓' : mmss(remain));
      setText(
        safeUnit,
        done ? 'stop complete' : `at ${U.teach(CONFIG.safetyStop.depthM, 0)}`,
      );
      setWidth(safeMeter.fill, (state.safetyStopSec / total) * 100);
      setText(
        safeSub,
        done
          ? 'insurance paid — finish the ascent slowly'
          : inWindow
            ? 'holding — clock is running'
            : `drift to ${U.teach(CONFIG.safetyStop.depthM, 0)} to start the clock`,
      );
      wSafe.setState(done ? 'ok' : inWindow ? 'ok' : 'warn');
    }

    // the ascent scale is labelled in the player's units, not always metric
    setText(ascScaleLimit, `limit ${U.rateValue(CONFIG.maxAscentRateMpm).toFixed(0)}`);
    setText(ascScaleMax, U.rateValue(ASC_SCALE_MAX).toFixed(0));

    // 8. score ------------------------------------------------------------
    // Net of the ascent penalty, so a rushed ascent is visible the moment it
    // costs you rather than only in the debrief.
    const penalty = Math.round(state.ascentPenalty ?? 0);
    setText(scoreValue, netScore(state).toString());
    const species = state.observed ? state.observed.size : 0;
    const mult = diversityMultiplier(species);
    setText(
      scoreSub,
      penalty > 0
        ? `${species} species ×${mult.toFixed(2)} · −${penalty} fast ascent`
        : `${species} species ×${mult.toFixed(2)}`,
    );
    wScore.setState(penalty > 0 ? 'warn' : 'ok');

    // -------- pulsing ⓘ badge: the discovery mechanic ---------------------
    const urgent = urgentTopic(state);
    const target = urgent ? widgets[TOPIC_WIDGET[urgent]] ?? null : null;
    if (target !== pulsingWidget) {
      pulsingWidget?.setPulsing(false);
      target?.setPulsing(true);
      pulsingWidget = target;
    }
  }

  function destroy(): void {
    pulsingWidget = null;
    for (const w of order) w.dispose();
  }

  return { update, destroy };
}
