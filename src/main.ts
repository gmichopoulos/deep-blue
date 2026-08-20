/**
 * Bootstrap: input, the real-time → dive-time clock, and the wiring between
 * the simulation, the renderer, the HUD and the overlays.
 */
import './ui/styles.css';
import { CONFIG } from './config';
import type { VerticalInput } from './types';
import { createEngine } from './sim/engine';
import { createRenderer } from './world/render';
import { createHud } from './ui/hud';
import { isTopicOpen } from './ui/tooltips';
import { reserveBar } from './ui/units';
import { runWizard } from './ui/wizard';
import { buildDebrief, showDebrief } from './ui/debrief';
import { runSelfTest } from './sim/selftest';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;
const overlay = document.getElementById('overlay') as HTMLElement;

// Time compression is a playtesting dial: ?tc=4 in the URL, or DeepBlue.setTimeCompression(4).
let timeCompression: number = CONFIG.timeCompression;
const tcParam = Number(new URLSearchParams(location.search).get('tc'));
if (Number.isFinite(tcParam) && tcParam > 0) timeCompression = tcParam;

const engine = createEngine();
engine.setTimeCompression(timeCompression);
const renderer = createRenderer(canvas);
const hud = createHud(hudRoot);

const held = new Set<string>();
let paused = false;
let running = false;

function currentInput(): VerticalInput {
  const up = held.has('ArrowUp') || held.has('w') || held.has('W');
  const down = held.has('ArrowDown') || held.has('s') || held.has('S');
  if (up && !down) return 'ascend';
  if (down && !up) return 'descend';
  return 'hold';
}

window.addEventListener('keydown', (e) => {
  if (e.key === ' ') {
    e.preventDefault();
    if (running) paused = !paused;
    return;
  }
  if (['ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault();
  held.add(e.key);
});
window.addEventListener('keyup', (e) => held.delete(e.key));
window.addEventListener('blur', () => held.clear());

// Touch / mouse: top half of the scene ascends, bottom half descends.
function pointerInput(e: PointerEvent, down: boolean) {
  held.delete('ArrowUp');
  held.delete('ArrowDown');
  if (!down) return;
  held.add(e.clientY < window.innerHeight / 2 ? 'ArrowUp' : 'ArrowDown');
}
canvas.addEventListener('pointerdown', (e) => pointerInput(e, true));
canvas.addEventListener('pointermove', (e) => { if (e.pressure > 0 || e.buttons) pointerInput(e, true); });
window.addEventListener('pointerup', (e) => pointerInput(e, false));
window.addEventListener('resize', () => renderer.resize());

let lastReal = performance.now();

function frame(now: number) {
  const realDt = Math.min(0.1, (now - lastReal) / 1000); // clamp tab-switch jumps
  lastReal = now;

  // The dive holds while an explainer is open. The info badges pulse hardest
  // exactly when the player is in trouble, and at 10x compression 30 seconds of
  // reading would burn five dive-minutes of gas behind a modal they cannot see past.
  // The unit toggle can change the reserve rule mid-dive; keep the sim in step.
  engine.setReserveBar(reserveBar());

  if (running && !paused && !isTopicOpen()) {
    // Sub-step so that high compression never destabilises the integration.
    let remaining = realDt * timeCompression;
    const maxStep = 0.25;
    while (remaining > 0) {
      const dt = Math.min(maxStep, remaining);
      remaining -= dt;
      if (engine.step(dt, currentInput())) {
        finishDive();
        break;
      }
    }
  }

  renderer.draw(engine.state);
  hud.update(engine.state);
  requestAnimationFrame(frame);
}

function finishDive() {
  running = false;
  const debrief = buildDebrief(engine.state);
  showDebrief(overlay, debrief, startDive);
}

function startDive() {
  overlay.innerHTML = '';
  engine.reset();
  renderer.resize();
  paused = false;
  running = true;
  lastReal = performance.now();
}

async function boot() {
  renderer.resize();
  requestAnimationFrame(frame);
  await runWizard(overlay);
  startDive();
}

// Playtesting handles.
(window as unknown as Record<string, unknown>).DeepBlue = {
  CONFIG,
  engine,
  renderer,
  hud,
  runSelfTest,
  get timeCompression() { return timeCompression; },
  setTimeCompression(v: number) { timeCompression = v; engine.setTimeCompression(v); },
};

boot();
