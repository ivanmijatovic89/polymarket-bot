# Gabagool Lab — STATE

> Resume protocol: read CHARTER.md, then this file, then the tail of
> JOURNAL.md. That is enough to continue. Everything else is detail.
> Pickup ritual additions: (1) verify `gabagool-lab/DONE` does NOT
> exist (stray external one appeared 2026-07-17T05:17Z, purged u14a;
> hook blocks re-adds unless GLAB_L3_DONE=yes); (2) never bare
> `git add -A` — stage explicitly.

## Status digest

- **Session:** 3 (started 2026-07-17T04:47Z; s1 ~03:09–04:13Z, s2
  ~04:14–04:47Z. Journal stamps in s1/s2 drifted up to +2h — trust
  `date -u` only; s3 stamps are real)
- **Ladder rung:** L1 COMPLETE (E002 judged, unit 14) → L2 opens with
  E003 launch
- **Phase:** E002 judged AXIS-CLOSED; EVALUATION v1.1 frozen (TAIL_K
  41, G11 cap-floor 0.92/$100, D-007); next = freeze+launch E003
- **Branch:** gabagool-lab (worktree at ~/Sites/polymarket-bot-gabagool-lab)
- **Write scope:** gabagool-lab/ + src/strategies/gabagool-lab/ (hook enforces)

## What exists so far

- L0 COMPLETE (session 1): INHERITANCE (folded through KB **A33**),
  EPISTEMOLOGY v1, EVALUATION **v1.1** (frozen; v1.1 = TAIL_K 41 +
  G11 per D-007), LEDGER (E001+E002 judged), tools (submit/results/
  runs/inspect-meta/queue/agg-inspect/calibrate/watch-drain +
  launch-e003.sh — DB-tested), E001 smoke green twice.
- **L1 COMPLETE (unit 14): E002 fullwin battery, runs 675/678/676/677
  (lat0/140/500/1000), 5,856 mkts each, 0 failed, validators green.
  EL −0.42/−4.39/−5.03/−5.30; 0/36 arm-weeks positive; taker
  conversions 0/34%/48%/55% of fills; pairRate 0.291 at lat0 with
  imbalance p50=1.00. Verdict AXIS-CLOSED (shallow-requote region
  dead). Reference to beat: EL(140) −4.39, frictionless bound −0.42.
  Central mechanism: requote churn × latency = involuntary taker;
  quote-stability is a design axis. LEADERBOARD has the row + first
  dead region.**
- KB folds: A-1..A-4 in INHERITANCE (A30/A33 deep-pair = best-evidenced
  region; A32 maker-only cells tier-immune; A26 no-blow-up prior).
- Key capability: intent_meta shared-accumulator persists BY REFERENCE →
  exact per-fill economics in DB. Export: results.ts --run N --export
  <path.csv>; battery: --battery id@lat,id@lat,...
- **Worker daemon (survives session death):** `nohup caffeinate -is
  ./scripts/run-worker.sh --queues markets,aggregate
  --market-concurrency 4` from THIS worktree, log →
  `gabagool-lab/logs/worker-fullwin-s2.log`, code at 6de8fa0. Check
  `npx tsx gabagool-lab/tools/queue.ts` + `ps auxww | grep run-worker`.
  If dead: relaunch same way. The 3 failed jobs in the aggregate queue
  are stale foreign `imbalance-hold` duplicates — NOT mine, ignore.

## Queue (work top to bottom)

1. **E003 judgment when drained (ETA ~07:05Z; watch-drain armed,
   task b4j518rhr, 3h timeout):** 10 flows live (uids in LEDGER §E003
   Runs; run 679 = failed tombstone from the double-submit incident,
   IGNORE). Per-arm readouts (`results.ts --run <id> --gates s1`),
   advance rule AS WRITTEN in LEDGER §E003 (direction agreement +
   top-2 set match across halves), judge, lesson, LEADERBOARD update.
   Axis gates only (G2/G3/G9). h1 = Apr (2,880 mkts), h2 = May
   (2,976); EL is comparable per-market across halves.
2. **L2 campaign continues:** E004 completion policy (H6; re-smoke
   first — completionTtl code is unsmoked), E005 ladder + deep-pair
   cell (pairCostCap {0.96,0.97,0.98} — best-evidenced region, A30/
   A33), E006 timing. Seeds in LEDGER backlog. Before E004 freeze:
   state tier-0 fee basis in its criteria (A32, INHERITANCE A-4).

## Open questions / risks

- Feeds: binanceWsSpotPrice replayable NOW; price-to-beat + Chainlink
  NOT landed (checked origin/main 04:50Z s3 — "no backtest source yet"
  in wireBacktestExternalFeeds.ts; H4 strike proxy = window-open spot).
- KB folded through A33; KB session 7 active in parallel (variant
  atlas done, W3 snapshots). Re-read KB STATE every session.
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
