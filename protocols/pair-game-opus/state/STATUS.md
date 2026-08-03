# Status — Pair Game Opus

- Highest passed level: **44** (first 44 eligible markets)
- Current level: **45** (first 45 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: `2026-08-03T11:37:27.659Z-35d1de5f`

## Inbox item — session 11's dirty work, resolved

The uncommitted mechanism was the solvency swap (`solvSwap`). It was measured
this session and **rejected**; it ships off, with the measurement recorded in
its own doc comment, and the workspace is clean.

## Evidence — levels 1–44 re-run at the current commit

| Level | Run | Level | Run | Level | Run | Level | Run |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 3515 | 12 | 3526 | 23 | 3537 | 34 | 3548 |
| 2 | 3516 | 13 | 3527 | 24 | 3538 | 35 | 3549 |
| 3 | 3517 | 14 | 3528 | 25 | 3539 | 36 | 3550 |
| 4 | 3518 | 15 | 3529 | 26 | 3540 | 37 | 3551 |
| 5 | 3519 | 16 | 3530 | 27 | 3541 | 38 | 3552 |
| 6 | 3520 | 17 | 3531 | 28 | 3542 | 39 | 3553 |
| 7 | 3521 | 18 | 3532 | 29 | 3543 | 40 | 3554 |
| 8 | 3522 | 19 | 3533 | 30 | 3544 | 41 | 3555 |
| 9 | 3523 | 20 | 3534 | 31 | 3545 | 42 | 3556 |
| 10 | 3524 | 21 | 3535 | 32 | 3546 | 43 | 3557 |
| 11 | 3525 | 22 | 3536 | 33 | 3547 | 44 | 3558 |

Every market ends exactly 1000/1000; worst pair cost on the ladder is 0.970
against a ceiling of 0.98. An earlier ladder at the previous commit (runs
3450–3494) passed identically.

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
  1–44 takes about twenty minutes at parallelism 6.
- The strategy's own `--param debug=1 --param debugEveryMs=15000` prints a
  per-window timeline (asks, holdings, spend, targets) plus every fill. This is
  how market 45 was diagnosed and it is much faster than the SQL tools.

## Level 45 — the blocker, and what six families have ruled out

Blockers over the first sixty markets are 45, 46, 47, 52 and 55
(`btc-updown-15m-1775127600`, `-1775128500`, `-1775129400`, `-1775133900`,
`-1775136600`). One family: the window leans for a minute, the player completes
the leg the book favours, the window reverses for good.

**Market 45 minute by minute** (from the debug timeline). Opens 0.51/0.50. By
t+45s the player holds 594 UP and 136 DOWN for 414 spent. At t+60s it buys 207
DOWN at 0.45, then between t+60 and t+75 it finishes UP — 5 and 16 shares at
0.63, then 200 and 185 at 0.64 — reaching 1000 UP for 778 total, four fifths of
its ceiling, inside 75 seconds of a 15-minute window. At t+105 UP begins a slide
it never recovers from, ending at 0.002. DOWN's cheapest quote all window is
0.37, at t+66s. From t+75 the ceiling arithmetic allows DOWN only 0.29, so DOWN
never fills again and the market ends 1000/344. An oracle's pair here is 0.372.

Measured and rejected, all over the first sixty markets against five failures:

- **Larger reserve floor** — monotonically worse (0.7 → 6, 0.8 → 10, 1.0 → 12)
  and does not fix market 45.
- **Outside-evidence pace (`ptbPace`)** — 8 / 12 / 19 failures.
- **The early size cap** — inert on this family at every gate setting.
- **The solvency swap (`solvSwap`)** — 11, 11, 10, 12, 7 failures as the
  deadband widens, then exactly the baseline five, share for share, once the
  deadband is wide enough that it never fires. Strictly worse where active,
  identical where not. Two asks on one market sum to about one all window, so
  the projection overruns the ceiling nearly everywhere from the first minute:
  the overrun is the normal state, not a signal.
- **The clock pace (`holdRamp`)** — 14 / 20 / 18 / 24 failures, monotone in how
  much restraint is applied. Legs stranded at 600–750. It does not fix market 45
  either (1000/531 at best): by the time the ramp lets go, the restrained leg has
  still been bought around 0.55 and the other has reversed past 0.52, so no
  allowance the ceiling can compute will buy it.
- **A closing time on the fair gate (`ptbFairUntil`)** — inert against the
  problem it was built for; see below. Ships at 1.

## Level 45 — the live lead

**Narrowing `ptbFairEdge` from the shipped 0.07 to 0.03 repairs market 45.** It
did so in five independent runs (`--param ptbFairEdge=0.03`, alone and in four
combinations), which for a non-reproducible harness is as solid as this gets.
This is the disagreement between the order book's implied probability and the
one implied by BTC's distance from the price to beat: at t+75s the book asks
0.61–0.64 for UP while the model says 0.57, and the narrow reading is the only
thing measured so far that names the reversal from inside the window.

It is not shippable yet: at 0.03 it breaks three markets that currently pass —
`btc-updown-15m-1775103300`, `-1775116800`, `-1775124900` — for a net 7 failures
against 5. Attempts to separate the two cases:

- `ptbFairUntil` at 0.15 / 0.25 / 0.4 / 0.6 — the casualties fail at identical
  share counts every time. They are misassigned in the first two minutes, not
  abandoned late.
- `ptbFairModelMin` at 0.02 / 0.04 / 0.07 — removes the repair (market 45 fails
  again) without saving the casualties.
- `ptbFairBookMax` 0.12 — keeps the repair and saves one casualty, still 7.

## Next action

Stay on the narrow fair reading; it is the only lever that has ever moved market
45. The question is now specific and small: **what distinguishes market 45 from
the three casualties at the moment the narrow gap fires?** Read the debug
timelines of `-1775103300`, `-1775116800` and `-1775124900` side by side with
market 45's, looking at the first two minutes only, and find the feature that
separates them — how large the gap is, how long it persists, how far the book has
already leaned, or how much of either leg is already held when it fires. Then
express that feature as a condition on the gate. Do not widen the search to new
families; five have now been measured dead on this market and this one is alive.

## Needs human

Nothing.
