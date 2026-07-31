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

design-ts (both configs) = freeze commit `0f0f423` @ 2026-07-31T00:06:47Z.
Smoke: run 875 (5 mkts, 0 failures).

All 2026-07-31, `--latest --limit 800` @ 140/20ms, identical 800-market
universe as 872/873/874 (common=800 in compare.ts):

| run | config | pnl | ev/mkt | p/100 | doom mkts | pairsPnl | residuePnl | taker% |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 876 | v2-a (0.98) | −1223.11 | −1.5289 | −8.30 | 323/704 | +243.51 | −1398.22 | 14.1% |
| 877 | v2-b (0.95) | −824.95 | −1.0312 | −8.73 | 238/618 | +170.45 | −951.67 | 15.1% |

v1 references on the same universe: 872 (v1-a) ev −1.5019, doom 345/706,
pairsPnl +382.46; 873 (v1-b) ev −1.0669, doom 320/618, pairsPnl +497.27.

## Findings (2026-07-31 — S1 verdicts)

- **The pre-registered prediction FAILS, twice**: Δev vs the matching v1
  config is −0.027 (876 vs 872) and +0.036 (877 vs 873) — both under the
  0.05 threshold ⇒ INDISTINGUISHABLE at both gate levels. Prefer the
  simpler variant (guard 2): v1 stays, **family verdict KILL** (time-scoped
  2026-07, latest-800 universe, runs 876/877). [2026-07-31]
- **Mechanism result (the valuable part): repair persistence is EV-neutral
  because chasing pays the market exactly what the doom saves.** The doom
  rate DID drop (0.95 gate: 52%→39%; residuePnl −1301→−952, +349) but pair
  margin gave it all back (pairsPnl 497→170, −327): chased completions
  execute at pair costs near 0.995 with ≈0 margin, and the residue they
  avoid was priced fairly. Empirical confirmation of the efficient-pricing
  argument sketched in pair-v1.md §Anatomy — completing above the gate is
  not a loss-recovery mechanism, at any chase budget. [runs 876/877 vs
  872/873 | 2026-07-31]
- **Fix 6 (repair quotes ≤ ask−2 ticks) did NOT cut taker share** (14.1/
  15.1% vs v1's 13.4/15.8%): persistence re-quotes track the ask upward, and
  fast multi-tick drops cross stale quotes regardless of a placement-time
  guard (consistent with pair-v0's E-003). Placement-time guards cannot fix
  the taker share of an ask-hugging repair leg. [runs 876/877 | 2026-07-31]
- Consequence for the research plan: HOW to complete pairs is a dead axis
  (v1 fixed entries, v2 fixed repairs — per-dollar loss sits at −8.0..−9.2
  per $100 in every config incl. the whole v1 gate curve). The live axis is
  WHEN to start — start selection on market state (contested vs decided
  windows), pair-v3 direction. [runs 872–879 | 2026-07-31]
