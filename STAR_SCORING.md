# Star Scoring And Meter Plan

How lawn-mowing levels are scored and shown. Internal points are scaffolding
only; the player sees stars, a live meter, and a one-line end verdict, never raw
numbers. Design was prototyped in `public/star-meter.html` (mockup v5).

## Player-Facing Behavior

- A star meter sits in the top HUD box and replaces the old "Mowed: %" display.
- Stars wait on the right; each breaks off near the end of its segment and slides
  to its milestone to meet the rising fill. Earned stars bank small on the left.
- Accidents stay on screen as a fixed row of faint X marks. The play HUD does
  not show the word "mistakes" or a numeric counter.
- The clock is hidden in normal play. Time is surfaced at the end on the results
  card, and optionally live in master mode later.
- Rank is the highest star count reached. Stars are never taken away once won;
  a mistake or time decay only pushes the current fill back.
- At the end, a short verdict picks the one thing that most held the player back
  or celebrates the run.
- Result actions are contextual: a perfect 100% run shows Next Level plus Report
  Card; non-perfect runs show Retry plus Report Card, and also Next Level once
  at least one star is earned. Zero-star runs stay locked to retry/report.
- If the player earns the maximum stars before mowing every blade, the game does
  not interrupt by default. A Finish Run HUD button appears instead. The dev
  setting `autoFinishOnMaxStars` can restore the interrupt.
- If the next star is mathematically out of reach but the player already has at
  least one star, the game does not hard-stop them by default. Near the end,
  after a stall, it shows a soft Fine Work prompt with Keep Going, Help Me, and
  Next Level. Help Me clears isolated single blades; if that cleanup finishes the
  remaining lawn, the result is Good Enough.

## Scoring Model

All constants live in `config.scoring`; logic is pure in `src/scoring.ts`.

There are two related systems:

- Normal mode, 3 stars, uses run-aware facet ranks: completion, time, and
  accidents. Normal is easier because it stops at 3 stars.
- Master mode, 5 stars, uses the same 1-star, 2-star, and 3-star meanings as
  normal, then adds stricter 4-star and 5-star requirements on top.
- A 3-star run is a 3-star run in both modes. A 100% clean run at par is 3 stars
  in normal because normal has three stars, and 5 stars in master because master
  has the two extra achievement stars.

Normal mode rules:

- 100% or near-100% completion (`completePercent`, currently 99.5%) always earns
  at least 1 star, no matter how slow or messy the run was.
- 80%+ completion can earn 1 star if the other facets are strong, but the normal
  completion cap prevents partial completion from jumping straight to 2 stars.
- 3 stars requires the whole lawn, near-par time, and no accidents.
- Accidents, speed, and completion all matter for 1-2 stars; none of those stars
  should be locked or granted by only one facet except the 100% completion floor.

The old raw point model remains useful for strict tuning references and master
mode, but normal stars and normal live meter fill are not granted by only one
blended number. Normal live fill uses `meterFillFractionForRun`, which blends
earned stars with completion-aware progress so mowing visibly advances the meter
through the 1-, 2-, and 3-star regions.

```text
score = 5 * (par - elapsed) + 100 * grassPercent - mistakePenalty
```

- Time starts at `5 * par`, the meter's 0% baseline, and decays each second.
- Grass contributes `100` per percent mowed, maxing at `10000` at 100%.
- Accident penalty starts at `1000`, then decays by `0.7` each additional
  accident: `1000`, `700`, `490`, and so on.
- Raw star thresholds are still useful references: 3-star mode uses
  `4000 / 7000 / 10000`; 5-star mode uses
  `4000 / 6000 / 8000 / 9000 / 10000`.

Defaults chosen, all tunable in `config.scoring`:

- Par is stored per level in `lawnLevels.settings.parSeconds`.
- Mistake/accident base penalty is `1000`.
- Normal complete is `99.5%`, near complete is `95%`, partial is `80%`.
- Normal 3-star time is `1.2x par`, 2-star time is `1.55x par`, and 1-star time
  is `2.25x par`.
- Master 4-star time is `1.1x par`; master 5-star time is par.
- Master 5 stars requires 100% complete, no accidents, at or under par.

## Modes

- Default is 3 stars: calm, no live clock, the meter is the whole story.
- Master is 5 stars: unlocked later after 3 stars on every level in a pack. It
  should show the live clock/par ghost and the two extra stars. Stars 1-3 are the
  same quality bar as normal; stars 4-5 are the stricter achievement layer.

## Architecture

- `src/scoring.ts` is done. Pure functions include `timePoints`, `grassPoints`,
  `mistakePenalty`, `totalScore`, `earnedStars`, `bandProgress`, `meterFloor`,
  `earnedStarsForRun`, `meterFillFractionForRun`, `reachableCeiling`,
  `nextStarOutOfReach`, and `limitingFactor`.
- `src/starMeter.ts` is done. It owns the meter DOM and the mockup-inspired
  render/animation: cluster shapes, break-off slide, fill-to-milestone, sparkle
  on earn, and gold completion.
- HUD wiring is done for live play. It replaced `#score` and the old green
  percent bar with the meter, keeps accident marks visible on every map, and
  feeds grass percent, elapsed seconds, and accident count each frame. Clock
  stays hidden in normal play.
- Results card is done for the first playable pass. It reuses the celebration
  overlay, shows stars, limiting-factor verdict, time/grass/accident stats, and
  contextual actions. One-star-or-better near-end stalls use the soft prompt and
  optional Help Me cleanup instead of directly ending the run.
- `src/localSettings.ts` stores best stars per level so level select can unlock
  levels sequentially based on saved progress.

## Incremental Steps

1. Scoring module and config: done.
2. Meter in the HUD: done.
3. Results card and end conditions: done for the first playable pass.
4. Per-map par: done through `lawnLevels.settings.parSeconds`.
5. Master mode, pack unlocks, and par ghost: later polish.

## Open / Deferred

- Exact par tuning per map.
- Whether to keep a generous hard time backstop.
- Master-mode clock/par-ghost visual on the same bar.
- A Stats button to expand the internal breakdown at the end, optional.
- Compact sizing: the HUD box is narrow, so meter clusters shrink compared with
  the full-width mockup.
