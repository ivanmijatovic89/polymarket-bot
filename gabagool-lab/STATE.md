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

- **Session:** 32 (started 2026-07-18T08:17Z. Stamp rule: paste from
  `date -u` output captured in the same command — every estimate so
  far has drifted, including s17 u59's first draft. TZ note: this
  box is UTC+2; raw `stat` mtimes print LOCAL — subtract 2h)
- **Ladder rung:** L2 IN PROGRESS — **E008b JUDGED (u86): the
  favorite-side axis is CLOSED. No arm advances.** All 12 runs
  landed clean (f=0 ×12, zero stalls — first battery with no
  extends), uids to the digit, validators green ×12. Every ΔEL vs
  g00 indistinguishable (|Δ| 0.003–0.115 vs 2·se_diff 0.35–0.46)
  except r12s h2 DISTINCT WORSE (−0.730 vs −0.268). P1 REFUTED
  sign-backwards (r12s Δrem +2.28/+1.93 vs predicted ≤ −1.0);
  **P2 CONFIRMED but economically neutralized** (s85 Δrem
  +2.18/+2.05 vs Δcost +2.13/+2.06 — cancels to a cent; s75 same);
  P3 REFUTED → axis closes per frozen rule 5. Mechanism: the
  marginal favorite fill is fairly-to-adversely priced — remainder
  scales with outlay but is never free; the A47 never-flip prior
  is in the price; only the GATE (removing fills) ever improved
  the ratio. Structure flat at θ=0 (depth rung near-inert once
  gated). Chassis stays rc+c960+g00; g00 stays best cell
  (−0.036/−0.268 at lat140, lat0 bound ≈ 0). Candidate assembly
  STILL BLOCKED (no positive-EL cell at realistic latency).
  **Backlog re-ranked per frozen rule 5: E010 own-book momentum
  veto is RANK 1** (attacks the adverse maker-fill subset
  pre-fill; KB A44–A45 3/3-robust; no feed; latency-robust by
  construction; design sketch verified feasible u84). E006b rank
  2 (overlaps E010 space, needs schema addition). E005b /
  E-completion-selective / E-deep×completion deferred until a
  positive-EL cell exists.
- **Phase:** E008b COMPLETE (LEDGER §E008b judgment filled u86;
  dead region r12s logged; LEADERBOARD dead-regions updated).
  Runs 747–752, 754, 756–760 vs incumbent 728/725, sel-width 6.
  Earlier: E008-lat battery judged u74 (gate SURVIVES latency,
  ~6–13× flatter decay; D-011 payload latency-conditional;
  charter latency mandate discharged for the lever), LS-13
  incident closed u83 (742 corr −0.0787, 714 corr −0.1195,
  determinism reproductions 745/755, no flips), E008 judged u69
  (first reference-beating lever; LS-12; D-010), E006 AXIS-CLOSED
  (LS-11), E005 battery (LS-9), E004 cfree/D-008, EVALUATION v1.1
  frozen. s32 ritual done (08:17Z): DONE absent, worker alive,
  drain watcher up, KB unchanged past A65, queue drained 08:18Z.
  No background work open.
- **Branch:** gabagool-lab (worktree at ~/Sites/polymarket-bot-gabagool-lab)
- **Write scope:** gabagool-lab/ + src/strategies/gabagool-lab/ (hook enforces)

## What exists so far

- **E008b JUDGED (u86, s32): favorite-side axis CLOSED — no arm
  beats g00; Δrem ≈ Δcost everywhere (remainder is never free);
  dead region r12s; backlog re-ranked, E010 next. Runs 747–760.**
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

1. **E010 judgment when drained (LAUNCHED 08:34Z u89, SHA
   6f131eb2, 6 ax8 flows, 17,568 jobs, ETA ~09:13Z; drain watcher
   pid 77344 → logs/watch-drain-s32-e010.log; A/A basis run 761 =
   20/20 exact vs 728, u88):** per run land: uids vs frozen §E010
   block + validators. Readout per frozen criteria (2): arm table
   + e004-decomp vs same-half g00 (728/725) + mean ms/mkt; judge
   advance rule (3) over w5→w10→w20, predictions P1–P3 (5).
   On partial: submit.ts --extend ONLY (LS-13). Advancing cell →
   pre-committed latency battery (criteria 4; same-lat g00 cells
   738/733, 734/735, 736/737).
2. **E010 judgment when drained** (uids + validators + frozen
   rules; advancing cell → pre-committed latency battery vs
   same-lat g00 cells 738/733, 734/735, 736/737).
3. **Fresh-data confirmation path per EVALUATION** (holdout; E32
   winner's-curse defense — sel-width shrinkage). Candidate
   assembly: blocked until a POSITIVE-EL cell exists that survives
   a latency battery (u40 framework). If E010 also fails to
   produce one: assess whether the g00 lat0 bound ≈ 0 constitutes
   ceiling evidence for the L3 verdict path (the residual lat140
   gap may be all execution friction — a proof sketch, not a
   surrender; needs the EVALUATION fresh-data pass either way).

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
