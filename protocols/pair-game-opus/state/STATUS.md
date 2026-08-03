# Status — Pair Game Opus

- Highest passed level: **45** (first 45 eligible markets)
- Current level: **46** (first 46 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: `2026-08-03T11:37:27.659Z-35d1de5f`

## Evidence — levels 1–45 at commit `58dcf8ed`

| Level | Run | Level | Run | Level | Run | Level | Run | Level | Run |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 3579 | 10 | 3588 | 19 | 3597 | 28 | 3606 | 37 | 3615 |
| 2 | 3580 | 11 | 3589 | 20 | 3598 | 29 | 3607 | 38 | 3616 |
| 3 | 3581 | 12 | 3590 | 21 | 3599 | 30 | 3608 | 39 | 3617 |
| 4 | 3582 | 13 | 3591 | 22 | 3600 | 31 | 3609 | 40 | 3618 |
| 5 | 3583 | 14 | 3592 | 23 | 3601 | 32 | 3610 | 41 | 3619 |
| 6 | 3584 | 15 | 3593 | 24 | 3602 | 33 | 3611 | 42 | 3620 |
| 7 | 3585 | 16 | 3594 | 25 | 3603 | 34 | 3612 | 43 | 3621 |
| 8 | 3586 | 17 | 3595 | 26 | 3604 | 35 | 3613 | 44 | 3622 |
| 9 | 3587 | 18 | 3596 | 27 | 3605 | 36 | 3614 | 45 | 3623 |

Every market ends exactly 1000/1000; worst pair cost on the ladder is 0.970
against a ceiling of 0.98. Defaults were re-verified over the first sixty
markets at the current commit (run 3629): markets 1–45 all clean.

## What passed level 45 — the two-tier deadband

The disagreement between book and model is now read against two thresholds, not
one. A leg already at least 0.2 × qty behind the other is read against
`ptbFairLagEdge` (0.03); otherwise `ptbFairEdge` (0.07) governs as before. The
lag decides which threshold may OPEN an override and then stops mattering,
because acting on the override is what closes the lag.

The separating feature came off four debug timelines read side by side at the
instant the override fires. Market 45's named leg was 458 shares behind; all
three casualties' named legs were behind by exactly 125. Applied everywhere,
0.03 gave 7 failures over the first sixty markets; applied only to a lagging
leg it gives 4. Three independent runs each at 0.15 and 0.2, identical failure
sets both times; 0.3 lets a balanced market through to 1000/950.

## Runs are NOT reproducible — read results accordingly

Latency jitter is random per order, so the same configuration on the same market
can finish differently. **Before promoting anything, repeat the probe two or
three times.** `probe.sh` makes that cheap. A level that passes three runs in
four is not passed.

## Tools

- `tools/probe.sh "<slugs>" [--param k=v ...]` — one parameter set over an
  explicit slug list, printing only the per-market rows. Sixty markets in ~4 min;
  four can run in parallel on this machine.
- `tools/ladder.sh <from> <to> [parallel] [outdir]` — `play-level` over a range,
  one PASS/FAIL line with run id and worst pair cost per level. The whole ladder
  1–45 takes about twenty-five minutes at parallelism 6.
- `--param debug=1 --param debugEveryMs=10000` prints a per-window timeline
  (asks, holdings, spend, targets, the model and book probabilities, the
  disagreement, the lag) plus every fill. Every level since 44 has been diagnosed
  this way; it is much faster than the SQL tools.
- The first sixty slugs:
  `npx tsx protocols/pair-game-opus/tools/universe.ts --first 60 --slugs-only`

## Level 46 — the blocker, diagnosed

Remaining failures over the first sixty markets are 46, 47, 52 and 55
(`btc-updown-15m-1775128500`, `-1775129400`, `-1775133900`, `-1775136600`).

**Market 46 is NOT market 45's family.** Its timeline:

- t+0 → t+20: builds 469 UP at 0.584 and 375 DOWN at 0.449, 452 spent.
- t+30: BTC falls 91 dollars in ten seconds. UP's ask collapses 0.58 → 0.31,
  DOWN's rises to 0.70. DOWN becomes the priority leg at full conviction.
- t+30 → t+40: the player **finishes DOWN outright** — 625 shares filled between
  0.63 and 0.67 — taking spend to 864 of the 970 ceiling.
- t+40: BTC reverses. UP's ask is back to 0.55 and rises to 0.999 by the close.
  UP's allowance is 116 / 531 = 0.19. It never fills again. Final 469/1000.

The pair was already lost as those fills printed: 469 UP at 0.584 leaves DOWN
room for only 0.386, so **no** completion of DOWN at 0.65 could ever have come in
under the ceiling, whatever BTC did next. The only cap in force at that moment
is the aggregate budget, `budgetLeft / needDown`, which permitted 0.83 a share.

Measured and rejected for this market:

- **The finishing-leg average cap (`avgGuardFrom`)** — apply the realized-average
  cap to orders that take a leg to its target, where the realized average IS the
  final average. 23 / 34 / 41 / 41 failures at 1.0 / 0.9 / 0.75 / 0.5 against 4
  without it, and market 46 fails at every setting. Refusing the last shares of a
  leg does not undo the expensive ones already bought; it converts 1000/469 into
  469/833, and it does it everywhere, because in an ordinary window the other
  leg's realized average is high for most of the window.

## Next action

The lesson from that rejection is the lead: **the ceiling cannot be defended at
the end of a leg, so whatever fixes market 46 has to act while the expensive
fills are being taken.** The specific thing to try is a price cap on the priority
leg that does not depend on that leg being nearly finished — the highest price at
which buying `size` shares still leaves the OTHER leg's remaining need affordable
at that leg's *currently shown* ask, rather than at the ask it might show later.
At t+30 in market 46 that test is decisive on its own: DOWN at 0.66 with 531 UP
still to buy at UP's own 0.31 ask needs 0.66 × 625 + 0.31 × 531 = 577 against a
remaining budget of 518, so the fills stop. Note this is NOT the solvency swap
already rejected in earlier sessions — that projected against the cheapest ask a
leg had ever shown and swapped the priority; this refuses the order outright and
prices the other leg at what it costs right now.

Read the timelines of 47, 52 and 55 too before building; if they share the shape
(a spike that finishes one leg expensively) one mechanism may take all four.

## Needs human

Nothing.
