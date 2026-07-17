# Gabagool Lab — STATE

> Resume protocol: read CHARTER.md, then this file, then the tail of
> JOURNAL.md. That is enough to continue. Everything else is detail.
> Pickup ritual additions: (1) verify `gabagool-lab/DONE` does NOT
> exist (stray external one appeared 2026-07-17T05:17Z, purged u14a;
> hook blocks re-adds unless GLAB_L3_DONE=yes); (2) never bare
> `git add -A` — stage explicitly; (3) OPERATOR-FEED entry EVERY unit,
> same commit (s3 skipped 4 — backfilled u18; don't repeat); (4) stamp
> journal entries from `date -u` output only, never estimates (every
> session so far has drifted ahead when estimating).

## Status digest

- **Session:** 11 (started 2026-07-17T06:24Z. Stamp rule: paste from
  `date -u` output captured in the same command — every estimate so
  far has drifted. TZ note: this box is UTC+2; raw `stat` mtimes
  print LOCAL — subtract 2h)
- **Ladder rung:** L2 IN PROGRESS — E003 JUDGED (AXIS-CLOSED, u27);
  next: E004 freeze + launch
- **Phase:** E003 drained clean at ~06:27Z (10/10 runs 681–690
  completed, 0 failed markets, validators green). Judgment in LEDGER
  §E003: advance rule BOTH HOLD (tighter better, top-2 {0.1,2} both
  halves); best arm = floor = E002 reference −4.39; loose {20,40}
  dead region. **SEED = parityTolPct 2** (runs 682/683 = E004 `none`
  control pair). EVALUATION v1.1 frozen (TAIL_K 41, G11 cap-floor
  0.92/$100, D-007)
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
- **E003 JUDGED (u27, s11): AXIS-CLOSED. Runs 681–690 (5 tol arms ×
  Apr/May halves, lat140), all validators green. Tighter parity
  strictly better (trend −1 both halves; endpoints distinct), but
  best arm = floor = E002 baseline −4.39 exactly (bit-identical
  reproduction, 74,111m/38,144t fills). Mechanism: loose parity
  admits adverse one-sided inventory (−21c/marginal fill at tol 40),
  taker share flat, pairRate falls. SEED=2 for E004/E005; loose
  {20,40} in dead regions; LS-6 (floored arms collapse — state
  effective grids).**
- KB folds: A-1..A-5 in INHERITANCE (A30/A33 deep-pair = best-evidenced
  region; A32 maker-only cells tier-immune; A26 no-blow-up prior;
  A-5 = W2 capital anchor $0.9k/mkt p50 + W7 terrain: btc-15m flow
  down ~9× from Jan peak — cite in capacity notes and monthly-trend
  attribution). KB register still tops at A33 (checked s4 05:45Z).
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

1. **E004 freeze + launch (next unit):** E003 judged → SEED = 2.
   Steps: in LEDGER §E004 fill SEED=2, record control batchUids
   (682: …ax1h1-p020…47d8d807-554b-40bb-be36-185246646fbf, 683:
   …ax1h2-p020…b68867c5-f215-4c3a-8258-3d54d1ab64c7), status→frozen,
   then `tools/launch-e004.sh --tol 2` (re-smoke done run 680;
   launcher dry-run verified u22; LS-3: verify with read-only tools
   only). 6 new runs ~3.5k jobs. Fee basis (A32 tier-0) already in
   criteria. Arm watch-drain after launch.
2. **L2 campaign continues after E004 judgment:** E005 ladder +
   deep-pair cell (pairCostCap {0.96,0.97,0.98} — best-evidenced
   region, A30/A33; parityTolPct default = 2 per E003), E006 timing.
   Seeds in LEDGER backlog. E003 detail: LEDGER §E003 judgment
   (AXIS-CLOSED; loose {20,40} = dead region; LS-6 effective-grid
   rule for future axis specs).

## Open questions / risks

- Feeds: binanceWsSpotPrice replayable NOW; price-to-beat + Chainlink
  NOT landed (re-checked origin/main 05:45Z s4 — only binance sub-feed
  available per src/backtest/feeds/wireBacktestExternalFeeds.ts, note
  the path; H4 strike proxy = window-open spot).
- KB folded through A33 + W2/W7 measurements (A-5); KB is in PHASE 2
  (open-ended, operator reopened; its new #1 = 0x04b6d7e9 deep-dive).
  Re-read KB STATE every session.
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
