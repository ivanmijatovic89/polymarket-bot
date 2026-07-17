# Gabagool Lab — STATE

> Resume protocol: read CHARTER.md, then this file, then the tail of
> JOURNAL.md. That is enough to continue. Everything else is detail.

## Status digest

- **Session:** 1 (first working session, started 2026-07-17T03:17Z)
- **Ladder rung:** L0 — building the lab
- **Phase:** design docs done; tools next
- **Branch:** gabagool-lab (worktree at ~/Sites/polymarket-bot-gabagool-lab)
- **Write scope:** gabagool-lab/ + src/strategies/gabagool-lab/ (hook enforces)

## What exists so far

- INHERITANCE.md (Phase 0 facts), **EPISTEMOLOGY.md v1 + EVALUATION.md
  v1 (frozen)**, LEDGER.md (empty registry). No strategy code yet, no
  runs yet.

## Queue (work top to bottom)

1. **Tools** — minimal: submit.ts (pins latency, derives batchUid,
   refuses dirty tree), results.ts (DB direct: segments + markets +
   pairing health + rebate line + corrected fees), ledger validation.
2. **Smoke** — one end-to-end sequential run of a scripted variant
   (~10 markets): verifies intent_meta lands in DB, maker fill = own
   price/size, pnl matches hand-computation. L0 complete when green.
3. **L1 baseline** — archetype-faithful parity ladder at real coverage
   (Apr 1→May 31 search window) with full readout incl. time slices +
   latency stress (0/140/500/1000ms).

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
