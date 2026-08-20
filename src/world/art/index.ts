/**
 * Registry of procedural vector art, keyed by `Species.id`.
 * Each group module is owned by exactly one author.
 */
import type { FishArt } from './types';
import { SHALLOW_ART } from './shallow';
import { MID_ART } from './mid';
import { DEEP_ART } from './deep';
import { TROPHY_ART } from './trophy';

export type { FishArt, FishArtArgs } from './types';

export const FISH_ART: Record<string, FishArt> = {
  ...SHALLOW_ART,
  ...MID_ART,
  ...DEEP_ART,
  ...TROPHY_ART,
};
