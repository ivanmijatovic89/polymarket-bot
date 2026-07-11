# BATCH-004 — SCR-009: the SIGNAL-003 complement-gate screen

_Frozen session 65, 2026-07-11, per SCREENING.md (D49 + amendments) and
the pre-committed SIGNAL-003 candidate branch (knowledge/SIGNAL-FILLS.md
§6 + amendments 1b/3, verdict in §7). Operator closing-sprint directive
active: ceremony cut to the frozen bars; no optional audits. Freeze =
this commit; strategy `strategies/screens/SCR-009-gated-down-touch.ts`
committed alongside; cell = schema defaults._

## Mini-spec (frozen)

### SCR-009 — SIGNAL-003-gated DOWN-side at-touch bid (IDEAS #22)

- mechanism: the run-472 SCR-008 cell verbatim (join DOWN best bid at
  touch, 30-870s, requote at 1c, hold to settlement, inventory cap 100)
  MINUS the one SIGNAL-003 cell-grid candidate: suppress/cancel the
  quote when (quote price ∈ [0.35, 0.65]) AND (latest valid UP-book
  l10Imb ≥ 0.6400). The threshold is the discovery MID-stratum 80th
  percentile, verified to select exactly the candidate cell's 1,435 of
  7,171 MID fills (computed outcome-free from the shard logs' feature
  columns, session 65). Gate shape is amendment-1b mechanical: the
  flagged cell's complement, nothing else.
- not-a-reskin: not a story gate — E19/E24 gates were a-priori
  time/regime stories and all worsened the fill mix; this gate is the
  first MEASURED fill-mix improvement (z=−4.30 toxic cell excised).
  Distinguishing element vs SCR-008 (kill by default outcome, E29):
  the fill population is provably different (17.7% of discovery fills
  removed, the subset carrying −5.54c/fill).
- invariants (D50): mirror books — gate uses the UP book, quotes the
  DOWN side; consistent (l10Imb on UP ≡ 1−l10Imb on DOWN, one feature).
  Self-crossed books — SCR-008 E6 guard retained. Boundary leak — moot
  (sample entirely inside the reserve window, below the holdout
  boundary 1777237200000). Worst-queue informativeness — not touched
  (touch_or_better bound per D18, same as run 472; model-optimistic,
  disclosed). results.ts zero-PnL convention — q̂/t over ALL N.
- aim: SIGNAL-FILLS §7 candidate (MID × l10Imb q5). The warm monotone
  move60 (+3.06) is NOT gated on (sub-bar; recorded as aiming aid only).
- strategy: `fable-scr-009`, schema defaults (gateMidLo=0.35,
  gateMidHi=0.65, gateImbMin=0.64; all other params = run-472 cell).
- prediction (both anchors disclosed per SIGNAL-FILLS §7): under the
  frozen §6 zero-anchor formula, kept fills average +1.19c/fill
  (p=0.1765, x=5.54c). Under the scan's own measured global anchor
  (−1.012c, n=8,130), the kept-fill complement measured −0.04c/fill —
  the honest point prediction is ≈ 0 before the E26c winner's-curse
  discount on the cell estimate itself. The mechanism REQUIRES q̂
  strictly better than SCR-008's +0.0033 with the gate suppressing
  MID/high-imbalance fills; if the gated cell is no better than the
  ungated one, the family's last arithmetic escape is closed.
- kill: DEFAULT D49 bars (q̂/t over all N). D18 outcome set binds:
  {kill, escalate-memo} — a SURVIVE-bar result writes an operator memo
  (queue-realistic fill model / live paper advocacy), never advances.
  If SCR-009 kills, IDEAS #22 → dead and the maker family CLOSES FOR
  GOOD per SIGNAL-FILLS §6 (no further maker screens without an
  operator-side instrument change or a D27-confirmed venue-drift fire).
- sample (pre-freeze deviations, stated): per D53 (SIGNAL-FILLS
  amendment 3) the sample is a uniform random draw from the RESERVE
  window `market_start_ms ∈ [1772323200000, 1777237199999]` — NOT the
  discovery window (the gate was mined there; a discovery re-run would
  be circular). N = 2000 (deviation from the 500 default, stated
  pre-freeze: power is effect-size-limited, not incidence-limited —
  at the optimistic +1.19c/fill anchor, t ≥ +1.5 needs ≈ 4,000 kept
  fills; N=2000 ≈ 1,560 kept fills is the largest affordable local
  touch run and still only ~½ that; the screen is therefore kill-biased
  by construction, which is acceptable — its D18 outcome set has no
  advance arm and a strong positive would still escalate). Draw
  implementation: seeded Fisher-Yates (seed string `SCR-009-draw-1`,
  djb2-hashed LCG) over the full eligible reserve-window slug list
  ordered by market_start_ms, first 2000 taken, split round-robin into
  6 disjoint local shards — mechanically equivalent to `--random
  --limit 2000` (uniform, outcome-blind) and reproducible, which the
  SQL RAND() path is not; slug lists recorded in
  `logs/SCR-009-shard[0-5].slugs`.
- execution: LOCAL 6-way sharded (touch mode cannot run on the fleet),
  `tools/run-backtest.ts --sequential --fill-mode touch_or_better`,
  batchUids `SCR-009-touch-s[0-5]` (D18 label), latency pinned 0/0
  (D8/D51 — the wrapper refuses ambient latency). Smoke first: 10
  discovery markets (the SIGNAL-003 smoke set), counts only.

## Pre-results amendments (append-only, before any shard result read)

- **Amendment 1 (extension rule, frozen pre-results):** after the N=2000
  verdict read, IF q̂ > 0 (any positive, whether or not the survive bar
  is met), the run is EXTENDED once over the remaining eligible
  reserve-window markets (~3,460) to sharpen the estimate for the
  months-later successor — extension via the same local touch shards on
  the leftover slugs, judged over the UNION. If q̂ ≤ 0 → kill stands on
  the N=2000 read, no extension, family closes. This rule exists so the
  extend/stop decision is not made after seeing how close the number is
  to a bar.
- **Amendment 2 (checker allocation, closing-sprint directive):** the
  D49 fresh-context batch checker runs ONLY if the verdict is
  escalate/survive-bar (false-positive protection where it pays); a
  kill at these bars is self-certifying (kill-biased screen, honest
  arithmetic already predicts ≈ 0) and gets no checker.

## Results (append-only, after all shards complete)

_(empty until run)_
