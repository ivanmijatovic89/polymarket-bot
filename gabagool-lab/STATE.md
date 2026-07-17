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

- **Session:** 13 (started 2026-07-17T11:56Z. Stamp rule: paste from
  `date -u` output captured in the same command — every estimate so
  far has drifted. TZ note: this box is UTC+2; raw `stat` mtimes
  print LOCAL — subtract 2h)
- **Ladder rung:** L2 IN PROGRESS — E005 CLOSED + battery judged
  (u42: chassis latency-robust, EL conversion-dominated, candidate
  path BLOCKED); E006-quote-stability FROZEN + LAUNCHED (u44),
  draining
- **Phase:** E006 draining (launched 10:34Z at SHA 35a6f5de; 8
  flows ax5{h1,h2}×{q05,q10,q20,q45} on rc+c960 chassis, 23,424
  jobs). ETA ~12:33Z (~174/min, ~5.2k left at 12:03Z). 5/8 runs
  terminal + verified (u46+u47): 715=q05h2, 716=q10h1, 717=q10h2,
  718=q20h1, 719=q20h2 — uids to the digit, 0 failures, validators
  green. Early peek (no judgment): ALL 5 at-or-worse than ref
  (q05h2 −2.59, q10h2 −2.33, q20h2 −2.37 vs ref h2 −2.02; q10h1
  −2.25, q20h1 −2.25 vs ref h1 −2.29); taker share collapses as
  designed (37%→5–11%) but EL does not recover → prediction
  (EL→lat0 econ) in trouble; loss morphs into stale-quote adverse
  selection. LS-10 waiter: background bash id baqvcnq6o polls the
  3 remaining flows for terminal state, 90-min timeout.
  Drain watcher: nohup pid 94585 → logs/watch-drain-s12-e006.log.
  Ref delta 0.02 = runs 708/703 (reused). Battery verdict (§E005 u42): depth advantage
  latency-robust (+1.8–2.2 vs shallow every arm) BUT lat0 ≈ −0.07
  at 0.5 fills/mkt → lat140 loss ~100% requote-conversion; LS-1
  hypothesis refuted; u40 blind framework applied → candidate
  assembly BLOCKED pending conversion-closing axis (hence E006).
  E005: both sub-axes passed advance rules; best cell rc+c960
  −2.2884/−2.0229 (LS-9; E005b seeded). E004: H6 survives; cfree
  via removal; D-008; LS-7/8. EVALUATION v1.1 frozen. LS-10 (bare
  --extend footgun + terminal-state waiters). s13 ritual done
  (11:56Z): KB@A33 no-new (its top commit = operator process note),
  feeds still binance-only (wireBacktestExternalFeeds.ts:91 "no
  backtest source yet"), DONE absent, tree clean
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

1. **E006 judgment when drained (ETA ~12:33Z):** 5/8 verified (see
   Phase); remaining 3 = ax5h1-q05, ax5h1-q45, ax5h2-q45; waiter
   baqvcnq6o polling terminal state (LS-10), branch on partial
   (windowed --extend re-run per u41 recovery). On fire: verify
   uids (`tools/uids.ts <ids>`) + validators per run, then
   `e005-table.ts --arm q02=708,703 --arm q05=<h1>,715
   --arm q10=716,717 --arm q20=718,719 --arm q45=<h1>,<h2>`
   (verified blind u45). Judge per frozen §E006 criteria: chain
   adjacency, advance rule (endpoint direction + top-2-of-5 set
   match), EL-vs-participation curve, choke caveat at played<20%.
   Pre-registered prediction to check: EL → lat0-economics (≈ −0.1)
   as delta grows.
2. **Next move after E006 judgment:** if a delta arm holds EL near
   the lat0 bound with real participation → it joins the chassis;
   then E005b bracket / E008 fair-value / completion composition
   per D-008 (order re-justified from the new numbers). Candidate
   assembly stays blocked until a conversion-closing lever is
   proven.

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
