/**
 * Species table — phase 1 uses emoji as placeholder art.
 *
 * Phase 2 replaces rendering with procedural vector art keyed by `Species.id`,
 * so ids are stable, semantic and kebab-case. Do not renumber or rename them.
 *
 * Design intent (this is the risk/reward curve of the whole game):
 *   0–8 m    1–3 pts    common, always there — the consolation prize
 *   8–18 m   4–8 pts    still comfortable, still frequent
 *   17–31 m  24–46 pts  needs real bottom time, rarity drops off a cliff
 *   26–41 m  85–240 pts narcosis depth, gas burns 4–5× surface rate, rare
 *
 * Points scale steeply with depth while rarity falls, so a deep dive is a gamble
 * you pay for in gas and nitrogen rather than a guarantee — but the payoff now
 * clearly justifies it, which the earlier flatter curve did not.
 */

import type { Species } from '../types';

export const SPECIES: Species[] = [
  // ------------------------------------------------------------------ 0–8 m
  {
    id: 'sardine',
    name: 'Sardine',
    emoji: '🐟',
    points: 1,
    minDepth: 0.5,
    maxDepth: 7,
    rarity: 1.0,
    speed: -1.6,
    size: 18,
    blurb:
      'A sardine baitball turns as one because each fish only watches its five nearest neighbours — no leader, no plan.',
  },
  {
    id: 'clownfish',
    name: 'Clownfish',
    emoji: '🐠',
    points: 2,
    minDepth: 1,
    maxDepth: 9,
    rarity: 0.85,
    speed: -0.55,
    size: 22,
    blurb:
      'Every clownfish is born male. The largest of a group turns female, and if she dies her partner changes sex to replace her.',
  },
  {
    id: 'cleaner-shrimp',
    name: 'Cleaner Shrimp',
    emoji: '🦐',
    points: 3,
    minDepth: 2,
    maxDepth: 12,
    rarity: 0.6,
    speed: -0.25,
    size: 19,
    blurb:
      'Cleaner shrimp run a service station: fish queue up and hold still while the shrimp walks into their mouths to pick off parasites.',
  },
  {
    id: 'sea-turtle',
    name: 'Green Sea Turtle',
    emoji: '🐢',
    points: 3,
    minDepth: 0.5,
    maxDepth: 11,
    rarity: 0.45,
    speed: -0.85,
    size: 34,
    blurb:
      'A resting green turtle can hold its breath for hours — it slows its heart to about one beat every nine seconds.',
  },

  // ----------------------------------------------------------------- 8–18 m
  {
    id: 'pufferfish',
    name: 'Pufferfish',
    emoji: '🐡',
    points: 4,
    minDepth: 7,
    maxDepth: 16,
    rarity: 0.55,
    speed: -0.45,
    size: 26,
    blurb:
      'A puffer inflates with water, not air — an air-filled fish could not survive the pressure change of even a few metres.',
  },
  {
    id: 'jellyfish',
    name: 'Moon Jellyfish',
    emoji: '🪼',
    points: 5,
    minDepth: 5,
    maxDepth: 18,
    rarity: 0.5,
    speed: -0.12,
    size: 24,
    blurb:
      'Moon jellies are 95% water and have no brain, blood or heart — just a nerve net firing around the bell rim.',
  },
  {
    id: 'moray-eel',
    name: 'Moray Eel',
    emoji: '🐍',
    points: 9,
    minDepth: 10,
    maxDepth: 19,
    rarity: 0.34,
    speed: -0.2,
    size: 30,
    blurb:
      'Morays gape not to threaten but to breathe, and they have a second set of jaws in the throat that lunges forward to drag prey down.',
  },
  {
    id: 'reef-crab',
    name: 'Red Reef Crab',
    emoji: '🦀',
    points: 11,
    minDepth: 12,
    maxDepth: 22,
    rarity: 0.3,
    speed: -0.15,
    size: 24,
    blurb:
      'Below about 15 m this crab is not red any more — water absorbs red light first, so without a torch it reads as flat grey-black.',
  },

  // ---------------------------------------------------------------- 18–28 m
  {
    id: 'octopus',
    name: 'Common Octopus',
    emoji: '🐙',
    points: 24,
    minDepth: 17,
    maxDepth: 27,
    rarity: 0.26,
    speed: -0.35,
    size: 32,
    blurb:
      'Two thirds of an octopus’s neurons are in its arms — a severed arm will still reach for and grab food on its own.',
  },
  {
    id: 'squid',
    name: 'Bigfin Reef Squid',
    emoji: '🦑',
    points: 34,
    minDepth: 20,
    maxDepth: 30,
    rarity: 0.17,
    speed: -0.9,
    size: 30,
    blurb:
      'Squid are colour-blind, yet they signal in colour — they read the world through the chromatic blur of an oddly shaped pupil.',
  },
  {
    id: 'lobster',
    name: 'Spiny Lobster',
    emoji: '🦞',
    points: 46,
    minDepth: 22,
    maxDepth: 31,
    rarity: 0.12,
    speed: -0.18,
    size: 28,
    blurb:
      'Spiny lobsters migrate in single-file queues of fifty, and navigate by sensing the Earth’s magnetic field.',
  },

  // ---------------------------------------------------------------- 28–40 m
  {
    id: 'reef-shark',
    name: 'Grey Reef Shark',
    emoji: '🦈',
    points: 85,
    minDepth: 26,
    maxDepth: 38,
    rarity: 0.1,
    speed: -1.5,
    size: 68,
    blurb:
      'Reef sharks read the electrical fields of a beating heart through jelly-filled pores — at 30 m they found you long before you saw them.',
  },
  {
    id: 'whale',
    name: 'Humpback Whale',
    emoji: '🐋',
    points: 140,
    minDepth: 29,
    maxDepth: 41,
    rarity: 0.045,
    speed: -1.0,
    size: 124,
    blurb:
      'A humpback dives on one breath and its lungs collapse on purpose — squeezing the air out of them is how it avoids the decompression sickness you are down here risking.',
  },
  {
    id: 'nautilus',
    name: 'Chambered Nautilus',
    emoji: '🐚',
    points: 240,
    minDepth: 35,
    maxDepth: 41,
    rarity: 0.022,
    speed: -0.22,
    size: 32,
    blurb:
      'The trophy of the reef: a living fossil that rises from 400 m at night, pumping gas in and out of its shell chambers — a buoyancy compensator built 500 million years before yours.',
  },
];

const BY_ID = new Map<string, Species>(SPECIES.map((s) => [s.id, s]));

export function speciesById(id: string): Species | undefined {
  return BY_ID.get(id);
}
