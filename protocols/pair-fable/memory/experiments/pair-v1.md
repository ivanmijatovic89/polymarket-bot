# Family: pair-v1 (entry discipline + repair + end cutoff)

Strategy file: `protocols/pair-fable/strategies/pair.v1.ts` (id
`pair-fable-v1`). Derived from pair-v0; same 6 params (M5-bounded), three
STRUCTURAL changes targeting v0's loss anatomy (pair-v0.md §Loss anatomy).

**design-ts (M2 rule)**: the commit that adds pair.v1.ts AND this file with
the frozen configs below is the param-freeze commit for BOTH pre-registered
configs. Recorded in LEDGER when runs land. Any config change after this
commit ⇒ new design-ts.

## Design deltas vs v0 (structural, not tunable)

1. **Start discipline**: new increments (balanced book) only JOIN bestBid,
   and only when the pair gate holds at that price — i.e. the pair is
   completable at top-of-book. v0's deep below-bid first legs (its main
   adverse-selection source: worst-queue fills them preferentially when the
   market moves against them) no longer exist. Consequence: v1 skips
   markets/moments where bestBid(UP)+bestBid(DOWN) > maxPairCost.
2. **Repair aggression**: the completion leg is priced at its full gate cap
   (may improve ABOVE bestBid, still strictly below bestAsk ⇒ maker, $0
   fees). v0 joined bestBid on the completion leg too, leaving residue
   unrepaired when the book never came back.
3. **End-of-window cutoff**: no new pair starts in the last 3 min of the 15m
   window (design constant 180s, not a param — must earn a slot per guard
   2); repair allowed to the end. Window end parsed from the slug epoch —
   identical live/replay.

## Pre-registered hypothesis + grid (guard 1, BEFORE launch)

**Hypothesis**: v0's −2.24/mkt is dominated by unpaired residue (p10 = −100
per $100; markets losing the entire one-sided investment). Cutting the three
residue sources should cut lost markets and raise ev materially; the cost is
fewer played markets (start gate skips uncompletable books) and slightly
worse pair prices on repair legs. Prediction (falsifiable): v1 ev > v0 ev by
more than the 0.05 noise threshold on the same screen universe, driven by a
lower lost-market fraction, NOT by lower volume alone — check profitPer100
moves the same direction as ev (E-004's failure mode: ev up, per-dollar
down = "trade less, lose less", not a cure).

Grid (all screen `--latest --limit 800` @ 140/20ms):

| config | params | rationale |
| --- | --- | --- |
| v1-a | defaults (maxPairCost 0.98) | isolate the structural deltas vs v0 defaults |
| v1-b | maxPairCost=0.95 | E-004 direction (2.5× reward/pair) × structural fixes; the start gate makes 0.95 far more selective |

Baseline: fresh v0 screen run at defaults on the SAME universe (`--latest
--limit 800`, 140/20ms) — prior v0 runs used the 300-OLDEST universe, not
comparable without heavy intersection loss; a fresh baseline is one cheap
run and stays reusable ≤7 days (evaluator.md §Universes).

Evaluation: compare.ts / evaluate.ts S1 per evaluator.md — ADVANCE needs
Δev > max(2×0.05, 0.05) vs the v0 baseline or ev > 0. Family noise floor:
inherit pair-v0's measured 0.0008 (same passive-GTD-maker mechanism, so the
0.05 conservative default governs anyway; re-measure only if v1 goes
taker-heavy, which its taker share will show).

## Runs

(appended as they land — one LEDGER line each)
