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

- **Session:** 23 (started 2026-07-17T14:52Z. Stamp rule: paste from
  `date -u` output captured in the same command — every estimate so
  far has drifted, including s17 u59's first draft. TZ note: this
  box is UTC+2; raw `stat` mtimes print LOCAL — subtract 2h)
- **Ladder rung:** L2 IN PROGRESS — E006 JUDGED (u52): AXIS-CLOSED,
  prediction REFUTED, chassis keeps requoteDelta 0.02; candidate
  assembly still BLOCKED (no conversion-closing lever proven).
  Current axis: E008-fv-gate FROZEN + LAUNCHED (u57, SHA 800b34cf,
  8 ax6 flows draining, ETA ~16:30-17:00Z; D-009 level form;
  grid {0,5,9,15} bps from u55 calibration; A/A basis run 723
  20/20 exact so refs 708/703 reused).
- **Phase:** E006 COMPLETE (LEDGER §E006 filled u52). 8/8 landed,
  uids to the digit, 0 failures, validators green ×8. Final map:
  715=q05h2 716=q10h1 717=q10h2 718=q20h1 719=q20h2 720=q45h1
  721=q05h1 722=q45h2. Chains ref→q05→q10→q20→q45: h1 −2.2884 →
  −2.5978 → −2.3103 → −2.2897 → −2.3015; h2 −2.0229 → −2.5887 →
  −2.3715 → −2.3681 → −2.3428. Every cell at-or-below ref; taker
  37%→5–7% as designed but EL does not recover → frozen prediction
  (EL→lat0 econ ≈ −0.1) REFUTED. Advance rule FAILS (endpoint dir
  agrees −/−; top-2 sets h1 {q02,q20} vs h2 {q02,q45} mismatch).
  Mechanism at full resolution (both chains decomposed, identity
  green): Δrem −1.08..−1.53 vs Δfee +0.21..+0.29, net pair ≤ +0.93
  — winner-remainder payload (worth $2.2–2.4/mkt at ref) is what
  requote-chasing buys; conversions were its price (LS-11). Real
  side effect: CVaR5 −15.5 → −8.7 (~45% tail improvement) — risk
  lever, not EV lever. Dead region on LEADERBOARD. Battery verdict
  stands (§E005 u42): depth latency-robust, candidate BLOCKED.
  E005: best cell rc+c960 −2.2884/−2.0229 (LS-9; E005b seeded).
  E004: cfree via removal; D-008; LS-7/8. EVALUATION v1.1 frozen.
  s16 ritual done (14:03Z): DONE absent, queue drained (3,000
  completed/0 failed markets; 3 failed agg = known stale foreign),
  tree had an UNCOMMITTED hook edit stripping the DONE guard (not
  mine, no journal trail) — restored via git checkout, noted in
  JOURNAL u52 + OPERATOR-FEED
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
- KB folds: A-1..A-6 in INHERITANCE (A30/A33 deep-pair = best-evidenced
  region; A32 maker-only cells tier-immune; A-5 = W2 capital anchor
  $0.9k/mkt p50 + W7 terrain ~9× flow decline; **A-6 (u53) = A34–A39:
  forensics independently confirms LS-11 (excess leg wins 60–81% at
  living wallets; post-fill drift = edge signature); A37 (offset ×
  requote) joint axis — per-rung requote policy seeded as E006b;
  A38 Jan stub-parquet flag — filter by event count on any Jan run**).
  KB register tops at A46 (checked s18 14:36Z; **A-7 (u59) = A40–A43
  fold: dip-harvesting closed as a family; genealogy capacity context
  (ceiling ~$2.75k/day, quit-at-peak n=8, fee shocks = retryOnlyIf
  windows). A-8 (u60) = A44–A46 fold: KB answered its OQ #1 — the
  only pre-fill discriminator is OWN-BOOK momentum; 10s falling-ask
  veto 3/3-robust; fixed 30s directional rules DEAD (regime-flips);
  E010-own-book-momentum-veto seeded in backlog (no feed needed,
  latency-robust); E006b gains conditional form (veto upward requote
  mid-rally); A46 session split is recipe-specific (b27bc932
  US-worst vs my evening-worst) — diagnostic, not axis. **A-9 (u64,
  s22) = A47–A48 fold: leg-risk priors measured — ≥0.99 favorite
  legs NEVER flip (0/393, ride to redemption); completion's
  protective value is mid-band only (0.50–0.70 flips 30–40%);
  pairing clock ~1 min (timeouts sweep 60–300s, never <60s);
  A47 favorite-lean base-rate = LS-11 Δrem payload seen from
  wallet forensics — doubly confirmed. E-completion-selective
  backlog entry sharpened. KB register tops at A48 (checked s22
  14:49Z); KB W4 leg-risk now FULLY covered.**).
- Key capability: intent_meta shared-accumulator persists BY REFERENCE →
  exact per-fill economics in DB. Export: results.ts --run N --export
  <path.csv>; battery: --battery id@lat,id@lat,...; session slices
  (A36 buckets) in every readout since u58 — refs show modest
  spread, evening 20-23Z worst both halves.
- **Worker daemon (survives session death):** `nohup caffeinate -is
  ./scripts/run-worker.sh --queues markets,aggregate
  --market-concurrency 4` from THIS worktree, log →
  `gabagool-lab/logs/worker-fullwin-s2.log`, code at 6de8fa0. Check
  `npx tsx gabagool-lab/tools/queue.ts` + `ps auxww | grep run-worker`.
  If dead: relaunch same way. The 3 failed jobs in the aggregate queue
  are stale foreign `imbalance-hold` duplicates — NOT mine, ignore.

## Queue (work top to bottom)

1. **E008 judgment when drained (ETA ~15:19Z; 11,373 waiting at
   14:52Z — LANDED SO FAR: run 725 = ax6h2-g00 EL -0.2681, run
   726 = ax6h1-g05 EL -1.4600, run 727 = ax6h2-g05 EL -1.5066;
   all uid-exact, validators green,
   no interpretation yet):** s23 waiter bez4s465g (bash loop) polls
   terminal ax6 rows (needs 8; LS-10 — run ids unknowable
   pre-landing); drain watcher nohup pid 21525 →
   logs/watch-drain-s16-e008.log. On fire per run: uid vs frozen
   §E008 block (`tools/uids.ts <id>`) + validators (`results.ts
   --run <id>`, quote ONLY the "<- headline" line). Then table:
   `e005-table.ts --arm g-off=708,703 --arm g00=<h1>,<h2> --arm
   g05=… --arm g09=… --arm g15=…` + per-arm decomp
   `e004-decomp.ts --runs 708,<g00h1>,<g05h1>,<g09h1>,<g15h1>`
   (and h2 chain from 703). Judge strictly per frozen §E008
   criteria: played<20% caveat, adjacency, advance rule (endpoint
   dir + top-2 set), Δrem ≥ −0.3 payload-preservation check on any
   winner, EL-vs-participation curve quoted either way. On partial:
   windowed --extend re-run per u41 recovery.
2. **After E008:** E006b per-rung requote (A37 seed), E005b cap
   bracket, completion composition per D-008 — order re-justified
   from E008's numbers. Candidate assembly stays BLOCKED until a
   conversion-closing lever is proven (u40 framework).

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
