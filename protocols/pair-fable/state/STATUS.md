# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 27, mid-session checkpoint)

## Current work

**Session 27: pair.v17 (signal (b) spot-vs-priceToBeat leader) BUILT,
SMOKED, E-042 FROZEN (pair-v17.md, commit a8b1f98); E-041 partially
read (f0a done = run 1003); waiting on f0b/f1/f2 + a 200-mkt v17
fleet diagnostic.**

Done this session:
- pair.v17.ts implemented: v16.2 with the leader signal replaced by
  binance spot vs priceToBeat (dead zone `spotLeadBps` bps of strike;
  feeds via ExternalFeedsRequestPlugin; absent feeds ⇒ neutral).
  protocol:check PASS. Smoke 1001 (τ160 bps10) PASS 5/5, 0 failures;
  activation check 1002 (τ0, same markets): taker 39 vs 23, invested
  2228 vs 1284 ⇒ feed-driven tilt provably live.
- E-042 grid FROZEN in pair-v17.md §5 BEFORE submission: FULL pairs,
  cells g0 (τ0 neutral FULL reference) / g1 bps10 / g2 bps20 / g3
  bps40 at τ+160, ceil c* fixed by E-041 verdict (NULL/HARMFUL⇒1.00,
  REAL⇒0.90, FINE-MOVE⇒0.95); bars = E-041's B_full; verdicts
  SIGB-BETTER/WORSE/NULL + TILT-EV-REAL/NEGATIVE/NULL.
- Cross-SHA identity for E-042 vs E-041 cells verified: diff
  d204df3..a8b1f98 is additive-only (pair.v17.ts, pair-v17.md,
  STATUS) — no src/, no pair.v16.ts change.
- E-041 f0a = **run 1003**: 10,747 mkts, 0 failures, ev −14.97,
  p/100 −4.04, win 58.5%, median +2.59, trades 111k (29.7k maker /
  81.5k taker), invested $3.98M. Monthly ev −15.2/−16.2/−13.6/−14.8
  (Apr–Jul) — stable; pinned-800 triplet (−12.37) was a mildly
  favorable recent slice, not regime drift.

**IN FLIGHT (do NOT resubmit):**
- E-041 f0b/f1/f2 (batchUids in table below, all 10,747 mkts,
  SHA d204df35): f0b running, f1/f2 queued. ETA ~1h from 20:50Z.
- pf-e042-diag-20260731T204318-bnxhm4: 200-mkt v17 fleet diagnostic
  (τ160 bps10 ceil1.00 doom.99 B500 q100 I160) — purpose: prove
  worker-side feed fulfillment (binance aggTrades local files) before
  the 4×FULL E-042 grid. Queued behind f2.

| # | tiltUnitMax | batchUid | run |
|---|---|---|---|
| f0a | 0.90 | pf-e041-f0a-20260731T202514-4lc2kv | **1003 ✓** |
| f0b | 0.90 | pf-e041-f0b-20260731T202554-njqzov | pending |
| f1 | 1.00 | pf-e041-f1-20260731T202637-hwbk83 | pending |
| f2 | 0.95 | pf-e041-f2-20260731T202727-4oge4h | pending |

## E-041 readout procedure (this session or next; bars pair-v16.md §11)

1. `results.ts --last 5` → runs for f0b/f1/f2 + diag; failures must be 0.
2. Universe identity: pairwise common slug counts = 10747, e.g.
   `sql.ts "SELECT COUNT(*) n FROM backtest_run_markets a JOIN
   backtest_run_markets b ON a.slug=b.slug WHERE a.run_id=1003 AND
   b.run_id=<f0b>"`.
3. Noise: `sql.ts "SELECT COUNT(*) n, AVG(a.pnl-b.pnl) meanD,
   STDDEV_SAMP(a.pnl-b.pnl) sd, SUM(a.pnl>b.pnl) aw, SUM(b.pnl>a.pnl)
   bw FROM backtest_run_markets a JOIN backtest_run_markets b ON
   a.slug=b.slug WHERE a.run_id=1003 AND b.run_id=<f0b>"` →
   SE_pair = sd/√n; B_full = max(0.30, 2×SE_pair, |Δev(f0a,f0b)|).
4. Verdict per §11 (CEIL-REAL/HARMFUL/NULL, FINE-MOVE,
   INSTRUMENT-FAIL if B_full > 0.8). F0 = mean(f0a,f0b) vs f1 (1.00)
   and f2 (0.95).
5. Then E-042: check diag (failures=0 proves worker feeds), set c*
   per verdict, submit 4 FULL cells with the SAME pins — one literal
   command per cell, label pf-e042-g0/g1/g2/g3:
   `tsx protocols/pair-fable/tools/run-backtest.ts --strategy
   pair-fable-v17 --param capPerMarket=500 --param pairTarget=0.96
   --param imbalanceBand=160 --param orderSize=100 --param
   doomUnitMax=0.99 --param cooldownTicks=5 --param ttlSec=90
   --param tiltShares=<0|160> --param spotLeadBps=<10|20|40> --param
   tiltUnitMax=<c*> --to-ms 1785196800000 --label pf-e042-gN
   --detach` (g0: tiltShares=0, spotLeadBps=10; g1/g2/g3:
   tiltShares=160, bps 10/20/40). No --limit ⇒ FULL universe.
   Universe may have grown past 10,747 since the E-041 sync — frozen
   contract says compare on the common intersection and record the
   delta.

## Audit note

M1–M5 implemented and verified at 4809a8e (s26 correction stands).

## Next step (priority order)

1. Read E-041 per procedure above (GREEN either way).
2. Check pf-e042-diag (worker feed fulfillment), then submit E-042
   (4 FULL v17 cells) with c* from the E-041 verdict.
3. Read E-042 (bars pair-v17.md §5) — decides signal (b) vs
   signal (a) AND tilt-vs-neutral absolute ev at FULL.
4. **P-013 (needs human):** sell-side mirror scope ruling (PROPOSALS).
5. Cross-symbol replication: gated on P-012.
6. Unexplored v15 lever: price gate P* — needs the FULL instrument.

## Alignment gate — session 27 (checkpoint; finalized at close)

- **Classification:** directional-controller (v17 = the directional
  controller's signal axis; E-041 = its ceiling axis).
- **Contribution:** new controller variant implemented + smoked
  (a8b1f98, runs 1001/1002); E-042 frozen; E-041 f0a read (run 1003).
- **Time to evidence:** ~2 min (fleet.ts E-041 queue verify), smoke
  running by ~min 8. PASS.
- **Throughput:** 2 smokes + 1 fleet diag submitted + 4 FULL runs in
  flight from s26; f0a (10,747 mkts) evaluated; no serial scans.
- **Scale:** closed by E-036 on record; all runs B=500.
- **Next:** E-041 readout + E-042 submission — GREEN.
- **Verdict:** **GREEN** (provisional at checkpoint).
- Verdict history: s24 GREEN, s25 GREEN, s26 GREEN, s27 GREEN.
  Next audit: s30.

## Blockers

None. E-041 f0b/f1/f2 + diag in flight (~1h); if the session ends
before they finish, next session starts at "E-041 readout procedure".

## Needs human

- **P-013**: sell-side mirror program scope ruling (see PROPOSALS).
- **P-012**: convert eth/sol/xrp 15m telonex datasets — gates
  cross-symbol replication. Not blocking.
- Carried: P-002/P-003/P-005/P-006/P-007/P-009/P-010 (all
  `proposed`). P-009/P-010 remain the binding caveat on every scale
  number (guard-7).

## Standing session guards

- Never end a session waiting on ANY in-flight work — record how to
  resume in STATUS, return `continue` (inbox dad421a6).
- Write .global-runtime/session-result.json BEFORE the final message,
  every session, no exceptions.
- Never `--extend` (P-001). Fresh FULL runs for OOS growth.
- Run `tools/refresh-capabilities.ts` when a rebase pulls engine
  commits (s13–s27: only protocol/harness-contract commits moved
  HEAD).
- Queue submissions require a CLEAN tree pushed to origin/main (push
  via `git push origin HEAD:main`); commit state snapshots before
  submitting.
- **zsh does NOT word-split unquoted variables** — submit grids as
  one LITERAL command per config (inbox c841c329); always keep
  stderr. run-backtest.ts: `--latest` is a BOOL; market count goes
  in `--limit N`. Capture the batchUid line from EVERY submit.
- Verify with fleet.ts after every detached batch; count aggregate
  jobs (waiting-children), not market-job totals.
- Do not push strategy-semantics changes while that strategy's jobs
  are queued/running — workers track origin/main; serialize push →
  submit. (E-041 + diag jobs pinned ≤ a8b1f98: do NOT touch
  pair.v16.ts or pair.v17.ts while queued. E-042 submissions must
  come AFTER any further commits are pushed.)
- Screens baseline 874 (v0) and parents 872/873/879 valid ≤
  2026-08-06 (evaluator.md §Universes). FULL reference v1-b: run
  914. v15 bridge chain 970 ≡ 960 ≡ 956. v16 bridges: c0 = 978,
  d0 = 987. v16 FULL: f0a = 1003.
- **NOISE MODEL (pair-v16.md §10): pinned-800/B500 single-run
  pairwise ev SE ≈ 1.2 (2σ ≈ 2.4); per-market paired sd ≈ 34. ev
  verdicts need FULL pairs (SE ≈ 0.33 expected, E-041 measures it)
  or duplicate-triplet means. p/100 bar 0.54 unchanged for structure
  screens.**
- JOURNAL entries are messages to the human (contract v2): plain
  sentences, tried/happened/means/next, drop run ids/codes unless
  genuinely the point.
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front
  (inbox c841c329), verify queue depth after.
- Class kills need an identity argument (evaluator.md §Kill
  standards); N failures kill a family only. Verdict bars must name
  comparison PAIRS. Positive signals measured ON discovery data need
  disjoint confirmation before any build decision.
- Fill model: calibrated by E-025 (ToB capacity bound). Guard-7
  whole-size fill optimism: larger-q results depth-optimistic
  (E-036).
- Sibling-memory recheck at session start (`ls protocols/*/memory`)
  — 2026-07-31 s27: only pair-fable has memory (unchanged).
- Smoke cannot catch latency-race bugs AND cannot demonstrate RARE
  fill modes (escalate to a 200-mkt Stage B instead).
- Schema refines AND engine constraints (OrderManager validation)
  can invalidate a frozen grid corner — check every cell when
  freezing (GTD expiry < now+60s rejected; ttlSec ≥ 61).
- A completed run with 0 trades and noActivity=N can mean every
  order was REJECTED — check OrderManager validation before blaming
  data.
- The backtest sim is NOT bit-deterministic (latency jitter) — and
  jitter noise at B=500 is heavy-tailed at run level (s26).
- leadPersistTicks is in TICKS (~138/s on active markets);
  1400 ≈ 10 s. At leadGap 0.10 leaders are already ≥10 s persistent
  (E-040 structural).
- Feed-declaring strategies: RULES guarantees full coverage from the
  universe floor (binance from 2025-11-29, priceToBeat from
  2026-02-18); missing worker-side day files are a HARD per-job
  error, not silent neutrality — the pf-e042-diag batch is the
  worker-side proof.

## Inbox processed through

2026-07-31T16:46:43.750Z-82e89da5 (no newer entries at s27 start).
