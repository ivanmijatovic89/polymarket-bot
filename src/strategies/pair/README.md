# Cross-level inventory with progressive pullback repair

Ten independently selectable strategies share one implementation of inventory,
order tracking, and repair. They buy UP and DOWN across levels, retain repair
inventory on bounces, and hold everything to settlement. They never sell, split,
or merge. No external feeds or technical indicators are used.

## Variants

| Strategy                 | Repair                                    | Normal orders | Repair orders |
| ------------------------ | ----------------------------------------- | ------------- | ------------- |
| `pair-01-no-repair`      | None (control)                            | Taker         | None          |
| `pair-02-full-4c`        | Full at 4¢ pullback                       | Taker         | Taker         |
| `pair-03-linear-4-8c`    | Linear, 4–8¢                              | Taker         | Taker         |
| `pair-04-linear-3-10c`   | Linear, 3–10¢                             | Taker         | Taker         |
| `pair-05-convex-4-8c`    | Squared progress, 4–8¢                    | Taker         | Taker         |
| `pair-06-concave-4-8c`   | Square-root progress, 4–8¢                | Taker         | Taker         |
| `pair-07-stepped-4-6-8c` | 25/104 at 4¢, 60/104 at 6¢, full at 8¢    | Taker         | Taker         |
| `pair-08-maker-ladder`   | Linear, 4–8¢                              | Maker         | Taker         |
| `pair-09-maker-both`     | Linear, 4–8¢                              | Maker         | Maker         |
| `pair-10-chunked-repair` | Linear, 4–8¢; at most 10 shares per order | Taker         | Taker         |

For continuous curves, the start boundary is 0% and the end boundary is 100%.
The stepped variant reproduces the handoff's cumulative percentages; it does
not hardcode the number of shares to repair.

## Fixed first-experiment assumptions

- One normal ladder per market. The first side whose own book midpoint enters
  the configured range establishes its orientation. This is symmetric under
  swapping UP and DOWN. Both the ladder and its repair keep this orientation;
  no second ladder or opposite repair cycle starts after a reversal.
- Levels run from .60 to .80 in .01 steps. Each level covers its lower-bound
  price through the next step, exclusive. The .80 bucket is [.80, .81).
  Orders are eligible only in the current bucket. A price jump or late start
  does not retrospectively buy skipped levels at the new price. An unfinished
  allocation can resume when its bucket is revisited.
- The illustrative linear 24→4 / 4→24 sizing is multiplied by **2**, making
  the smallest allocation 8 shares. This avoids the default 5-share order
  floor. All variants use the same sizing, **$800 total spending cap per
  market**, $1 minimum order notional, and 500 ms retry interval. These are
  experimental parameters, not optimized settings.
- Both books must be present, uncrossed, at most 5 seconds old, and have at
  most .05 spread. Midpoints determine levels and pullbacks; **actual asks,
  bids, and ask depth** determine orders. The opposite price is never inferred
  as `1 - directionalPrice`.
- Taker orders are depth-sized FOK limit buys at the current ask rounded up
  to the configured order-price tick. Maker orders are post-only GTC buys at
  the current bid rounded down. Maker quotes cancel after 2 seconds, on leaving
  the normal bucket, on an invalid book, or when a repair target no longer
  supports their remaining quantity. Cancellation never releases a reservation
  before confirmation; a fill can legitimately race the cancel.
- Only one allocation (up to two normal leg orders, or one repair order) can
  be in flight. Repairs take priority when eligible and executable. Residual
  allocations smaller than the size/notional floor stay unfilled. Insufficient
  depth, budget, or order rejection can prevent full repair.
- Filled costs, fees, and pending worst-case costs share the capital cap.
  The fee reserve uses the engine's crypto fee rate and the maximum of
  `p * (1-p)`. No per-pair profitability gate is imposed.
- High-water marks track each side's valid book midpoint from the first valid
  observation. A new high moves the peak but never clears repair credit.
  Unused normal allocations remain unchanged after repairs. Consequently,
  completed normal inventory plus repair inventory can have residual exposure.

## Cumulative repair with changing inventory

For the original directional side `S` and opposite side `O`, maintain independent
normal-fill and repair-fill quantities. Repair operates only while `S` is overweight:

```text
baseline = max(0, normal[S] - normal[O] + repair[S])
desiredCumulativeRepair = baseline * repairFraction(peak[S] - midpoint[S])
additional = max(0, min(currentImbalance, desiredCumulativeRepair - repair[O]))
```

Existing repair purchases stay credited for the entire episode. When more
normal fills arrive, recompute the baseline from those actual fills. For
example, 234 UP / 130 DOWN plus 25 repaired DOWN requires no new purchase on
another 4¢ touch in the stepped variant. After the .73 normal allocation,
245 normal UP / 147 normal DOWN gives a baseline of 98: full repair requires
73 additional DOWN, not another 104. A bounce pauses repair and may cancel an
unfilled quote; it never sells previously acquired shares. If the market's
original direction was DOWN, the entire calculation uses DOWN's high-water
mark and buys missing UP. Excess repair inventory after a resumed trend stays
owned until settlement; it does not initiate an opposite repair cycle.

## Accounting and parity

Every order uses deterministic per-market sequence IDs and passes through
`OrderManager`. Actual fills, deduplicated by fill ID, advance allocation and
repair ledgers. Pending orders and reported matched-but-not-yet-delivered fills
retain reservations. Exchange-only fills received before acknowledgement are
correlated when their client order becomes known. Account callbacks update
state; only ordinary market ticks submit new trading intents.

Default `[pair]` JSON logs record each normal/repair fill, inventory, costs,
averages, fees, imbalance, peaks, and the latest cumulative repair decision.
Order metadata preserves decision snapshots in the existing per-market
`intent_meta` results. Final inventory, costs, fees, resolved outcome, and PnL
are produced by the existing backtest settlement accounting; payout is the
winning side's final quantity. Minimum paired payout is not the actual payout
when quantities differ. No resolution data enters strategy decisions.

The same strategy is loaded by live and replay. Simulator limitations remain:
maker fills use the engine's conservative `worst_queue` crossing rule but fill
the whole resting remainder; they do not reconstruct a real queue or partial
maker fills. The strategy itself handles partial fills. Thus comparisons of
maker and taker variants also measure these execution-model assumptions.

## Validation and fleet experiment

```bash
npx tsx --test src/strategies/pair/pair.test.ts
npm run code:typecheck
npx eslint 'src/strategies/pair/**/*.ts'
```

The tests reproduce the handoff's 25/35/44 repair example and $230.74 cost in
both directions without fees, and cover duplicate fills, partial fills,
out-of-order acknowledgements, cancellation races, capital reservations,
actual opposite prices, skipped levels, and deterministic shared execution
under both live and parquet source labels.

[`markets-june-2026.json`](./markets-june-2026.json) pins the first 100 available
resolved BTC 15-minute markets from **2026-06-01 00:00 UTC**. They are consecutive,
ending with the market starting **2026-06-02 00:45 UTC**. No outcome-based
selection is used. Each variant runs exactly this set with `telonex-delta`,
140 ms fixed execution latency, zero jitter, and the engine's existing fees.

After the strategy commit is merged to main and available to workers:

```bash
npx tsx src/strategies/pair/run-fleet.ts --prefix pair-june2026-first100-v1
```

The launcher uses the normal distributed backtest CLI, enqueues each run once,
and writes submission logs under `data/pair-experiments/<prefix>/`. It refuses
to overwrite an existing directory. The engine's clean-tree and worker commit
checks remain enabled. Use a new prefix only for an intentional new experiment.
