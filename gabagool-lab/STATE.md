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

- **Session:** 27 (started 2026-07-18T06:41Z. Stamp rule: paste from
  `date -u` output captured in the same command — every estimate so
  far has drifted, including s17 u59's first draft. TZ note: this
  box is UTC+2; raw `stat` mtimes print LOCAL — subtract 2h)
- **Ladder rung:** L2 IN PROGRESS — **E008-lat battery JUDGED (u74):
  the gate SURVIVES latency.** Survival rule passed ×4: ΔEL(g00 −
  ungated) +2.96/+2.61 at 500ms, +3.22/+2.89 at 1000ms, all
  DISTINCT; g00 slope lat0→1000 −0.26/−0.62 vs ungated −3.35/−3.46
  (~6–13× flatter; P2 ✓). P3 ✓ (g05 DISTINCT at 500 both halves).
  Chassis rc+c960+g00 CONFIRMED under stress; charter 500–1000ms
  mandate DISCHARGED for this lever. Honest misses: payload check
  FAILED as frozen at the lat0 boundary (h2 Δrem −0.365 vs −0.3
  floor) → D-011: the remainder capture is latency-CONDITIONAL
  (defensive lever — suppresses latency-induced adverse flow; at
  140–1000ms payload +3.2..+5.8, GROWS with latency); P1 REFUTED at
  lat0 (same root). g00 lat0 = first positive-EL cells
  (+0.013/+0.041) but played 13–16% <20% → unmeasurable-at-coverage:
  a bound, not a result. Candidate assembly STILL BLOCKED (no
  positive-EL cell at realistic latency; g00 best −0.036/−0.268 at
  140). Next lever: E008b favorite-side depth/sizing, then
  fresh-data confirmation (EVALUATION path, sel-width shrinkage).
- **Phase:** E008 + battery COMPLETE (LEDGER §E008 + addendum filled
  u69/u74). Battery runs 733–744 (g00: 738/733 lat0, 734/735 lat500,
  736/737 lat1000; g05: 742/739 lat0, 740/741 lat500, 743/744
  lat1000), uids to the digit, validators green ×12. **INCIDENT
  (u73, LS-13): run 742's stall-retry ran 1 market at lat140 inside
  the lat0 cell (raw --extend reads ambient .env=140ms; submit.ts
  --extend exists to pin it). Caught by fill fingerprint (25 taker
  fills in a taker≈0 cell), proven by exact deterministic
  reproduction (probe run 745). Run 714 (E005 battery, lat0 h1 ref)
  has carried the SAME 1-market flaw since u41 — erratum appended
  to §E005. LOO impact: −0.006/−0.005 EL (≈se/6, se/8); NO
  judgment call flips; the binding payload-FAIL cell (733/709) is
  contamination-free. Both runs stand with the flaw stated.**
  Counterfactual lat0 probes were still grinding at commit (the
  market takes ~10 CPU-min at lat0 — why it stalls BullMQ); record
  their numbers as a journal addendum when they land. Earlier: E008
  judged u69 (first reference-beating lever; LS-12; D-010), E006
  AXIS-CLOSED (LS-11), E005 battery (LS-9), E004 cfree/D-008,
  EVALUATION v1.1 frozen.
  s27 ritual done (06:41Z): DONE absent, hook intact this time,
  worker alive, battery drained 06:34Z.
- **Branch:** gabagool-lab (worktree at ~/Sites/polymarket-bot-gabagool-lab)
- **Write scope:** gabagool-lab/ + src/strategies/gabagool-lab/ (hook enforces)

## What exists so far

- **E008-lat battery JUDGED (u74, s27): gate SURVIVES latency —
  see Status digest above (the current headline result). D-011
  (payload = defensive/latency-conditional); LS-13 (extend env
  trap); §E005 erratum (run 714 1-market contamination since u41).**
- **E008 JUDGED (u69, s26): AXIS ADVANCES. Chassis = rc+c960+g00;
  g05 = the two-sided reference; D-010; LS-12; table tool gained
  gate mode.**
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
  KB register tops at A65 (checked s26 05:16Z; A-10 = A49–A65 fold
  u71: v1→v2 cutover Apr-28 INSIDE h1 — regime caveat on half
  disagreements, agreement now spans a migration; fee 0.072 h1 vs
  0.070 h2; weekday session map final, g00 dow-probe shows NO
  weekend collapse — signal-driven lean; capacity: btc-15m pool
  \$6.8k/day, cold-start ramp = days). Earlier: (checked s18 14:36Z; **A-7 (u59) = A40–A43
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

1. **Journal addendum when the lat0 counterfactual probes land**
   (bg probes on btc-updown-15m-1776879000: g05@lat0 pid 42021,
   then ungated@lat0 + ungated@lat140 sequentially; each lat0 run
   takes ~10+ CPU-min — pathological market). Record: exact lat0
   pnl for 742/714's market (replaces the LOO bound with the true
   counterfactual) + probe-4 reproduction check of 714's
   contaminated row. Numbers go to a short JOURNAL addendum; no
   judgment changes expected (LOO already showed ≤ se/6).
2. **E008b — favorite-side depth/sizing on g00 (draft + freeze +
   launch):** the lean is maximal at θ=0; the gated book is 2.6
   fills/mkt, outlay $8.4, one-sided by construction. Knobs: rung
   count/depth/clip ON THE FAVORITE SIDE (the side the gate
   allows). Goal: turn −0.036/−0.268 at lat140 positive by sizing
   into the measured winner-remainder payload. Design from §E008's
   decomp numbers; freeze BEFORE submit per protocol; include
   latency arms in the freeze (survival at 500/1000 now standard
   for any advancing cell).
3. **After E008b: fresh-data confirmation path per EVALUATION**
   (holdout; E32 winner's-curse defense — sel-width 5 needs
   shrinkage). Candidate assembly: blocked until a POSITIVE-EL
   cell exists that survives a latency battery (u40 framework,
   updated u69/u74).

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
