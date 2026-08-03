# Status — Pair Game Opus

- Highest passed level: **44** (first 44 eligible markets)
- Current level: **45** (first 45 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: (no entries)

## Evidence — every level re-run on the shipped defaults, this session

| Level | Run | Level | Run | Level | Run | Level | Run |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 3391 | 12 | 3402 | 23 | 3413 | 34 | 3424 |
| 2 | 3392 | 13 | 3403 | 24 | 3414 | 35 | 3425 |
| 3 | 3393 | 14 | 3404 | 25 | 3415 | 36 | 3426 |
| 4 | 3394 | 15 | 3405 | 26 | 3416 | 37 | 3427 |
| 5 | 3395 | 16 | 3406 | 27 | 3417 | 38 | 3428 |
| 6 | 3396 | 17 | 3407 | 28 | 3418 | 39 | 3429 |
| 7 | 3397 | 18 | 3408 | 29 | 3419 | 40 | 3386 |
| 8 | 3398 | 19 | 3409 | 30 | 3420 | 41 | 3387 |
| 9 | 3399 | 20 | 3410 | 31 | 3421 | 42 | 3388 |
| 10 | 3400 | 21 | 3411 | 32 | 3422 | 43 | 3389 |
| 11 | 3401 | 22 | 3412 | 33 | 3423 | 44 | 3390 |

All 44 levels were re-run from scratch at the final commit (`42bedd7`) after the
defaults changed twice this session. Every market ends exactly 1000/1000 and the
worst pair cost anywhere on the ladder is 0.970 against a ceiling of 0.98.

## Runs are NOT reproducible — read results accordingly

Latency jitter is random per order, so the same configuration on the same market
can finish differently. **Before promoting anything, repeat the probe two or
three times.** `probe.sh` makes that cheap. A level that passes three runs in
four is not passed.

## Tools

- `tools/probe.sh "<slugs>" [--param k=v ...]` — one parameter set over an
  explicit slug list, printing only the per-market rows. Sixty markets in ~2 min;
  four can run in parallel on this machine.
- `tools/ladder.sh <from> <to> [parallel] [outdir]` — `play-level` over a range,
  one PASS/FAIL line with run id and worst pair cost per level. The whole ladder
  1–44 takes about ten minutes at parallelism 6.

## What changed this session

Two shipped changes, both of which moved the ladder.

**`finishShare` (0.75)** — a leg past three quarters of its target is finished
rather than paced. `edgeFull` budgets a leg by how far the two asks have
separated, and that reading FALLS when the book converges, so a leg already
built to three quarters goes retroactively over its allowance and freezes there.
Refusing to grow a position costs an opportunity; refusing to finish one costs
everything already spent on it, because an unmatched share can never be paired.
This releases the pace and only the pace — it never picks a leg and never lifts
the ceiling. It is what won level 38.

**`reserveLow` (0.6)** — the priority leg must leave the other leg a reserve
based on that leg's own cheapest OBSERVED ask, not on `underdogMax`. This family
was rejected twice on a sound argument: capping the price a leg may pay only
turns a taker fill into a maker bid a few cents lower, and a leg that then falls
runs straight through it. That is true of level 37's blocker, whose over-bought
leg collapses — and `earlyShare` now handles that one. It is false of a leg
chased UPWARD, which never comes back to the bid. Against a rising leg a price
cap IS a size cap. Band over the first forty markets: 0.55 / 0.60 / 0.65 all pass
forty of forty repeatedly, 0.5 loses the fortieth, 0.7 starves the twenty-sixth.

## Level 45 — three dead ends measured, and what they rule out

The blockers from here are markets 45, 46, 47, 52 and 55
(`btc-updown-15m-1775127600`, `-1775128500`, `-1775129400`, `-1775133900`,
`-1775136600`). They are one family: the window trends for a minute, the player
completes the leg the book is favouring, the window reverses for good, and it
ends holding a full leg of the loser and a third of the winner (1000/344,
469/1000, 1000/281, 1000/344, 1000/312).

Market 45 is the clean specimen. It opens 0.51/0.50, UP runs to 0.62 by the
75-second mark and the player finishes all 1,000 UP at about 0.63. UP then
collapses to 0.002 and DOWN wins. The cheapest DOWN ever quoted is 0.37 and the
cheapest UP is 0.002, so a 0.40 pair was there for the taking — buy DOWN in the
first minute and pick UP up for nothing at the close. The player did the exact
opposite.

Three cures were measured over the first sixty markets and all three failed:

- **A larger reserve floor** is monotonically worse: 0.7 → 6 failures, 0.8 → 10,
  1.0 → 12, against 5 on the shipped 0.6. It does not even fix market 45 (1000/136
  at 1.0). The capped UP leg reverses and fills the lower bid on the way down —
  the standing objection to price caps, confirmed directly.
- **The outside-evidence pace** (`ptbPace`) is rejected again and far more
  strongly than the last time: 8 failures at `ptbEdge` 40, 12 at 60, 19 at 90.
- **The early size cap cannot reach this family at all.** `earlyMs` 90 s,
  `earlyBoth` 0.25 / 0.3, `earlyShare` 0.4 and the new `earlyModelMin` at 0.03 /
  0.05 / 0.08 all leave the five failures share-for-share identical. The gate
  that keeps it out is `earlyBoth`: it asks whether the player has been made to
  buy BOTH sides, and here the second leg is only a third built. `earlyModelMin`
  additionally costs market 37 and ships off.

## Next action

Do not tune the existing caps for level 45; three families of gate have now been
measured inert or harmful on it. What the family has in common is that the
player COMPLETES a leg at an average around 0.63 while the other leg has never
been quoted below 0.37 — a pair the evidence already says is impossible. The
untried idea is a refusal keyed on that comparison and expressed as SIZE rather
than price: do not buy more of a leg when doing so would leave the remaining
budget unable to fund the other leg at the cheapest price that leg has actually
shown. Unlike `reserveLow` this posts no order at all, so there is no bid left
resting for a reversing leg to fall through — which is precisely why every price
cap in this file has failed. Expect it to need a release (a leg genuinely has to
be finished eventually) and to be fragile at the boundary; repeat every probe.

## Needs human

Nothing.
