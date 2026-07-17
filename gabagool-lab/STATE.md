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

1. **E002-baseline (L1) — IN FLIGHT, full-window arms.** Four fresh
   arms at 5,856 markets each (batchUids
   `glab--E002-baseline--fullwin--lat{0,140,500,1000}`, uids in LEDGER;
   SHA d5574428; ≈2.8h at concurrency 4, submitted ~07:40Z). The
   earlier 1,000-market chunk runs (666/670/667/669) are SUPERSEDED
   (extension impossible — schema round-trip; see LEDGER note) but
   already yielded the churn×latency conversion finding. NEXT STEPS:
   (a) when the four `fullwin` runs persist: `results.ts --run <id>
   --gates s2` per arm + `--battery id@0,id@140,id@500,id@1000`;
   (b) judge E002 in LEDGER (quote numbers, weekly table, tails,
   pairing, L-ratios); (c) calibrate TAIL_K + capital-efficiency floor
   from the lat140 distribution → EVALUATION v1.1 + DECISIONS entry;
   (d) then freeze + launch E003 parity axis (spec drafted in LEDGER).
   If resuming: `npx tsx gabagool-lab/tools/runs.ts --mine`; worker
   restart if needed: `./scripts/run-worker.sh --queues
   markets,aggregate --market-concurrency 4` FROM THIS WORKTREE
   (background it; logs → gabagool-lab/logs/).
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
