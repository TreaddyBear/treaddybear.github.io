# Star Scoring & Meter — Plan

How the lawn-mowing levels are scored and shown. Internal points are scaffolding
only; the player sees **stars** (a live meter) and a one-line end verdict — never
raw numbers. Design was prototyped in `public/star-meter.html` (mockup v5).

## Player-facing behaviour

- A **star meter** sits in the top HUD box (it replaces the old "Mowed: %").
- Stars wait on the right; each breaks off in the last half-increment of its
  segment and slides to its milestone (1/N, 2/N … 100%) to meet the rising fill;
  earned stars bank small on the left; the **final star is large** and the bar
  goes **gold** on completion. (See mockup for exact feel.)
- **Mistakes** stay on screen always (every level, including level 1).
- **The clock is hidden** in normal play (calm). Time is surfaced at the end on
  the results card, and optionally live in **master mode**.
- Rank = the highest star count reached; **stars are never taken away** once won
  (a mistake or the time decay only pushes the *current* fill back).
- At the end: a short, light verdict picks the one thing that most held you back
  ("Mow a bit more!" / "A touch quicker!" / "Mind the flowers!") or celebrates.
- Result actions are contextual: a perfect 100% run shows **Next Level** plus
  **Report Card**; non-perfect runs show **Retry** plus **Report Card**, and also
  **Next Level** once at least one star is earned. Zero-star runs stay locked to
  retry/report for now.
- If the player earns the maximum stars before mowing every blade, the game does
  not interrupt by default. A **Finish Run** HUD button appears instead. The dev
  setting `autoFinishOnMaxStars` can restore the interrupt.

## Scoring model (internal)

All constants live in `config.scoring`; logic is pure in `src/scoring.ts`.

```
score = 5·(par − elapsed)  +  100·grass%  −  Σ mistakes
        └ time points ┘       └ grass ┘      └ 1000, then ×0.7 each ┘
```

- **Time** starts at `5·par` (the meter's 0% baseline) and decays each second, so
  dawdling barely fills the meter while moving fast fills it quickly. Under par
  adds; over par subtracts.
- **Grass**: +100 per % mowed → max 10000 at 100%.
- **Mistakes**: 1000, then ×0.7 (1000, 700, 490 … caps ~3333), since the fence
  already slows the mower (a bump is effectively a double hit).
- **Star thresholds**: 3★ = `4000 / 7000 / 10000`; 5★ = `4000 / 6000 / 8000 /
  9000 / 10000`. The meter fill within a band = `(score − prev) / (next − prev)`.

Defaults chosen (all tunable in `config.scoring`):
- **par = 6:00** for the main level (per-map override later).
- **mistake base = 1000** (soften to ~600 if two bumps shouldn't sink a 3★ run —
  a one-line change once we feel it in play).

## Modes

- **Default = 3 stars.** Calm; no clock; the meter is the whole story.
- **Master = 5 stars.** Unlocked after 3★ on every level in a pack; shows the
  live clock / par-ghost and the two extra stars. (Pack-unlock management is
  later; for now `mode` is just a flag.)

## Architecture

- `src/scoring.ts` — **done.** Pure functions: `timePoints`, `grassPoints`,
  `mistakePenalty`, `totalScore`, `earnedStars`, `bandProgress`, `meterFloor`,
  `reachableCeiling`, `nextStarOutOfReach`, `limitingFactor`.
- `src/starMeter.ts` — **done.** A self-contained component that owns
  the meter DOM and ports the mockup's render/animation (cluster shapes, break-off
  slide, fill-to-milestone, sparkle on earn, gold completion). One method:
  `update(grassPercent, elapsedSeconds, mistakeCount, mode)` called each frame.
- HUD wiring — **done for live play.** Replaced `#score` ("Mowed: %") and the old
  green percent bar with the meter; keep `#mistakes` visible on every map; feed
  it `grass.mowedCount/bladeCount`, `elapsed = timeLimitSeconds − timeRemaining`,
  and the mistake count each frame. Clock stays hidden in normal play.
- Results card — **done for the first playable pass.** Reuses the existing
  celebration slot; shows stars, the `limitingFactor` verdict, time/grass/mistake
  stats, and Next/Retry. The run ends when `nextStarOutOfReach` is true, the hard
  time limit hits, the player clicks Finish Run after maxing stars, or the lawn
  is 100% done.

## Incremental steps

1. **Scoring module + config** — ✅ done (`src/scoring.ts`, `config.scoring`).
2. **Meter in the HUD** — ✅ done. Port the mockup meter, replace "Mowed: %",
   keep Mistakes, wire live state. Clock stays hidden. No end-flow changes yet.
3. **Results card + end conditions** — ✅ done for first pass. Replaced the
   plain completion/time-up flow with the star results card; end on
   `nextStarOutOfReach`, hard time limit, or 100%.
4. **Per-map par, master mode, pack unlocks, par-ghost** — later polish.

## Open / deferred

- Exact par per map; whether to keep a generous hard time backstop.
- Master-mode clock / par-ghost visual on the same bar.
- A "Stats" button to expand the internal breakdown at the end (optional).
- Compact sizing: the HUD box is narrow, so the meter clusters shrink vs the
  full-width mockup.
