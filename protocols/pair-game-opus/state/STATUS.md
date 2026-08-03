# Status — Pair Game Opus

- Highest passed level: **6** (first 6 eligible markets, run **2085**)
- Current level: **7** (first 7 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: (no entries)

## Evidence

| Level | Run | Result |
|---:|---:|---|
| 1 | 2080 | PASS |
| 2 | 2081 | PASS |
| 3 | 2082 | PASS |
| 4 | 2083 | PASS |
| 5 | 2084 | PASS |
| 6 | 2085 | PASS |

All six gate runs used **pure defaults** (no `--param` other than the level's
injected `qty`). Every market ended exactly 1000/1000; pair costs on run 2085
were 0.9369–0.9653 against the 0.98 ceiling, every market profitable.

Stability was measured before promoting: the shipped configuration passed level
6 **50 out of 50** independent runs. The previous shipped configuration passes
it 0 of 15.

## How the player works now

1. **Ceiling guard (`avgCap`)** — no bid may push the realized `avgUp + avgDown`
   past `pairCeil`. This is the number the evaluator reads, so the run is legal
   at every instant, not only if it finishes. Because both legs always end at
   exactly 1000, `pnl > 0` follows from the ceiling automatically — **the only
   thing that ever actually fails a market is a leg that does not complete.**
2. **Momentum priority** — the leg whose ask is above its own EMA is the
   priority leg. A resting bid only fills while its side is getting cheaper, so
   an even-handed builder spends a trending window buying the outcome that
   expires worthless.
3. **Underdog price cap (`underdogMax` 0.25)** — new this session, and the
   change that carried level 6. The non-priority leg may never bid above 0.25.
4. **Unthrottled crossing (`takeFloor` 1)** — new this session. Crossing is no
   longer rationed by elapsed time at all; `takePace` is inert at this default.
5. **Ack-gated cancels** — new this session. A cancel is sent only for an order
   the exchange has acknowledged (see P-002 in `PROPOSALS.md`).
6. **Underdog allowance by projection** — the non-priority leg may pay whatever
   the ceiling still holds once the priority leg is finished at today's price.
7. **Conviction override (`convEdge` 0.12, `convFull` 0.20, `convUntil` 0.06)** —
   inside the opening 6% of the window, a wide gap between the two asks
   overrides the trend: the favourite becomes the priority leg. **This is the
   mechanism that now loses level 7 — see below.**

## What was learned this session

- **The dominant failure was an engine interaction, not strategy logic.** A
  cancel issued on the tick after its own place can be scheduled earlier by
  latency jitter, arrive at an empty book and be dropped with no terminal event;
  the leg then holds its one permitted live order forever and stops trading.
  Fixed inside the player by only cancelling acknowledged orders. Recorded as
  P-002. This was the largest source of run-to-run variance and it made every
  parameter comparison before it noisier than it looked.
- **The ceiling is not the binding constraint; completion is.** Every market in
  this universe ends with one side under 0.12, so buying the loser at a few
  cents leaves 0.85+ of allowance for the winner. What loses a window is the
  second leg filling at 0.4–0.5 in the opening minute.
- **`underdogMax` plateau is wide** (level 6, 20 runs each): 0 of 20 with the
  cap off; 20 of 20 at 0.08, 0.12, 0.15, 0.20, 0.25, 0.30, 0.45, 0.50; 0 of 20
  at 0.60. It ships at 0.25, the middle. The 0.60 cliff is exactly market 6's
  losing leg opening at 0.53.
- **`takeFloor` plateau**: 20 of 20 at 1 and 0.5, 15 of 20 at 0.
- **Measured and rejected** (all still ship disabled, documented in the file):
  `priorityLatch` and `soloShare` 0.9/1.0 are all 20-of-20 *with* the two changes
  above, i.e. they add nothing; `momDeadband` 0.03/0.08 did not help;
  `underdogRamp`, `fillPace`, `maxImbalance`, `leadPad`, `underdogDiscount`
  remain rejected from earlier sessions.
- **Margins are thinner than they need to be.** Pair costs sit at 0.94–0.97
  against a 0.98 ceiling, but the oracle floor (cheapest UP plus cheapest DOWN)
  is 0.18–0.60 in these markets. The reason is that once the priority leg
  completes, the remaining leg's cap lifts and it buys immediately instead of
  waiting for the close. Widening that margin is the best available source of
  robustness for later levels.

## Level 7 — scouted, diagnosed, not yet solved

Level 7 fails **10 of 10** runs, always on the seventh market,
`btc-updown-15m-1775093400`, always 1000/0.

That market opens at UP 0.58 / DOWN 0.44 and then trends DOWN all window: DOWN
climbs to 0.999, UP collapses to 0.01. Its pair floor is about 0.45, and DOWN is
under 0.66 for the first 130 s and under 0.80 for the first 240 s, so it is very
winnable.

The cause is the **conviction override**. The opening gap is 0.14, above
`convEdge` 0.12, so conviction fires and backs the favourite — which here is UP,
the leg that is about to collapse. UP becomes the priority leg, is therefore
exempt from `underdogMax`, and is bought with the crossing throttle wide open.
By the time conviction expires at t+54 s and momentum correctly names DOWN, the
budget is gone and DOWN is already above what the ceiling guard allows.

"Back the favourite at the open" is right in market 5 and wrong in markets 1, 4
and 7. Opening-gap size does not separate them: market 5 opens at a 0.19 gap,
market 4 at 0.19, market 7 at 0.14, market 1 at 0.07. What does look like it
separates them is **direction**: market 5's favourite (DOWN at 0.60) keeps
rising from the first seconds, while market 7's favourite (UP at 0.58) falls
immediately. So the hypothesis to test first is requiring the favourite to also
be the leg that is rising — either by delaying conviction a few seconds so the
EMA carries information, or by refusing to fire when the favourite's ask has
fallen since the first tick.

Do not simply raise `convEdge` above 0.14 to dodge market 7: `convEdge` is what
makes market 5 work, and market 5's opening gap is 0.19, so the gap between the
two is only 0.05 — a coincidence, not a rule.

## Next action

Work level 7 along the line above. Re-run levels 1–6 as regression gates after
every change, and sample any candidate at least 20 times before promoting it —
the ack-gated cancel fix removed most of the variance, but small samples still
mislead at this noise level.

## Needs human

Nothing.
