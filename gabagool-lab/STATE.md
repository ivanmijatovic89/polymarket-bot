# Gabagool Lab — STATE

> Resume protocol: read CHARTER.md, then this file, then the tail of
> JOURNAL.md. That is enough to continue. Everything else is detail.

## Status digest

- **Session:** 3 (started 2026-07-17T04:47Z; s1 ~03:09–04:13Z, s2
  ~04:14–04:47Z. Journal stamps in s1/s2 drifted up to +2h — trust
  `date -u` only; s3 stamps are real)
- **Ladder rung:** L1 — baseline measurement (L0 complete)
- **Phase:** E002-baseline: lat0 arm DONE (run 675, preview in LEDGER);
  lat140/500/1000 draining at ~7.7 jobs/s, market queue empties ~05:10Z
- **Branch:** gabagool-lab (worktree at ~/Sites/polymarket-bot-gabagool-lab)
- **Write scope:** gabagool-lab/ + src/strategies/gabagool-lab/ (hook enforces)

## What exists so far

- L0 COMPLETE: INHERITANCE.md (folded through KB **A31**), EPISTEMOLOGY
  v1 + EVALUATION v1 (frozen), LEDGER (E001 judged; E002 lat0 preview
  in), tools (submit/results/runs/inspect-meta/queue/agg-inspect/
  calibrate/watch-drain — DB-tested), E001 smoke green twice
  (deterministic), E003 code determinism proven (672/673/674).
- E002 fullwin lat0 (run 675): EL −0.42 (t −8.5), 0/9 weeks positive,
  pairRate 0.29, imbalance p50=1.0 — frictionless baseline loses and
  barely pairs; validators all green at 5,856-market scale.
- KB A30 seed (new): deep-pair region pairCostCap ~0.96–0.98 is where
  the only trading-profitable parity wallet lives → backlog E005 cell.
- Key capability: intent_meta shared-accumulator persists BY REFERENCE →
  exact per-fill economics in DB (realized taker px, per-leg docks).
- **Worker daemon (survives session death):** `nohup caffeinate -is
  ./scripts/run-worker.sh --queues markets,aggregate
  --market-concurrency 4` from THIS worktree, log →
  `gabagool-lab/logs/worker-fullwin-s2.log`, code at 6de8fa0 (tip).
  Check `npx tsx gabagool-lab/tools/queue.ts` + `ps auxww | grep
  run-worker`. If dead: relaunch the same way (subshell + nohup so it
  reparents). Aggregate queue also has an operator worker (tmux, main
  repo) — lat0's aggregate persisted fine regardless; the 3 stale
  `imbalance-hold` failed jobs in the aggregate queue are NOT mine
  (duplicate-key noise from an old campaign, ignore).

## Queue (work top to bottom)

1. **E002 judgment (this session):** when the 3 arms persist —
   (a) `results.ts --run <id> --gates s2` per arm + `--battery
   <lat0>,<lat140>,<lat500>,<lat1000>` (run ids via runs.ts; lat0=675);
   (b) judge E002 in LEDGER (numbers, weekly, tails, pairing, L-ratios,
   the churn×latency pairing mechanism — lat0 pairRate 0.29 vs chunk
   lat140 0.68 says pairing at 140ms is mostly stale-quote churn);
   (c) `results.ts --run <lat140> --export` → `calibrate.ts` → TAIL_K +
   capital floor → EVALUATION v1.1 + DECISIONS entry (logic
   pre-registered s2 u8: floor target ~$0.5–1.0/market, written
   rationale at freeze); (d) freeze E003 + launch its 10 arms (exact
   commands in LEDGER §E003). `tools/watch-drain.ts` blocks until
   drained/worker-dead — use it for hands-off waiting.
2. **L1 readout close:** LEADERBOARD.md started (baseline row), feed +
   STATE updated. This number is the reference everything must beat.
3. **L2 campaign:** E003 parity-axis judgment → E004 completion policy
   (H6) → E005 ladder + deep-pair cell (A30) → E006 timing. Seeds in
   LEDGER backlog.

## Open questions / risks

- Feeds: binanceWsSpotPrice replayable NOW; price-to-beat + Chainlink
  NOT landed (checked origin/main 04:50Z s3 — "no backtest source yet"
  in wireBacktestExternalFeeds.ts; H4 strike proxy = window-open spot).
- KB folded through A31. Variant atlas (W0) in progress KB-side —
  future seed source; re-read KB STATE every session.
- Telonex coverage ends 2026-06-14; July meta not replayable until
  operator resumes sync.
- Remote fleet tracks origin/main — not mine; local worker only.
- Disk at 98% (~9.7Gi free) — keep artifacts lean; exports gitignored.
- Ask for operator (non-blocking): CLI/env passthrough for
  makerFillMode=touch_or_better would enable fill-model bracketing.

## Key paths

- KB: `/Users/mijat/Sites/polymarket-bot-gabagool/research/gabagool/`
- fable-lab quarry: `/Users/mijat/Sites/polymarket-bot-fable/fable-lab/`
- SRP quarry: `strategy-research-protocol/` (repo root)
- Telonex data: `data/events/telonex/`
