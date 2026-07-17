# Gabagool Lab — STATE

> Resume protocol: read CHARTER.md, then this file, then the tail of
> JOURNAL.md. That is enough to continue. Everything else is detail.

## Status digest

- **Session:** 1 (first working session, started 2026-07-17T03:17Z)
- **Ladder rung:** L1 — baseline measurement (L0 complete this session)
- **Phase:** E002-baseline design + screen runs
- **Branch:** gabagool-lab (worktree at ~/Sites/polymarket-bot-gabagool-lab)
- **Write scope:** gabagool-lab/ + src/strategies/gabagool-lab/ (hook enforces)

## What exists so far

- L0 COMPLETE: INHERITANCE.md, EPISTEMOLOGY v1 + EVALUATION v1 (frozen),
  LEDGER (E001 judged), tools (submit/results/runs/inspect-meta — all
  DB-tested), E001 smoke green twice (runs 662/663, deterministic).
- Key capability: intent_meta shared-accumulator persists BY REFERENCE →
  exact per-fill economics in DB (realized taker px, per-leg docks).

## Queue (work top to bottom)

1. **E002-baseline (L1)** — archetype-faithful parity ladder reference:
   two-sided GTC rungs, parity-driven side selection, never-overpay
   guard (pair-cost cap), band [0.11,0.85], hold to settlement. Spec →
   freeze → S1 screen (two disjoint 400-market halves, lat 140) → full
   search window + latency battery (0/140/500/1000). Its distribution
   calibrates TAIL_K + capital floor → EVALUATION v1.1 frozen before
   any candidate.
2. **L1 readout + threshold freeze** — full evaluation readout of the
   baseline; DECISIONS entry for v1.1 thresholds; LEADERBOARD.md
   started. This number is the reference everything must beat.
3. **L2 campaign start** — first axes from the seed queue: parity
   tolerance (H1), completion policy (H6), ladder depth/timing (A17).

## Open questions / risks

- Sibling KB shift near saturation → LAB-HANDOFF.md pending; re-read its
  STATE.md every session.
- Feeds: binanceWsSpotPrice replayable NOW; price-to-beat + Chainlink NOT
  landed (H4 partially blocked; strike proxy = window-open spot is viable).
- Telonex coverage ends 2026-06-14; July meta not replayable until
  operator resumes sync.
- Remote fleet tracks origin/main — not mine; local workers only
  (run-worker.sh from this worktree needs pushed commits).
- Ask for operator (non-blocking, noted in feed): CLI/env passthrough for
  makerFillMode=touch_or_better would enable fill-model bracketing.

## Key paths

- KB: `/Users/mijat/Sites/polymarket-bot-gabagool/research/gabagool/`
- fable-lab quarry: `/Users/mijat/Sites/polymarket-bot-fable/fable-lab/`
- SRP quarry: `strategy-research-protocol/` (repo root)
- Telonex data: `data/events/telonex/`
