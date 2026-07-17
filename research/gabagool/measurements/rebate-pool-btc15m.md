# Maker-rebate estimator (G4) — resolved: the pool share cancels

Two results: (1) the btc-15m book's fee/pool magnitudes, measured; (2)
the estimator the lab needs is EXACT, not an approximation.

## The estimator (primary-sourced, docs maker-rebates page 2026-07-17)

Official formula: per maker fill, `fee_equivalent = C·feeRate·p·(1−p)`
(the SAME curve takers pay); daily rebate = `(own_fee_equivalent /
total_fee_equivalent) × pool`, computed **per market**; pool = **20% of
taker fees collected in that market** (crypto category).

Because every matched fill contributes the same curve value to BOTH the
taker-fee sum and the maker fee-equivalent sum, `pool =
0.20 × total_fee_equivalent` — the share cancels:

    own daily rebate = 0.20 × Σ 0.07·p·(1−p)·size  over OWN maker fills

EXACT under two mild assumptions: (a) pro-rata as documented, (b) own
participation doesn't change others' flow. **No pool-share assumption
needed.** This kills the G4 blocker: the rebate line is a one-line
addition to backtest stats over sim maker fills. Caveats:
- **$1/day/market minimum threshold before payout** — at min size this
  rounds small rebates to ZERO (see below).
- Program terms are discretionary and "may change over time" (A21 shows
  the venue exercising discretion).

## Book magnitudes (Jul 15 2026, 24/96 windows sampled, ×4)

Method: `scripts/rebate-pool.ts` — per sampled window, ALL data-api
/trades rows (verified single-counted: Σsize == gamma volumeNum
exactly), current fee curve applied. p10/p50/p90 per-market fees
$184/$332/$711.

| quantity | btc-15m, 2026-07-15 |
|---|---:|
| matched notional | ~$1.90M/day |
| shares matched | ~$3.7M shares/day |
| taker fees | **~$36.4k/day** |
| implied maker-rebate pool (20%) | **~$7.3k/day** |

- Cross-check: b55f's observed maker rebates ($0.77–1.06k/day, ALL
  books) vs estimator: his btc-15m maker notional ≈ 38% of ~$200k/day
  turnover at ~1.4% avg fee-weight → 20% × ~$1.6k ≈ $0.3k/day btc-15m
  alone, multi-book total consistent with observed. Magnitudes cohere.
- The taker-rebate program (tiers, 3–50% refund of own fees) is the
  bigger income stream for incumbents (A21: 5–10× the maker stream) —
  but it is NOT available to a cold-start bot (3% tier) and NOT needed
  for H1's sim judgement; model it only as an incumbent-advantage
  competition note (G8).

## How much per day at min size? (charter B question — answered)

A minimal two-sided bot (5-share clips): fee-weight ≈ 0.07·p(1−p)·5 ≈
$0.06/fill near mid, $0.02 at p=0.15. At the archetype's zero-fee-era
cadence transplanted to today (~100 maker fills/market), that is
~$6/market fee-equivalent → ~$1.2/market rebate → ~$115/day across 96
btc-15m markets IF above threshold in each. At 10 fills/market it is
~$0.12/market — **below the $1/day/market threshold → paid $0**.
Rebate income is a scale game by construction; at min size it is dust
or literally zero. H1's "rebates rescue thin pair margins" premise only
operates at high fill counts — which the sim CAN now price exactly.

## Consequences folded

- ENGINE-GAPS G4: estimator formula now known-exact; remaining gap is
  only implementation (stats line over sim maker fills) + threshold.
- H1 kill criterion: rebate arithmetic is no longer an unknown — a
  structural kill is decidable in sim (fee-inclusive pair margin +
  0.20×fee-equivalent of maker fills, minus threshold effects).
- METRICS "rebate income" row: use the exact formula, drop the
  pool-share caveat.

## Producing commands

- npx tsx research/gabagool/scripts/rebate-pool.ts --day 2026-07-15
  --every 4
- docs.polymarket.com/market-makers/maker-rebates.md (formula wording)
