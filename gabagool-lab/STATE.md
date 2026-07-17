# Gabagool Lab — STATE

> Resume protocol: read CHARTER.md, then this file, then the tail of
> JOURNAL.md. That is enough to continue. Everything else is detail.

## Status digest

- **Session:** 2 (started 2026-07-17T04:14Z; session 1 ran ~03:09–04:13Z
  and its journal stamps after unit 4 drifted +2h — trust `date -u` only)
- **Ladder rung:** L1 — baseline measurement (L0 complete)
- **Phase:** E002-baseline fullwin arms draining; judgment this session
- **Branch:** gabagool-lab (worktree at ~/Sites/polymarket-bot-gabagool-lab)
- **Write scope:** gabagool-lab/ + src/strategies/gabagool-lab/ (hook enforces)

## What exists so far

- L0 COMPLETE: INHERITANCE.md (folded through KB A26), EPISTEMOLOGY v1 +
  EVALUATION v1 (frozen), LEDGER (E001 judged), tools
  (submit/results/runs/inspect-meta/queue — all DB-tested), E001 smoke
  green twice (runs 662/663, deterministic).
- Key capability: intent_meta shared-accumulator persists BY REFERENCE →
  exact per-fill economics in DB (realized taker px, per-leg docks).
- **Worker daemon (survives session death):** relaunched 04:26Z as
  `nohup caffeinate -is ./scripts/run-worker.sh --queues
  markets,aggregate --market-concurrency 4` from THIS worktree, log →
  `gabagool-lab/logs/worker-fullwin-s2.log`. Check with
  `npx tsx gabagool-lab/tools/queue.ts` and `ps auxww | grep run-worker`.
  If dead: relaunch the same way (subshell + nohup so it reparents).

## Queue (work top to bottom)

1. **E002-baseline (L1) — fullwin arms draining, ETA ~08:00-08:45Z (rate fell to ~1.2/s).** Four
   arms × 5,856 markets (batchUids
   `glab--E002-baseline--fullwin--lat{0,140,500,1000}`, SHA d5574428,
   uids in LEDGER). When the market queue empties, 4 aggregate jobs
   persist the runs (worker handles both queues; it self-updated to
   24d0dcd mid-drain, harmless). `tools/watch-drain.ts` blocks until
   drained/worker-dead/timeout — useful for hands-off waiting.
   THEN: (a) `results.ts --run <id> --gates s2` per arm +
   `--battery id@0,id@140,id@500,id@1000`; (b) judge E002 in LEDGER
   (numbers, weekly table, tails, pairing, L-ratios); (c) calibrate
   TAIL_K + capital-efficiency floor from the lat140 distribution →
   EVALUATION v1.1 + DECISIONS entry; (d) freeze + launch E003 parity
   axis (spec drafted in LEDGER). Superseded chunk runs 666/667/669/670
   remain useful for tooling rehearsal only.
2. **L1 readout + threshold freeze** — full evaluation readout of the
   baseline; DECISIONS entry for v1.1 thresholds; LEADERBOARD.md
   started. This number is the reference everything must beat.
3. **L2 campaign start** — first axes from the seed queue: parity
   tolerance (H1), completion policy (H6), ladder depth/timing (A17).

## Open questions / risks

- Feeds: binanceWsSpotPrice replayable NOW; price-to-beat + Chainlink
  NOT landed (checked origin/main 04:30Z; H4 strike proxy =
  window-open spot stands).
- KB (re-read every session): folded through A26. A26 removed the
  "class blow-up casualty" prior (was World Cup books); tail
  discipline unchanged. KB Phase 2 (variant atlas) is a future seed
  source.
- Telonex coverage ends 2026-06-14; July meta not replayable until
  operator resumes sync.
- Remote fleet tracks origin/main — not mine; local worker only.
- Disk at 98% (9.7Gi free) — keep artifacts lean, prune worker logs
  when superseded.
- Ask for operator (non-blocking, noted in feed): CLI/env passthrough
  for makerFillMode=touch_or_better would enable fill-model bracketing.

## Key paths

- KB: `/Users/mijat/Sites/polymarket-bot-gabagool/research/gabagool/`
- fable-lab quarry: `/Users/mijat/Sites/polymarket-bot-fable/fable-lab/`
- SRP quarry: `strategy-research-protocol/` (repo root)
- Telonex data: `data/events/telonex/`
