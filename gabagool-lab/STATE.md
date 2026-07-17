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

- **Session:** 12 (started 2026-07-17T06:52Z. Stamp rule: paste from
  `date -u` output captured in the same command — every estimate so
  far has drifted. TZ note: this box is UTC+2; raw `stat` mtimes
  print LOCAL — subtract 2h)
- **Ladder rung:** L2 IN PROGRESS — E005 CLOSED (u38): both
  sub-axes passed their advance rules (lab's first two); best cell
  rc+cap0.96 = −2.2884/−2.0229 maker-only (51% of ref loss removed)
- **Phase:** E005 judged end-to-end in §E005 (shape sub-judgment
  u36, cap-grid decision u36b, cap sub-judgment + final judgment +
  LS-9 u38). Cap curve monotone tighter-better, optimum UNBRACKETED
  at 0.96 edge → E005b {0.92,0.94} seeded. NEXT: latency battery
  (0/500/1000) on surviving region — pre-registered pre-candidate
  step (§E005 coverage clause). E004: §E004 (H6 survives; cfree via
  removal; caps dead; maker-only confirmations D-008; LS-7/8).
  EVALUATION v1.1 frozen. s12 ritual done: KB@A33 no-new, feeds
  unchanged (binance only)
- **Branch:** gabagool-lab (worktree at ~/Sites/polymarket-bot-gabagool-lab)
- **Write scope:** gabagool-lab/ + src/strategies/gabagool-lab/ (hook enforces)

## What exists so far

- L0 COMPLETE (session 1): INHERITANCE (folded through KB **A33**),
  EPISTEMOLOGY v1, EVALUATION **v1.1** (frozen; v1.1 = TAIL_K 41 +
  G11 per D-007), LEDGER (E001+E002 judged), tools (submit/results/
  runs/inspect-meta/queue/agg-inspect/calibrate/watch-drain +
  launch-e003.sh — DB-tested), E001 smoke green twice.
- **E004 JUDGED (u33, s12): H6 SURVIVES (spread 1.99%/2.24% of
  turnover vs 0.3% kill). cfree (free completion) best cell yet:
  EL −3.4665/−3.3541 (runs 694/695), DISTINCT vs c990 both halves;
  caps c970/c990 ≈ none (dead region logged). Mechanism (e004-
  decomp.ts, exact): completion wins by REMOVAL (maker fills −26%,
  conversions −39%, imb p90 1.000→0.335) despite S>1 pairs (locked
  ~2c loss each). Advance rule FAILED (tied middle) → candidate
  confirmations maker-only; D-008 = completion may enter a frozen
  candidate spec only. cfree forfeits ~$1/mkt winner remainders →
  E-completion-selective seeded. LS-7 + LS-8.**
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

1. **Latency battery on the surviving region (pre-registered,
   §E005 coverage clause; pre-candidate requirement):** rc+cap0.96
   at lat {0, 500, 1000} × halves = 6 runs (lat140 = existing
   708/703). Launcher LS-3 pattern (hardcode shape/cap/tol/
   completion; only lat varies; --dry-run; refuse queued ax5).
   Record uids in §E005 (battery addendum) or a §E005-battery
   block. Judgment: EL(lat) curve vs EVALUATION latency-robustness
   gate (survive 500–1000 ms); compare against E002's curve
   (−0.42/−4.39/−5.03/−5.30) — the deep ladder should degrade
   LESS (standing-ladder character, LS-1).
2. **Next axis decision after battery:** E005b cap extension
   {0.92,0.94} vs E006 timing vs deep×completion (D-008 path).
   Justify order from measured numbers + backlog. Then candidate
   assembly when the family is battery-proven.

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
