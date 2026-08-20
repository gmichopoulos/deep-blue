# Deep Blue — design notes

A browser game that teaches the physics and physiology of recreational scuba diving
by making you *feel* the trade-off between bottom time and a safe ascent.

This is the design document and the record of *why*. For how to run it, see [README.md](README.md).

## Product decisions (locked)

| Decision | Choice |
|---|---|
| Stack | Vite + TypeScript, `<canvas>` scene + DOM HUD/overlays. `npm run build` → static `dist/`, no runtime dependencies |
| Control | Auto-scrolling side view. Diver swims forward at a constant rate; player only controls **ascend / descend / hold**. Flappy-Bird feel, depth profile is the whole game. |
| View | The entire water column (0 m → `CONFIG.seabedM`, currently 46 m) is on screen at once and never scrolls vertically, with a depth+pressure ruler down the left edge. Depth is literally vertical position. |
| Time | `CONFIG.timeCompression` dive-seconds per real second, default **10** (a 30-min dive plays in 3 min). Every number shown to the player is in real dive minutes. |
| Art | Procedural vector art, one drawing function per species in `src/world/art/`, keyed by `Species.id`. All 14 species are covered; the emoji path in the renderer remains as a fallback for any species without a registered function. |
| Units | The simulation is **metric only** (msw / bar) — the units the science is taught in. Metric/imperial is a presentation layer, `src/ui/units.ts`, chosen in the wizard and switchable mid-dive. |

## The model

- **Pressure**: `P_amb = 1.0 + depth/10` bar. Surface pressure kept at a clean 1.0 bar so the
  teaching claim "10 m doubles the pressure" is exactly true. The ruler annotates ×2 at 10 m,
  ×3 at 20 m, ×4 at 30 m, and shows a bubble shrinking by `1/P` (Boyle) — this is the
  non-linearity the player needs to internalise: the first 10 m costs as much pressure as
  the next 20 m of a 30 m dive.
- **Gas**: consumption = `SAC × P_amb × exertion`, drawn from an AL80 (11.1 L, 200 bar), with
  exertion 1.0 holding / 1.15 descending / 1.25 ascending. At 30 m you empty the tank 4×
  faster than at the surface. Nothing else is needed to make the point.
- **Tissues**: Bühlmann ZH-L16C nitrogen compartments, Haldane exponential loading
  `P += (P_inspired − P) × (1 − 2^(−Δt/T½))`, with `P_inspired = (P_amb − P_H2O) × 0.79`.
  Ceiling from the M-value line `P_tol = (P − a) × b`, softened by a gradient factor.
- **NDL** is derived by inverting the same equation per compartment and taking the minimum.
- **Exposed DCS state**: a tissue-loading bar (`max_i P_i / M_surface_i`), an NDL countdown,
  and — once NDL is blown — a hard **ceiling** the diver may not ascend above. `inDeco` is
  momentary, not latching: it clears again if the ceiling clears.
- **Safety stop**: 3 minutes at 5 m ± 1.5 m, credited only on a dive that went below 10 m, and
  only as one continuous stretch.
- **Narcosis** ramps from 28 m to 40 m. Cosmetic (scene sway and a HUD chip), but it is how the
  game says out loud why 40 m is the line.

### Failure states (each teaches one lesson)
1. **Out of air** — tank hits 0. *Lesson: gas planning scales with depth.*
2. **Ascent too fast** — sustained ascent above 9 m/min fills a strike meter; the fill rate
   scales with how far over the limit you are, and drains when you are back inside it.
   *Lesson: ascent rate is a limit, not a suggestion.*
3. **DCS / ceiling violation** — staying above the decompression ceiling, or surfacing with
   one. *Lesson: bottom time creates an obligation you must pay back.*
4. **Depth exceeded** — past 45 m (`hardMaxDepthM`); the recreational limit at 40 m is where
   the warnings start. *Lesson: recreational limits exist.*

Exceeding NDL is **not** instant death — it flips you into deco with a ceiling and a chance to
fix it. That is the interesting, teachable middle state.

### Success and scoring

Surface clean: with gas, without violations, and without a ceiling still owed.

`src/sim/scoring.ts` is the single definition of the score. It exists because the number was
previously computed in three places — the HUD, the debrief headline and the debrief breakdown —
and drifted apart twice: once when repeat-sighting decay was added and again when the
fast-ascent penalty was. Anything that shows the player a number goes through that module.

```
fish points (after repeat decay)  ×  diversity multiplier
  + end-of-dive bonuses
  − fast-ascent penalty
  = net score, and 0 unless the dive ended 'surfaced'
```

- **Fish points** scale steeply with depth (1 for a sardine, 24 octopus, 85 reef shark,
  240 nautilus) while rarity falls at a similar rate, so the *expected* value of going deep is
  only modestly better than staying shallow. A deep dive is a gamble paid for in gas and
  nitrogen, not a guarantee.
- **Repeat decay**: `max(1, round(points × max(repeatFloor, repeatDecay^seen)))`, capped at
  `maxScoringSightings` scoring sightings of a species per dive.
- **Diversity multiplier**: `1 + 0.07 × (distinct species − 1)`, capped at 1.9.
- **Fast-ascent penalty**: accrued live, per dive-second above the rate limit, scaled by the
  overshoot ratio. Held in `state.ascentPenalty`, separate from `score`, so the debrief can
  show it as its own line.
- **Bonuses** (`state.bonusPoints`, awarded only on `surfaced`, and kept out of the diversity
  multiplier so breadth cannot inflate them): 50 for the safety stop, 120 flat for surfacing
  with the reserve intact, 2 per bar of spare gas above the reserve.

## Architecture / module map

Verified file-by-file. Line counts are indicative of weight, not a target.

```
src/
  types.ts        SHARED CONTRACT: Species, Fish, DiveState, ProfileSample, Debrief, EndReason
  config.ts       every tunable, with the reasoning for the contested ones in comments
  main.ts         bootstrap; keyboard/pointer input, real→dive clock, sub-stepping, wiring
  sim/
    engine.ts     fixed-step dive loop: kinematics, gas, tissues, ascent policing, safety
                  stop, narcosis, observation + point award, profile sampling, end conditions
    pressure.ts   depth↔pressure, pressure multiplier, Boyle relative volume
    buhlmann.ts   ZH-L16C table, tissue update, ceiling (raw + 3 m grid), NDL, load fraction
    gas.ts        SAC → L/min and bar/dive-second, gas-remaining estimates
    scoring.ts    the single definition of the score (diversity, net, banked)
    selftest.ts   console-table sanity checks over pressure / gas / NDL / off-gassing
  world/
    species.ts    the 14-species table: depth bands, points, rarity, size, blurb
    spawner.ts    depth-aware spawn / move / cull around the diver
    render.ts     canvas scene: water, sun shafts, terrain, particles, safety band, ceiling
                  wash, fish, bubbles, diver, depth grade, ruler, Boyle bubble, narcosis
    art/
      types.ts    SHARED CONTRACT for art: draw facing +x, centred on origin, size = length
      index.ts    registry, `Record<Species.id, FishArt>`, merged from the four group modules
      shallow.ts  sardine, clownfish, cleaner shrimp, green sea turtle
      mid.ts      pufferfish, jellyfish, moray eel, reef crab
      deep.ts     octopus, squid, lobster
      trophy.ts   reef shark, whale, nautilus
  ui/
    units.ts      metric/imperial presentation layer + the reserve rule
    hud.ts        gauges, unit toggle, limit-proximity states, urgent-topic badges
    tooltips.ts   the eight "learn more" popovers + auto-hinting; the sim pauses while open
    wizard.ts     the 8-slide onboarding
    debrief.ts    profile analysis, end-of-dive coaching, dive-profile graph
    styles.css    all styling
tests/            vitest, node environment: pressure, gas, buhlmann, engine (+ helpers.ts)
```

The original build was parallelised by making the modules disjoint by file and fixing every
cross-module call in the API contract below: a lead owned `types.ts` / `config.ts` /
`engine.ts` / `main.ts`, and four agents built sim, world, HUD/tooltips and wizard/debrief
simultaneously against it. The art modules were a second wave on the same principle, one
author per group file, joined only by `art/index.ts`. The split is the reason the seams are
where they are; it is not a live ownership claim.

Two directional rules survive from that split and still matter:

- `src/sim/**` is pure, DOM-free and metric. It does not import from `src/ui/**`. The unit
  system reaches the engine only as a number, through `setReserveBar()`.
- `src/world/render.ts` does import `ui/units.ts`, because the ruler is a gauge.

## API contract

```ts
// sim/pressure.ts
ambientPressure(depth: Depth): Bar
depthForPressure(p: Bar): Depth
pressureMultiplier(depth: Depth): number      // P_amb / P_surface
relativeVolume(depth: Depth): number          // Boyle: P_surface / P_amb

// sim/gas.ts
consumptionLpm(depth: Depth, exertion?: number): number
barPerSecond(depth: Depth, exertion?: number): number   // per DIVE second
minutesOfGasLeft(tankBar: Bar, depth: Depth): number    // to zero, at this depth
minutesToReserve(tankBar: Bar, depth: Depth): number    // to CONFIG.tank.reserveBar

// sim/buhlmann.ts   (every gf parameter defaults to CONFIG.gfHigh)
ZHL16C: ReadonlyArray<{ t: number; a: number; b: number }>   // 16 N2 compartments
TABLE_GF = 1.0                                   // raw M-values, what the self-test asserts
inspiredN2(depth: Depth): Bar
surfaceEquilibriumN2(): Bar
initialTissues(): TissueState                    // equilibrated at the surface
updateTissues(ts: TissueState, depth: Depth, dtDiveSec: number): void   // mutates
surfacingLimit(i: number, gf?: number): Bar
rawCeiling(ts: TissueState, gf?: number): Depth      // unrounded; what the engine polices
ceilingDepth(ts: TissueState, gf?: number): Depth    // rounded up to the 3 m stop grid
leadingCompartment(ts: TissueState, gf?: number): number
ndlMinutes(ts: TissueState, depth: Depth, gf?: number): number   // Infinity if unlimited
loadFraction(ts: TissueState, gf?: number): number               // >= 1 => deco obligation

// sim/scoring.ts
diversityMultiplier(distinctSpecies: number): number
scaledFishPoints(state: DiveState): number
netScore(state: DiveState): number
bankedScore(state: DiveState): number         // 0 unless endReason === 'surfaced'

// sim/engine.ts
createEngine(): {
  state: DiveState
  step(dtDiveSec: number, input: VerticalInput): boolean   // true when the dive just ended
  reset(): void
  setTimeCompression(tc: number): void
  setReserveBar(bar: number): void
}

// sim/selftest.ts
runSelfTest(): Check[]

// world/species.ts
SPECIES: Species[]
speciesById(id: string): Species | undefined
// world/spawner.ts
createSpawner(): { update(state: DiveState, dtDiveSec: number): void; reset(): void }
// world/render.ts
createRenderer(canvas: HTMLCanvasElement): { draw(state: DiveState): void; resize(): void }
drawDiverSprite(ctx: CanvasRenderingContext2D, t: number): void   // reused by the wizard
// world/art/index.ts
FISH_ART: Record<string, FishArt>      // FishArt = (a: FishArtArgs) => void

// ui/units.ts
getUnits() / setUnits(u) / toggleUnits() / suggestedUnits(): UnitSystem
depth(m, decimals?) / depthNum / depthValue / depthUnit
tankPressure(bar) / tankPressureNum / pressureValue / pressureUnit / ambientPressureLabel
rate(mpm, decimals?) / rateValue / rateUnit
reserveBar(): number      // 50 metric, 34.5 imperial
reserveLabel(): string    // "50 bar" / "500 psi"

// ui/hud.ts
createHud(root: HTMLElement): { update(state: DiveState): void; destroy(): void }
// ui/tooltips.ts
buildTopics(): Record<TopicKey, { title: string; body: string }>
openTopic(key: TopicKey): void
closeTopic(): void
isTopicOpen(): boolean                            // main.ts holds the dive while true
urgentTopic(state: DiveState): TopicKey | null    // drives the pulsing (i) badge

// ui/wizard.ts
hasSeenWizard(): boolean
runWizard(root: HTMLElement, opts?: { force?: boolean }): Promise<void>
// ui/debrief.ts
analyseProfile(profile: ProfileSample[]): ProfileStats
buildDebrief(state: DiveState): Debrief           // pure
showDebrief(root: HTMLElement, d: Debrief, onRestart: () => void): void
```

## Sequencing

1. ~~Lead writes `types.ts`, `config.ts`, `engine.ts`, `main.ts`.~~ **done**
2. ~~Parallel wave 1 — agents build sim / world / HUD / onboarding against the contract.~~ **done**
3. ~~Integration — wire, playtest in the browser, tune.~~ **done**
4. ~~Parallel wave 2 — vector fish art replacing emoji, via the `src/world/art/` registry.~~
   **done** — all 14 species have a drawing function; the emoji path is now unreachable in
   practice and kept only as the fallback the registry contract promises.
5. ~~Test suite, unit system, scoring rework.~~ **done** — 83 tests, `npm test`.

## Tuning decisions made during integration

Several of these were genuinely contested. The reasoning matters more than the number.

- **Gradient factors set to 1.0.** GF 85 is what a real dive computer would show, and it is the
  more defensible choice as *diving*. But it cuts no-deco time at 30 m to under 10 minutes,
  which leaves no room for the depth-vs-risk decision the game exists to teach — the player
  would be in deco before they had finished reading the gauge. At GF 100 the NDLs sit on the
  published recreational tables (~59 / 16 / 9 min at 18 / 30 / 40 m against PADI's 56 / 20 / 9),
  so a player who later sits a course recognises the numbers. `gfLow` is kept in config at 1.0
  but is currently unused: there is no depth-varying GF ramp.

- **Control gains are authored in real seconds**, not dive-seconds, and divided by the time
  compression. Without this the diver accelerated 10× too fast at the default compression and
  every ascent busted the rate limit. The cost is a real one and is documented rather than
  hidden: because acceleration per *dive*-second now depends on the compression, a descent to
  30 m takes ~85 dive-seconds at 4× and ~102 at 25×, and those extra ~17 seconds at depth are
  real nitrogen and real gas. You cannot have both constant feel and compression-invariant
  physics from a pure acceleration model. Feel won, because the compression is a playtesting
  dial and the feel is the game. It is pinned by an `it.fails` test in `tests/engine.test.ts`,
  which will flip to a normal pass if anyone ever reconciles the two.

- **Repeat-sighting decay has both a floor and a cap, and they only work as a pair.**
  Decay alone (`repeatDecay` 0.55) was needed because a long shallow dive otherwise out-scores
  a deep one on sheer volume, inverting the lesson. But raw decay makes the fifth sardine worth
  zero, and the safety stop is three minutes of hanging at 5 m with nothing to look at — so
  every sighting is worth at least 1 point. A 1-point floor with no ceiling, though, means
  points accrue with time alone, and a diver who farms the shallows and surfaces neatly
  out-scores a real dive. Hence `maxScoringSightings` (80 per species per dive), which a normal
  dive never reaches — a busy dive tops out around 50–60 sightings of the commonest species —
  so it only ends the grind. The pair also depends on a third rule: the engine gives a diver
  who never really descends an exit, ending the dive once they are at the surface after 180
  dive-seconds. Without that release, a 1-point floor cancels the decay for the cheap shallow
  species entirely and surface-farming out-scores a real dive. All three have to move together.

- **Points are banked only on a successful surfacing.** `bankedScore` returns 0 for out-of-air,
  bent, or past the depth limit, however much was logged on the way down. The alternative —
  partial credit for a failed dive — was rejected because it teaches the wrong thing: it makes
  a bad dive a *worse* dive rather than a non-dive, and it lets "one more fish at 38 m" be a
  rational gamble right up to the moment you drown. The score is the reward for the dive you
  came back from. The HUD still shows the running net score live, so the number you are about
  to lose is always visible; the debrief shows the banked one.

- **The gas reserve depends on the unit system.** Metric training says "be back with 50 bar";
  US training says "be back with 500 psi", which is ~34.5 bar — not the same amount of gas in
  different words, but a genuinely different rule, ~16 bar apart. The tidy alternative was to
  pick one number and convert it, and that is the bigger distortion: it shows one of the two
  audiences a rule they were never taught, in a figure nobody quotes. So this is the one place
  a unit choice changes the game and not just the wording — an imperial diver may legitimately
  breathe a little deeper into the tank before the gauge warns, and the reserve-intact bonus is
  judged against whichever rule they chose. `reserveBar()` in `ui/units.ts` is the only
  definition; `main.ts` pushes it into the engine every frame via `setReserveBar()`, so the
  live toggle stays consistent mid-dive.

- **Species points were rebalanced steeply toward depth.** The trophy species now run to 85 /
  140 / 240 for the reef shark, whale and nautilus, against 1–3 in the top 8 m. Rarity falls at
  a comparable rate, so the expected value of going deep stays only modestly better than
  staying shallow; what the steep curve buys is that a *single* deep sighting feels like it
  paid for the risk, which the flatter earlier curve did not. (The band comment at the top of
  `species.ts` still quotes the old 25–60 point range for the deep band.)

- **Exceeding NDL is not an instant loss.** It flips you into deco with a visible ceiling and a
  chance to fix it. The loss condition is *staying* above the ceiling — a brief overshoot you
  correct within 8 dive-seconds is a scare, not a bend — or surfacing with one owed.

- **The ceiling is policed against `rawCeiling`, not the 3 m grid the HUD displays.** The HUD
  rounds up to the stop grid because that is how a diver is taught to read it, but ending the
  dive on that rounded number would bend the player for breaking a barrier up to three metres
  more conservative than the model actually claims.

- **The fast-ascent penalty is for the overshoots you get away with.** Drifting up at 12 m/min
  for 15 seconds and correcting costs about 24 points off a ~350 point dive: enough to notice,
  nowhere near the instant loss of filling the strike meter. It is docked live rather than at
  the end so the score reacts while the gauge that caused it is still on screen.

- **The safety stop must be continuous.** Returning below 10 m resets the clock, because three
  minutes banked across a dive is not a safety stop. Wobble inside ±1.5 m of 5 m is tolerated;
  holding depth to the centimetre is not the skill being taught.

- **The spawner does not renormalise.** Spawn attempts fail proportionally when the total
  candidate weight at the diver's depth is low, so deep water is genuinely *emptier* rather
  than merely stocked with different animals. Renormalising made every attempt at 38 m produce
  a rare species, which turns the gamble into a guarantee.

- **Renderer performance.** Three changes, all in `world/render.ts`:
  device pixel ratio is capped at 1.5, because the scene is soft-edged gradients and vector
  shapes where the step from 1.5× to 2× is nearly invisible and costs 78% more pixels; the
  water, sky and sun-shaft gradients are built once per resize rather than per frame; and the
  draw loop keeps two clocks. Cosmetic animation (fin beat, sun shafts, bubbles, sway) advances
  on real time from `performance.now()`, and only world-locked motion — how fast the reef
  scrolls past — advances on the dive clock. The practical effect is that the time-compression
  dial changes how fast the dive runs without changing how fast anything looks like it is
  swimming.

- **The dive holds while an explainer is open.** At 10× compression, 30 seconds of reading
  burns five dive-minutes of gas behind a modal the player cannot see past — and the info
  badges pulse hardest exactly when the player is already in trouble.

### Known divergences

Recorded here rather than fixed, so nobody rediscovers them as bugs:

- Dive time to a given depth depends on `timeCompression` — see the control-gains note above.
  Pinned by the one `it.fails` in `tests/engine.test.ts`.
- `analyseProfile()` derives its own `safetyStopDone` from the depth samples, and it deliberately
  disagrees with the engine: the engine requires the stop to be continuous and to come after the
  dive proper, and neither fact survives into a list of depth samples. The profile figure is used
  only for drawing the graph; everything the player reads comes from the engine's verdict carried
  on `Debrief`. Pinned by a test, because collapsing the two back together is how the bug returns.
- The gas reserve genuinely differs by unit system (50 bar metric, 500 psi ≈ 34.5 bar imperial),
  because the two training traditions teach different amounts rather than the same amount in
  different words. This is the one place a unit choice changes the game and not just the wording:
  an imperial diver gets roughly three extra minutes of bottom time before the reserve rule bites.
  Deliberate — showing a metric diver a "500 psi" rule they were never taught would be the larger
  distortion — but it does make imperial fractionally the easier setting.

## Non-goals

Not a dive planner. No multi-gas, no repetitive dives, no O2 toxicity tracking (mentioned in a
tooltip only), no currents, no ascent-rate-aware deco stops beyond the single ceiling. Realistic
*enough* that a certified diver nods; simple enough that someone who has never dived learns why
the ascent matters.
