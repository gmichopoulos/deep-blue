/**
 * Depth <-> pressure, and Boyle's law helpers.
 *
 * Everything in this file is *absolute* pressure in bar. Surface pressure is a
 * clean 1.0 bar (CONFIG.surfacePressureBar) so the teaching claim
 * "10 m of water doubles the pressure on you" is exactly true.
 *
 * The non-linearity is the whole lesson: the first 10 m adds as much pressure
 * (1 bar) as the next 20 m of a 30 m dive, which is why a bubble halves in the
 * first 10 m but only shrinks by a further sixth from 30 m to 40 m.
 */
import { CONFIG } from '../config';
import type { Depth, Bar } from '../types';

/** Absolute ambient pressure at a depth. P = P_surface + depth / mswPerBar. */
export function ambientPressure(depth: Depth): Bar {
  return CONFIG.surfacePressureBar + depth / CONFIG.mswPerBar;
}

/** Inverse of {@link ambientPressure}. Clamped at the surface — you cannot be
 *  at a negative depth, and sub-surface pressures just mean "at the surface". */
export function depthForPressure(p: Bar): Depth {
  return Math.max(0, (p - CONFIG.surfacePressureBar) * CONFIG.mswPerBar);
}

/** "You are at 4x surface pressure." P_amb / P_surface. 1.0 at the surface. */
export function pressureMultiplier(depth: Depth): number {
  return ambientPressure(depth) / CONFIG.surfacePressureBar;
}

/**
 * Boyle's law: for a fixed mass of gas at constant temperature, P.V is constant,
 * so a bubble (or a lung, or a BCD) that has volume 1 at the surface has volume
 * P_surface / P_amb at depth. 0.5 at 10 m, 0.25 at 30 m.
 *
 * Read the other way — a bubble carried *up* from 30 m expands 4x — this is why
 * you never hold your breath on ascent.
 */
export function relativeVolume(depth: Depth): number {
  return CONFIG.surfacePressureBar / ambientPressure(depth);
}
