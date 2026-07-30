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

design-ts (both configs) = freeze commit `6a1ecde` @ 2026-07-31T01:44:42+02:00
(= 2026-07-30T23:44:42Z). Smoke: run 871 (5 mkts, 0 failures).

All 2026-07-31, `--latest --limit 800` @ 140/20ms, identical 800-market
universe (2026-07-14 → 07-22, common=800/800/800 — launched minutes apart):

| run | config | pnl | ev/mkt | p/100 | won/lost/flat | trades m/t | taker% |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 874 | v0 baseline (defaults) | −1686.90 | −2.1086 | −9.18 | 125/533/142 | 3885/60 | 1.5% |
| 872 | v1-a (defaults 0.98) | −1201.55 | −1.5019 | −8.05 | 365/340/95 | 2682/415 | 13.4% |
| 873 | v1-b (0.95) | −853.54 | −1.0669 | −9.17 | 301/315/184 | 1699/318 | 15.8% |

## Findings (screen, 2026-07-31 — S1 verdicts)

- **v1-a vs v0 (872 vs 874): Δev +0.6067, Δp/100 +1.1348 — BOTH units
  improve.** This is a real mechanism gain, not E-004's "trade less, lose
  less" (the pre-registered falsifiability check passes). Win rate 21%→51.7%
  (pnl_avg_win +0.57, avg_lose −4.14 vs v0's much worse skew). S1 call:
  Δev ≫ 0.05 ⇒ ADVANCE-direction, but ev is still < 0 ⇒ family verdict
  ITERATE (an S2 FULL on a known-negative variant buys little — iterate the
  design first). [runs 872/874 | 2026-07-31]
- **v1-b vs v0 (873 vs 874): Δev +1.0417 but Δp/100 +0.0102 (flat)** —
  invested drops $9.1k (−61%): roughly half the ev gain is volume reduction
  (E-004's failure mode), the other half real (v1-a isolates the structural
  part). Best headline ev of the family so far: −1.0669. ITERATE.
  [runs 873/874 | 2026-07-31]
- **Taker share exploded: 1.5% (v0) → 13.4/15.8% (v1)**. The repair-at-cap
  legs quote near the ask, and book drift across the 140ms latency converts
  them to taker (mechanism confirmed at small scale by E-003). pnl is net of
  those fees, so the +0.61 gain already absorbs them — but this is exactly
  the "quietly crossing when late" pattern S3 kills (m6 gate), and it will
  worsen with latency. v2 priority: repair pricing that improves the level
  WITHOUT hugging the ask (e.g. min(gateCap, bestBid+1 tick), or cap repair
  price at bestAsk − 2·GRID). [runs 872/873 | 2026-07-31]
- Same-family correlation 872~873 r=0.912, vs v0: 0.9486/0.8164 — same bet,
  as expected; no portfolio value inside the family. [2026-07-31]
- Next-step candidates (pre-register before launching): (a) v2 repair
  pricing variants per above; (b) loss anatomy on 872's 340 lost markets —
  meta `m:'S'|'R'` now distinguishes start vs repair fills, so residue
  source is measurable per market; (c) only after ev approaches 0: FULL +
  sweep (S3 will be the binding gate given the taker trend).
