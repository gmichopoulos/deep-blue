# Deep Blue — Design Notes

A browser game that teaches the physics and physiology of recreational scuba diving by making users live the trade-off, rather than read about it.

---

## Why this theme, and this approach

I have had several friends ask about the science of scuba diving, and seen many new divers get confused about it during their certification process. Not because it is hard — it is a handful of equations — but because the way it is taught leaves the relationships inert. You can memorise that pressure rises one bar per ten metres, that gas consumption scales with ambient pressure, and that nitrogen loading is a function of depth and time, and still have no feel at all for how those three things *push against each other* on an actual dive. The best-in-class materials — tables, the PADI eRDPML, the chapter-and-quiz format — are good at conveying the facts and bad at building the intuition. You leave knowing that a 30 m dive has a shorter no-stop limit than an 18 m one without any sense of what that costs you in the water.

The thing that actually makes it click, for most divers, is doing it: watching your gas gauge
fall visibly faster at depth, watching your no-stop clock shrink while you are still enjoying
yourself, and having to decide — right now, with imperfect information — whether the next five
minutes are worth the ascent they will cost. That experience is what a book cannot give you and
what a game can.

So the design goal was narrow and specific: **compress the feedback loop of a real dive until the relationship between depth, pressure, time and inert gas becomes something you feel rather than something you recall.** Everything else in the game is in service of that.

That's why I decided to use a flappy-bird style UX and show the 2D dive from the side to help the users observe the entire water column at once, with a depth-and-pressure ruler down the left edge. Vertical position on screen *is* depth. When you sink, you watch the
pressure multiplier climb, the Boyle bubble beside the ruler shrink, your gas-minutes estimate
collapse, and your no-stop clock start moving — all at the same time, all visibly caused by the
one thing you did. That simultaneity is the lesson.

## What makes it interesting or non-obvious

**Failure is the teacher.** The fastest way to internalise a limit is to cross it and see what  
happens. So the game is built to kill you, early and often, and then explain precisely what it  
was about *your* dive that did it. A game over that just says "you got the bends" teaches  
nothing. So each ending produces a debrief built from the actual profile — the depth and the  
minute you crossed your reserve, the sustained ascent rate and where it started, the ceiling you  
broke and by how much — and then names the single most useful thing you could have done  
differently. The end-of-dive graph draws your own depth trace with the decompression ceiling  
overlaid as a no-entry region and the failure point flagged, so you can *see* the mistake as a  
shape.

Two more decisions followed from taking that idea seriously:

**Exceeding the no-stop limit is deliberately not an instant loss.** It flips you into
decompression with a hard red ceiling drawn across the water column and a chance to fix it. That
middle state — you are not dead, but you now owe the water something before you may leave — is
the most valuable teaching moment in the whole game, and killing the player there would skip it
entirely. You only lose if you ascend through the ceiling or surface still owing a stop.

**The failure has to be earned by your own choices, not by twitchy controls.** The player has
exactly one axis of input — ascend, descend, or hold — and the diver swims forward automatically.
Every death is therefore attributable to a depth-and-time decision, which is the only thing the
game is trying to teach. Ascent input is an *acceleration*, not a fixed speed, so holding "up"
carries you past 9 m/min naturally; the rate limit has to be actively managed rather than being
free.

## Key design decisions and trade-offs



### The model


| Concept          | Modelled as                                                    | Trade-off accepted                                                                                                                |
| ---------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Ambient pressure | `1.0 + depth/10` bar                                           | Surface pressure pinned at a clean 1.0 rather than 1.013, so "10 m doubles the pressure" is exactly true. A teaching lie of 1.3%. |
| Gas              | `SAC × ambient × exertion` from an AL80                        | No gas density, no work-of-breathing effects. Linear in pressure is the whole point being taught.                                 |
| Tissues          | Bühlmann ZH-L16C, all 16 nitrogen compartments, Haldane uptake | The real thing, not a simplification. It costs nothing to compute and it is the credibility of the project.                       |
| No-stop limit    | Same equation inverted per compartment, minimum across all 16  | —                                                                                                                                 |
| Ceiling / DCS    | M-value line `(P − a) × b` with gradient factors               | Ascending above the ceiling bends you; a brief overshoot you correct is a scare, not a bend.                                      |


**Gradient factors are set to 1.0, not the ~85 a real dive computer would use.** This was the
first genuinely contested decision. GF 85 is what a modern computer shows and is more
conservative — but it cuts no-stop time at 30 m to under ten minutes, which leaves no room for
the depth-versus-risk decision the game exists to create. At GF 100 our limits land on the
published recreational tables (59 / 16 / 9 minutes at 18 / 30 / 40 m against PADI's 56 / 20 / 9),
so a player who later sits a course recognises the numbers. Chose recognisability and playable
tension over matching a specific computer's conservatism.

**Time is compressed 10× by default, and that turned out to have teeth.** Gains are authored in real seconds and divided by the compression factor, so the diver feels identical at 4× or 25×. One residual asymmetry survives and is pinned by a test: because the model is acceleration-based, a descent to 30 m costs ~85 dive-seconds at 4× and ~102 at 25×. We couldn't have both constant feel and compression-invariant physics; feel won.

### Scoring, and an honest account of an arms race

Scoring turned out to be the hardest part of the design, because the score is what the player
actually optimises — so any flaw in it teaches the *wrong* lesson. It went through four rounds,
each closing an exploit found by measurement rather than by inspection:

1. **Rare fish are deep and worth more.** Immediately broken: a long shallow dive out-scored a
  deep one on sheer volume, inverting the entire lesson.
2. **Repeat sightings decay.** Better — until a floor of one point was added so the safety stop
  stays engaging, at which point floating at the surface pressing nothing scored 1251 against
   340 for a well-run dive.
3. **Bank only what you bring back** (a failed dive scores zero) **plus a reserve bonus.** Kills
  the careless grind. Does not kill the careful one: a player who farms the shallows and then
   surfaces neatly with gas in hand still scored 2356 against 2260 for a real dive.
4. **A cap of 80 scoring sightings per species per dive, a diversity multiplier, and steeply**
  **steeper depth rewards.** Repeat sightings needed a ceiling as well as a floor. A normal dive  peaks at 41–52 sightings of the commonest species, so the cap never fires in real play; it  only ends the grind.

Final balance:


| strategy              | time   | banked |
| --------------------- | ------ | ------ |
| Careful shallow grind | 63 min | 776    |
| Disciplined 25 m dive | 21 min | 974    |
| Disciplined 34 m dive | 19 min | 1893   |
| Disciplined 38 m dive | 16 min | 2028   |


### Units

Metric and imperial, chosen in the wizard from browser locale and switchable live. The
simulation is metric throughout and never imports the unit module; conversion happens only at
display, so there is exactly one place a unit bug can live. Round teaching numbers substitute
canonical imperial figures rather than raw conversions — 5 m shows as "15 ft", 40 m as "130 ft",
30 m as "100 ft" — because no diver has ever said "16.4 feet".

**One place a unit choice changes the game rather than the wording**: the gas reserve. Metric
instruction teaches "be back with 50 bar"; US instruction teaches "be back with 500 psi"; those
are different amounts of gas, roughly 15 bar apart. Honouring each tradition means an imperial
diver gets about three extra minutes of bottom time before the reserve rule bites. Showing a
metric diver a "500 psi" rule they were never taught would have been the larger distortion.

### Scope deliberately excluded

Not a dive planner. No repetitive dives or surface intervals, no multi-gas or nitrox, no oxygen  
toxicity tracking (mentioned in one tooltip as the *other* reason for the 40 m limit), no  
currents, no buoyancy control as a separate skill. Each of these is real and each would have  
diluted the single relationship the game is trying to make legible.

## How I would extend it

**Multi-dive days.** The single most valuable extension, and the one that takes real divers several days in the water to internalise: extend from one dive to a two-dive day, then a three-dive day, with residual nitrogen carrying across surface intervals. Suddenly the optimisation is not "how deep, how long" but "how do I spend a *budget* across a day" — the second dive has to
be shallower, the surface interval becomes a resource you are managing, and the deep dive has to
come first. That is exactly the intuition a repetitive-dive table is trying and failing to convey
on paper, and the model already supports it: the tissue compartments off-gas correctly at the
surface, so a surface interval is just continuing to integrate at 0 m.

Beyond that, in rough order of value per effort:

- **A dive plan you commit to before descending**, then get scored against. Planning the dive and
diving the plan is the actual discipline, and the game currently only teaches the second half.
- **Nitrox.** A different gas mix changes the no-stop limit and introduces an oxygen ceiling that
cuts the *other* way from the nitrogen one — the cleanest possible demonstration that these
limits are separate systems.
- **A logbook that persists across sessions**, so rare species become a collection and the diversity multiplier has a long-term hook. Additional diversity in species would be great too – it's a crime that there are no rays of any kind in the game yet!
- **Gauge failure and buddy separation** — the emergency-procedure half of a real course. We could add a random event chance for emergency situations and quiz the user on how to respond with points for getting things right.
- **A wreck or cave overhead environment** to make the "you cannot simply go up" constraint visceral. This is another challenging concept to convey to a new diver.

## Time spent

I was working with Claude on this from 11:00-5:30, so about 6.5 hours. Initial build finished in around 1 hour, and the remainder was spent iterating on the UX, performance, balancing, and finding/fixing bugs.

My own hands-on time with the lead agent — writing and aligning on the plan, playtesting, balancing and fixing — was ~2 **hours of active work**. The single largest sink was not designing or building the system: it was balance measurement and iterating on the UX.

Final size: ~10,600 lines across 29 files — 786 lines of simulation, 1,290 of world and rendering,
3,023 of procedural creature art, 3,263 of UI, and 1,292 of tests.