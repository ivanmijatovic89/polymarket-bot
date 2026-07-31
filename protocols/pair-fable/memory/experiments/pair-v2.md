# Family: pair-v2 (repair persistence)

Strategy file: `protocols/pair-fable/strategies/pair.v2.ts` (id
`pair-fable-v2`). Derived from pair-v1; same 6 params (M5-bounded), three
STRUCTURAL changes targeting v1's anatomy (pair-v1.md §Anatomy, runs
872/873): the whole loss is unpaired residue (344/345 residue markets lose,
~$4.4 each), repair rate is 80% vs ~94% break-even, and v1's repair leg
stops chasing at the START gate although completion is profitable to <1.00.

**design-ts (M2 rule)**: the commit that adds pair.v2.ts AND this file with
the frozen configs below is the param-freeze commit for BOTH pre-registered
configs. Any config change after this commit ⇒ new design-ts.

## Design deltas vs v1 (structural, not tunable)

4. **Chase-to-breakeven repair**: the repair budget uses design constant
   `REPAIR_PAIR_COST = 0.995` (start gate keeps `maxPairCost`). v1 blocked
   still-profitable completions between the gate and 1.00 and ate the full
   residue loss instead.
5. **No repair blackout**: `cooldownTicks` applies only after START-mode
   orders end; a gone repair leg re-places next tick. v1 left the imbalance
   unquoted for TTL-expiry + 25 ticks per cycle while the book drifted.
6. **Repair taker guard**: repair quotes ≤ bestAsk − 2·GRID (v1: ask−1 tick
   whenever the cap allowed; one tick of drift across 140ms → taker; v1
   taker share 13–16% is the S3-killing pattern). Starts keep join-bestBid —
   their measured taker contribution was 15/415 fills.

## Pre-registered hypothesis + grid (guard 1, BEFORE launch)

**Hypothesis**: v1's doom rate (residue markets / played = 49%) is partly
repair-mechanism failure, not only price run-away: the chase stops at the
start gate, and each failed cycle has a ~25-tick unquoted blackout. Making
repair persistent and budgeted to breakeven converts a material fraction of
−$4.3 dooms into ≈$0 completed pairs. Prediction (falsifiable): v2-a vs v1-a
(run 872 on the slug intersection): doom rate ≤ 35% (from 49%), Δev >
+0.5, taker share < 8% (fix 6), with invested NOT decreasing (the loss cut
must come from repaired residue, not reduced volume — anti-E-004 check;
anatomy.ts measures doom rate and taker attribution directly). Secondary:
chased repairs carry near-zero margin, so profitPer100 may move less than
ev — acceptable only if invested holds or rises.

Grid (all screen `--latest --limit 800` @ 140/20ms):

| config | params | rationale |
| --- | --- | --- |
| v2-a | defaults (maxPairCost 0.98) | isolate repair-persistence deltas vs v1-a (872) |
| v2-b | maxPairCost=0.95 | stack with the tighter start gate (v1-b showed margin effect wins) |

Baseline: run 874 (v0 defaults, latest-800 launched 2026-07-31, valid ≤
2026-08-06) for cross-family S1; run 872/873 for the mechanism deltas via
compare.ts intersection + anatomy.ts.

Evaluation: S1 per evaluator.md — noise floor: inherit the conservative
0.05 default (fix 6 should push taker back down; if taker stays >10%,
re-measure the family noise floor with a duplicate pair before trusting
small deltas).

## Runs

(pending)

## Findings

(pending)
