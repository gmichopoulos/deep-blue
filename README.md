# Deep Blue

A browser game that teaches the physics and physiology of recreational scuba diving —
pressure, gas consumption, nitrogen loading, and why the ascent is the dangerous part —
by making you live the trade-off instead of reading about it.

You control a diver who swims forward automatically. You choose only one thing: **up, down,
or hold**. The interesting fish are deep. Deep costs air fast, loads nitrogen fast, and buys
you a decompression obligation you have to pay back on the way up.

## Play

```bash
npm install
npm run dev
```

Then open the printed URL. An eight-slide wizard runs on first load (title, units, the diver,
pressure, gas, no-stop time, ascent, safety stop); it is remembered in `localStorage` and can
be replayed from the end-of-dive screen.

To deploy, `npm run build` type-checks and produces a static `dist/` — three files, all asset
references relative, no CDN and no network calls. Drop it on any static host. It does need to
be *served*: the entry point is an ES module, so `file://` will not work. `npm run preview`
serves the built output locally.

**Controls** — hold `↑`/`W` to ascend, `↓`/`S` to descend, release to hold depth, `Space` to
pause. On touch or mouse, press the top half of the scene to rise and the bottom half to sink.
The dive also holds while an explainer popover is open, so reading one never costs you gas.

## Units

Metric (metres / bar) or imperial (feet / psi). The wizard's second slide asks, pre-selecting
from the browser locale — US and US-territory locales default to imperial, everywhere else to
metric. There is a toggle above the gauges to change it mid-dive, and the choice persists in
`localStorage`.

The simulation is metric throughout: msw and bar are the units decompression theory is written
in, and nothing under `src/sim/` imports [src/ui/units.ts](src/ui/units.ts). Conversion happens
in the presentation layer, at the last moment before display.

Two wrinkles worth knowing:

- **Teaching depths are substituted, not converted.** 5 m shows as "15 ft", 40 m as "130 ft",
  30 m as "100 ft" — the round numbers every US table and course actually uses, rather than
  the arithmetically correct 16.4 / 131 / 98. Only exact matches from a small table are
  substituted, so live gauge readings are always true conversions.
- **The gas reserve is genuinely different in the two systems.** Metric courses teach "be back
  with 50 bar"; US courses teach "be back with 500 psi", which is only ~34.5 bar. Deep Blue
  honours whichever the player chose, so an imperial diver may legitimately breathe about
  16 bar deeper into the tank before the gauge warns them — and the reserve-intact bonus is
  judged against that same number. This is the one place the unit choice changes the game and
  not just the wording. `reserveBar()` in `src/ui/units.ts` is the single source of it; the
  engine is told the current value each frame via `setReserveBar()`.

## How you score

Points are only banked on a **clean surfacing**. A dive that ends out of air, bent, or past the
depth limit scores zero, however much you saw on the way down. `src/sim/scoring.ts` is the
single definition of the number; anything shown to the player goes through it.

- **Fish points** scale steeply with depth — 1 for a sardine, 24 for an octopus, 85 for a reef
  shark, 240 for a nautilus — but the deep species are correspondingly rare, so going deep is a
  gamble you pay for in gas and nitrogen rather than a guarantee.
- **Repeat sightings decay**: each further sighting of a species you have already logged is
  worth ×0.55 of the last, bottoming out at 10% of face value and never less than 1 point, so
  the three minutes of the safety stop are never dead time. A cap of 80 scoring sightings per
  species per dive stops that 1-point floor turning into points-for-time.
- **A diversity multiplier** rewards breadth: up to 1.9× for a dive that finds many different
  species, which is the counterweight to that 1-point floor.
- **A fast-ascent penalty** docks points live for time spent above the 9 m/min limit, scaled by
  how far over you are — the cost of the overshoots you get away with.
- **End-of-dive bonuses**, in their own bucket so the diversity multiplier cannot inflate them:
  the safety stop, surfacing with the reserve intact, and points per bar of spare gas above it.

## Playtesting dials

Time is compressed so a realistic 30-minute dive plays in a few minutes. Everything the game
*shows* you is in real dive minutes.

- `?tc=4` in the URL sets the compression factor (dive-seconds per real second; default 10).
- `DeepBlue.setTimeCompression(4)` in the console does the same live.
  Note the dial is not perfectly neutral: control gains are authored in real seconds and
  divided by the compression, which keeps the diver feeling identical but means a descent to
  30 m costs ~85 dive-seconds at 4× and ~102 at 25×. You cannot have both constant feel and
  compression-invariant physics from an acceleration model; feel won. It is pinned by an
  `it.fails` test in `tests/engine.test.ts` so the trade stays visible.
- `DeepBlue.runSelfTest()` prints the physics core's sanity checks as a console table — the
  pressure anchors, the gas ratios, and NDL at 12/18/30/40 m against the published
  recreational limits.
- `DeepBlue.CONFIG`, `DeepBlue.engine`, `DeepBlue.renderer` and `DeepBlue.hud` are also exposed
  for poking at a live dive.
- Every other tunable — SAC rate, tank size, gradient factors, ascent limit, spawn rates,
  scoring weights — lives in [src/config.ts](src/config.ts).

## Tests

```bash
npm test     # vitest, node environment
npm run check # tsc --noEmit
```

83 tests over the physics, the tissue model and the engine: the pressure anchors the game
teaches, ZH-L16C against the published recreational limits, the three-way consistency of
no-stop time / ceiling / tissue loading, the scoring rules, and full scripted dives for all
five end reasons. One of the 83 is a deliberate `it.fails` tripwire documenting the
time-compression divergence above; it will flip to a normal pass if anyone reconciles it.

Asserted numbers are marked `LAW` (must always hold for any correct implementation) or
`SNAPSHOT` (a regression guard on the current coefficients and config). The suite runs in a
plain node environment — `src/sim/` and `src/world/` are pure and DOM-free, and if a test ever
needs `document` that is a signal a module grew a dependency it should not have.

## How it is modelled

| Concept | Model |
|---|---|
| Ambient pressure | `1.0 + depth/10` bar, so "10 m doubles the pressure" is exactly true |
| Boyle | `relativeVolume = P_surface / P_amb` — the shrinking bubble on the ruler |
| Gas consumption | `SAC × ambient pressure × exertion`, drawn from an AL80 (11.1 L @ 200 bar) |
| Nitrogen loading | Bühlmann ZH-L16C, 16 nitrogen compartments, Haldane exponential uptake |
| No-deco limit | The same equation inverted per compartment, minimum across all 16 |
| Ceiling / DCS | M-value line `(P − a) × b` with gradient factors; staying above the ceiling bends you |

Failure states are out of air, ascent too fast, ceiling violation (or surfacing with one), and
past 45 m. Exceeding the no-stop limit is *not* an instant loss — it flips you into deco with a
visible ceiling and a chance to fix it.

See [PLAN.md](PLAN.md) for the full design, the module map, and what is deliberately out of scope.

It is not a dive planner. It is a way to stop being intimidated by the numbers.
