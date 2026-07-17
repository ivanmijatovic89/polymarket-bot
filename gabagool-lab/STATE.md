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

1. **E002-baseline (L1) — IN FLIGHT.** Four arms submitted detached
   (lat 0/140/500/1000, batchUids `glab--E002-baseline--full--lat<ms>`,
   uids in LEDGER). Local worker running from this worktree
   (4 children). KNOWN: each arm truncated to first 1,000 window
   markets (producer LIMIT default; submit.ts since fixed). NEXT STEPS:
   (a) when arms persist, `submit.ts --extend <runId> --lat <ms>
   --limit 6000 --detach` each to full search window; (b) results.ts
   --gates s2 + --battery readout; (c) judge E002 in LEDGER;
   (d) calibrate TAIL_K + capital floor → EVALUATION v1.1 (D-entry).
   If resuming: check `runs.ts --mine`; worker may need restart
   (`./scripts/run-worker.sh --queues markets,aggregate
   --market-concurrency 4` FROM THIS WORKTREE).
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
