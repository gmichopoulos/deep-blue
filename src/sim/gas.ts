/**
 * Gas consumption.
 *
 * The only idea here: a diver's lungs move a roughly constant *volume* per
 * minute, but at depth every breath is denser. So the surface-equivalent
 * litres drawn from the tank scale linearly with ambient pressure.
 *
 *   consumption (surface L/min) = SAC x P_amb x exertion
 *
 * At 30 m (4 bar) an AL80 empties four times as fast as at the surface. That is
 * the entire "gas planning scales with depth" lesson, and it needs no more model
 * than this.
 */
import { CONFIG } from '../config';
import type { Depth, Bar } from '../types';
import { ambientPressure } from './pressure';

/**
 * Surface-equivalent litres of air consumed per *dive* minute at this depth.
 * `exertion` is a multiplier (see CONFIG.exertion): 1.0 relaxed, up to ~1.25
 * while finning hard up an ascent.
 */
export function consumptionLpm(depth: Depth, exertion: number = 1): number {
  return CONFIG.sacLpm * ambientPressure(depth) * exertion;
}

/**
 * Tank-pressure drop per *dive* second. Litres consumed per second divided by
 * the tank's internal volume gives bar/s, because for an ideal gas at fixed
 * temperature the tank holds `volumeL x tankBar` surface-litres.
 */
export function barPerSecond(depth: Depth, exertion: number = 1): number {
  return consumptionLpm(depth, exertion) / 60 / CONFIG.tank.volumeL;
}

/**
 * Dive-minutes until the tank is empty if the diver stays at this depth.
 * Always >= 0. Relaxed breathing is assumed — this is the optimistic number the
 * HUD shows, which is itself a teaching point (stress makes it shrink).
 */
export function minutesOfGasLeft(tankBar: Bar, depth: Depth): number {
  const litres = Math.max(0, tankBar) * CONFIG.tank.volumeL;
  return litres / consumptionLpm(depth);
}

/**
 * Same, but only counting the gas above the "rock bottom" reserve — the amount
 * you are actually allowed to plan on breathing at depth. Goes to 0 at reserve.
 */
export function minutesToReserve(
  tankBar: Bar,
  depth: Depth,
  /** Defaults to the metric rule; pass the player's actual reserve, which differs
   *  by training tradition (50 bar vs 500 psi). See `reserveBar()` in ui/units.ts. */
  reserveBar: Bar = CONFIG.tank.reserveBar,
): number {
  const usable = Math.max(0, tankBar - reserveBar) * CONFIG.tank.volumeL;
  return usable / consumptionLpm(depth);
}
