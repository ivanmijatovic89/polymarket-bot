# Gabagool Lab — JOURNAL

Append-only narration. Newest at the bottom.

---

## 2026-07-17T03:17Z — session 1, unit 1: bootstrap

First working session. `gabagool-lab/` contained only CHARTER.md, the
pre-commit write-scope guard (wired via core.hooksPath), and launcher logs.
No STATE.md → I am session 1 in the relay.

Created the resumability skeleton: STATE.md (status + queue), this journal,
DECISIONS.md, OPERATOR-FEED.md. Verified: branch is `gabagool-lab`, tree was
clean, hook blocks writes outside `gabagool-lab/` + `src/strategies/gabagool-lab/`.

Plan for this session: Phase 0 in parallel (subagents digest the KB,
fable-lab, and strategy-research-protocol while I verify engine footguns in
code myself), then write the lab's design docs (EPISTEMOLOGY.md,
EVALUATION.md), then minimal tools, then an end-to-end smoke. L0 is the
target rung.

## 2026-07-17T04:15Z — session 1, unit 2: Phase 0 complete → INHERITANCE.md

Ran four parallel digests (KB, fable-lab, SRP, root docs + data/feeds)
while verifying engine facts first-hand in code. Everything distilled
into INHERITANCE.md with citations. The load-bearing findings:

- The sim's worst_queue shows only the adverse ~half of real fills (D2:
  44–49%). Doctrine: sim-negative is non-fatal for the maker leg,
  sim-positive is extraordinary evidence, and RANKINGS across variants
  sharing the maker-fill stream are trustworthy. The lab's evaluation
  is built around this, not around raw EV alone.
- The live edge exists NOW on btc-15m (b55f +2.31% fee-inclusive,
  on-chain audited) and its shape is measured: deep ladders, cheap-side
  rests, ~62% taker completion, back-loaded minutes 10–13, loose parity.
  Completion aggressiveness separates +2.31% from +0.31% (H6) — and
  completion-policy ranking is exactly what the sim CAN decide.
- Rebate income is exactly computable post-hoc (A22). Trading line and
  subsidy line will be reported separately, always.
- Sim taker fee is era-wrong in shape (156bps·min(p,1−p) vs real
  0.07·p(1−p)) — the lab re-prices taker fills per-fill from
  intent_meta, validated against the sim's own fees_paid column.
- Evaluation window: 2026-04-01→06-14 (fee shape certain); June 1–14 is
  the ONLY post-taker-rebate-era slice and becomes the untouchable
  confirmation holdout. Telonex coverage ends 2026-06-14 (G9).
- Fable's spread-capture death does NOT close my concept: it never
  tested parity-driven pair accumulation, pair-cost caps, deep ladders,
  time-weighting, or completion policy. That's the opening.
- Engine traps verified and listed (ambient 140ms .env latency!,
  maxOpenOrders=20, never-merge, fill-event gating, crossed books,
  intent_meta as the only per-fill channel).

Next unit: EPISTEMOLOGY.md + EVALUATION.md (the frozen scoring rule).

## 2026-07-17T04:45Z — session 1, unit 3: the rulebook

Wrote EPISTEMOLOGY.md v1 and EVALUATION.md v1 (frozen before any
experiment). The design departures from the old protocol, in short:

- Three experiment types (axis / candidate / probe) instead of
  everything facing a go/kill gate — sweeps produce curves, not
  verdicts; only candidates face championship gates (D-001).
- Era-partitioned evaluation: search Apr 1–May 31, one-shot holdout
  Jun 1–14 (the only post-taker-rebate slice), transition band labeled,
  no cross-era pooling (D-002).
- The headline number is EL = corrected trading line + rebate line,
  with taker fees re-priced per-fill at the on-chain-verified curve and
  the reconstruction validated against the sim's own fees column
  (D-003). Trading and subsidy lines always reported separately.
- Championship = hard gates (stability across weeks, tails, latency
  500/1000ms, pairing health, sample size) then a transparent SCORE for
  ordering only (D-004). Tail thresholds get calibrated from the L1
  baseline then frozen (D-005, pre-declared amendment path).
- Honesty machinery: frozen specs in LEDGER.md (git-timestamped),
  two-disjoint-halves screening, max-of-N labeling, paste-the-numbers
  rule, nothing-to-run → stop.

LEDGER.md created with the entry template. Next unit: tools
(submit.ts, results.ts) — port fable patterns, write against
backtest_run_segments/_markets directly.
