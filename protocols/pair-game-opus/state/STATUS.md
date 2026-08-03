# Status — Pair Game Opus

- Highest passed level: **4** (first 4 eligible markets, run **1167**)
- Current level: **5** (first 5 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: (no entries)

## Evidence

| Level | Run | Result |
|---:|---:|---|
| 1 | 1168 | PASS |
| 2 | 1169 | PASS |
| 3 | 1170 | PASS |
| 4 | 1167 | PASS (also 1165, 1166) |

Config recorded on run 1167:
`clip=200 pairCeil=0.97 priority=momentum takeMode=1 takePace=0.25 warmupMs=0
soloShare=0.8 leadReserve=0.9 maxImbalance=1000000 momentumTauMs=30000
postSecondLeg=1 stopPostingAt=0.95 minPrice=0.02 maxPrice=0.97`

Pair costs on level 4 ranged 0.9355–0.9608 against the 0.98 ceiling; every
market ended exactly 1000/1000.

## How the player works now

1. **Ceiling guard (`avgCap`)** — no bid may push the realized `avgUp + avgDown`
   past `pairCeil`. This is the number the evaluator reads, so the run is legal
   at every instant, not only if it finishes. Without it, short windows posted
   pair costs of 1.02–1.11 while sitting well inside the total budget.
2. **Momentum priority** — each tick the leg whose ask is above its own EMA is
   the priority leg. A resting bid only fills while its side is getting cheaper,
   so an even-handed builder spends a trending window buying the outcome that
   expires worthless. The side running away is the one that must be bought now.
3. **`soloShare` split** — while both legs are short, the priority leg may spend
   0.8 of the ceiling and the other only 0.2. This stops the opening minutes,
   when both asks straddle 0.50, from eating the budget on whichever leg ticks
   down first.
4. **Paced crossing** — the priority leg crosses the spread when the ceiling
   guard says the taker fee is affordable, paced so a leg aims to complete by
   25% of the window. Purely passive building cannot source a leg that never
   pulls back.

## Blocker on level 5

Level 5 adds `btc-updown-15m-1775091600`. It is a fast one-way collapse: the UP
ask goes 0.41 → 0.13 inside the first minute and ends at 0.002, while DOWN goes
0.60 → 0.88 → 0.99. The player buys 1,000 UP cheaply (average ≈ 0.27) and never
buys DOWN, because by the time it would, DOWN is above the remaining ceiling.
Runs 1160, 1161, 1163, 1164 all fail this market the same way — this is a real
mechanism, not jitter.

The pair was affordable only in roughly the first 40 seconds, when DOWN was
0.60–0.80 and nothing had been bought yet. Winning it means crossing DOWN hard
and immediately, and picking UP up at 0.01–0.05 late, for a pair around 0.65.

Two things block that today:
- the `takePace` throttle only permits a trickle of crossing in the first
  seconds, so the leg cannot be taken before its price runs away;
- the non-priority leg's low price cap does not stop it accumulating when its
  ask collapses through that cap, so the collapsing side fills to 1,000 cheaply
  and its cost then blocks the other leg.

A `warmupMs` knob (hold fire until the trend signal is warm) was tried and
measured worse — it cost more on the windows that already work than it saved
here. It ships disabled at 0.

## Next action

Work level 5. The two candidate changes, in order:
1. Let crossing respond to opportunity rather than to a clock — allow the
   priority leg to take as much as the ceiling guard permits while its price is
   still inside the cap, instead of rationing by elapsed time.
2. Bound the non-priority leg by shares as well as price, so a collapsing side
   cannot silently reach the full target and spend the ceiling.

Re-check levels 1–4 after any change; level 3 in particular passed only about
two runs in three before the current defaults, so confirm stability rather than
accepting a single green run.

## Needs human

Nothing.
