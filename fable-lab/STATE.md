# STATE — Fable Protocol lab

_Last updated: session 9, unit U40._

## Done
- U0-U8 (session 1): system built and verified — engine study
  (`engine/CAPABILITIES.md`), protocol (`protocol/*`), tools (`tools/*`),
  runbook, role contracts. See ROADMAP.md and git history for detail.
- Charter v2.2 (operator): mission is perpetual, local sequential evidence
  runs allowed (background, committed code), protocol changes need motivating
  evidence, never create DONE.
- U9 (session 2): protocol reconciled to charter v2 — DECISIONS D7.
  - `tools/run-backtest.ts`: registry-injection wrapper; strategies now live
    in `fable-lab/strategies/<mechanism>/EXP-NNN.ts` (see strategies/README.md);
    wrapper refuses non-sequential runs. Validated: 2-market smoke with
    injected `fable-fixture-noop`, 100,850 events, batchUid
    EXP-000-wrapper-smoke.
  - `tools/submit.ts`: all stages route through the wrapper + `--sequential`;
    verified command output for smoke/probe/holdout against the fixture spec.
  - Docs updated to local-sequential reality: LIFECYCLE §2-§3, SCIENTIST.md,
    RUNBOOK §0-§3, protocol/README.md loop paragraph, EPISTEMOLOGY §3 compute
    anchor (~1.1s/market measured, no-op strategy, local data).
  - Plumbing re-verified this session: `universe.ts` → 18,635 eligible
    markets (2025-11-30 → 2026-06-14), holdout boundary 1777237200000
    (2026-04-26T21:00Z).

- U10: EXP-001 (expiry certainty discount, `tail-overpricing`) registered:
  spec `protocol/registry/experiments/EXP-001-expiry-certainty-discount.md`
  + strategy `strategies/tail-overpricing/EXP-001.ts` (id `fable-exp-001`).
  Validator passes. Smoke ran green (EXP-001-smoke, 10 markets, 9 entered —
  plumbing only, never evidence). Bug found via smoke and fixed:
  `tools/lib/spec.ts` field() regex truncated wrapped fields (`$` under `m`
  flag) — only 2 of 4 --param pairs reached the command; now uses true
  end-of-input; re-validated positive+negative fixtures.

- U11a (while probe ran): EXP-002 (UP+DOWN dutch-book scan, `sum-mispricing`)
  registered: spec + strategy `strategies/sum-mispricing/EXP-002.ts`
  (id `fable-exp-002`), validator passes. Its smoke exposed two findings:
  - LESSONS E6: recorded books can be SELF-CROSSED (UP bid 0.40 > UP ask
    0.37, btc-updown-15m-1764461700) — apparent dutch books are replay
    artifacts; EXP-002 now guards against crossed books (pre-registration,
    before any decisive run). Guarded smoke: 0 entries in 10 markets.
  - LESSONS E7 / DECISIONS D8: ambient `.env` sets BACKTEST_LATENCY_DELAY=140
    — silently applied to all runs. submit.ts now pins DELAY=0/JITTER=0 on
    every stage (lat stage keeps its own). First EXP-001 probe launch was
    VOID (killed ~365/500, nothing persisted, noted in the experiment file);
    relaunched pinned.
  - `strategies/_fixtures/debug-book.ts` added (diagnostic fixture, places a
    debug pair on first crossed-gap tick; batchUid EXP-000-debug only).

- U11b-d (session 2, verified in git): entry-check.ts prediction tool;
  EXP-003 (post-jump stale ladder) registered with green smoke.

- U12 (session 3): EXP-001 probe JUDGED — **advance**. The relaunched probe
  was killed by session SIGTERM at 379/500 but persisted cleanly (run 301,
  batchUid EXP-001-probe, N=379, 0 failures). Judged at N=379 per D9
  (exogenous truncation ≠ bias). Readout: EV/market=1.94 CI95=[0.71,3.17],
  t=3.08, win rate 0.9697 vs mean entry ask 0.9343 → prediction HELD,
  bias classification clean (taker-only, fees charged). Fresh-context Judge
  verdict appended verbatim to the experiment file. New: LESSONS E8
  (session death kills child runs; check DB before voiding), DECISIONS D9
  (truncated-unbiased samples are judged), D10 (evidence runs launch
  detached via `setsid nohup`).

- U15: submit.ts grid stage passes --random; D11 — grid cells run
  `--random --limit 2000` (sign-smoothness needs no full window).

- U16: EXP-002 probe JUDGED — **kill** (run 308, N=500, ZERO entries: the
  guarded fee-cleared dutch-book condition never fired). LESSONS E9: the
  UP/DOWN pair is internally consistent at top-of-book beyond fees;
  `sum-mispricing` dead as a taker edge. IDEAS #2 → dead (EXP-002); INDEX
  regenerated (status auto-derives "kill"). EXP-004 probe launched detached
  in the freed slot (log `logs/EXP-004-probe.log`).

- U17: EXP-003 probe JUDGED — **kill** (run 309, N=500, 368 entered,
  q=−0.0475 t=−1.06 → kill bar met; win rate 0.5679 = mean ask 0.5679:
  jumps priced exactly fairly). LESSONS E10 (fees need ≥ ~1.5c/share gross
  at mid-range; lowers prior for IDEAS #6 without funding overreaction
  either). IDEAS #3 → dead; INDEX regenerated.

- U18: EXP-005 (first-minute overreaction, `time-structure`) registered:
  spec (with E10-lowered prior note) + strategy
  `strategies/time-structure/EXP-005.ts` (id `fable-exp-005`, late-start
  guard maxFirstTickSec=30 per CAPABILITIES §2), validator passes, smoke
  green (4/10 entered). Probe queued for the next free slot.

- U19: EXP-004 probe JUDGED — **kill** (run 311, N=500, 85 entered,
  prediction CONTRADICTED: win rate 0.2824 < mean ask 0.3193, gross
  EV/share −0.037 pre-fee). LESSONS E11 (resting depth is not flow; the
  ask already prices the book's information). IDEAS #5 → dead; INDEX
  regenerated. EXP-005 probe launched detached in the freed slot
  (log `logs/EXP-005-probe.log`).

- U20: EXP-005 probe JUDGED — **kill** (run 312, N=500, 156 entered,
  prediction CONTRADICTED: win rate 0.3462 < mean ask 0.3583). LESSONS E12:
  with E10/E11 the picture is consistent — directional pricing is efficient
  at taker horizons across the episode clock; the one measured inefficiency
  is the expiry-tail certainty discount (EXP-001). Idea generation should
  target structural counterparties (friction flows), not price patterns.
  IDEAS #6 → dead; INDEX regenerated. 5 of 6 starter ideas resolved:
  EXP-001 advanced, EXP-002/003/004/005 killed, #4 spread-capture parked.

- U21: IDEAS #7 expiry-tail maker capture added (evidence-motivated, parked
  until EXP-001 confirms).
- U22: grid run 315 (cell e600-a095) CRASHED at final persist — quality
  column DECIMAL overflow rolled back all 2000 markets (D12, E13). Wrapper
  now clamps qualitySystem/qualityTrade at the drizzle driver boundary
  (verified: debug run 316 persisted). Cell relaunched on guarded committed
  code. Main/lat predate the guard — accepted risk (D12 note).

- U23: first clamp NEVER FIRED — segment values reach drizzle as STRINGS
  (`toDecimal = String(value)`, backtests.ts:127); runs 318/320 (both 0.95
  cells) lost 2000 markets each to the same overflow. Clamp now handles
  string/number/Infinity (unit-tested against the patched column). Both
  0.95 cells relaunched on committed fixed code (logs `*-retry2.log`).

- U24: EXP-001 grid COMPLETE (8/8 cells persisted; retry2 runs 324/325
  confirm the U23 clamp works). Grid appended verbatim to the experiment
  file. Shape: 6/8 neighbors negative; the whole minAsk=0.95 column is
  uniformly negative — where the mechanism should be strongest. Smoothness
  fail-leaning; awaiting main for the decisive primary read.

- U25: EXP-001 main JUDGED — **kill** (run 301 extended to N=13,977:
  EV=−0.19, t=−1.15, win rate 0.9316 = mean ask 0.9323, prediction
  CONTRADICTED; battery: smoothness FAIL, day stability FAIL, latency flat
  negative, composition clean). The probe's +1.94/t=3.08 was sampling
  noise — only 7 losses in 231 entries; with +3c/−90c payoffs the
  information is in the loss count. LESSONS E14 (incl. protocol transfer
  rule: for win rates >0.9, probe precision = minority-event count ≥ ~30,
  not t). IDEAS #1 → dead; #7 maker-capture dies with it per its own park
  clause. ALL SIX starter mechanisms now resolved: every taker mechanism
  tested is priced fairly net of 156 bps fees. INDEX regenerated.

- U26: EPISTEMOLOGY §3 gained the skewed-payoff probe-precision rule
  (minority-outcome count; DECISIONS D13, motivated by E14).

- U27 (session 4): direction decision — DECISIONS D14: pivot to MAKER-side
  experiments (taker side exhausted per E9-E14; model maker fee is zero;
  `simulator-favored` escalation + tiny-size mitigation + model-conditional-
  kill caveat designed in). EXP-006 (quiet-regime two-sided quoting,
  `spread-capture`, IDEAS #4) registered: spec
  `protocol/registry/experiments/EXP-006-quiet-regime-quoting.md` + strategy
  `strategies/spread-capture/EXP-006.ts` (id `fable-exp-006`, GTC bids δ
  below fair on both sides in quiet windows, hold to settlement), validator
  green, tsc clean. Smoke (run 328) green plumbing but 0 fills → diag-quiet
  fixture (`strategies/_fixtures/diag-quiet.ts`) showed the registered cell
  was structurally fill-less (quiet-at-0.02 ticks are 0-3% and pinned at
  extreme mids; requoting makes fills need single-tick gaps > offset).
  PRE-FREEZE cell amendment (recorded in spec): primary now offset=0.01,
  quietRangeMax=0.08, chosen from engine fill-feasibility runs
  (EXP-000-debug, 30 random markets/cell, FILL COUNTS ONLY — PnL never
  read, so lineage_cells stays 1): (0.02,0.04)→0/30, (0.01,0.04)→1/30,
  (0.01,0.08)→6/30 markets filled.

- U28 (session 5): EXP-006 probe JUDGED — **kill** (run 336, N=500,
  117 played / 62 decisive, EV/market −0.18, t=−1.52 → kill bar met;
  prediction CONTRADICTED: EV per played market ≈ −0.79; design-failure
  clause NOT triggered at ~12.4% decisive markets; classification
  simulator-favored by construction, which sharpens the kill — size axis
  favored the strategy and it still lost). Kill is model-conditional per
  D14: closes the punch-through-backtestable version only. LESSONS E16
  (worst-queue selects maximally informed fills; "noise reverts" maker
  stories are tested as "is a through-move informative?" — it is).
  IDEAS #4 → dead; INDEX regenerated. All 7 ideas now resolved
  (6 killed by experiment, #7 dead by park clause).

- U29: EXP-007 (loud-regime countertrend liquidity provision,
  `spread-capture`, IDEAS #8) registered: D5 dedupe argued in the idea
  entry (vs EXP-003/005 taker-at-ask and EXP-006 quiet two-sided); spec
  `protocol/registry/experiments/EXP-007-loud-regime-countertrend.md` +
  strategy `strategies/spread-capture/EXP-007.ts` (id `fable-exp-007`,
  one-sided GTC bid at fair−δ on the falling side while |trailing 10s
  UP-mid move| ≥ jumpSize, hold to settlement), tsc clean, validator green.
  E15 fill-feasibility measured BEFORE cell freeze (runs 337-340,
  EXP-000-debug, counts only via new `tools/fills.ts` — PnL never
  selected): (0.01,0.10)→12/30 markets 26 fills, (0.02,0.10)→6/30,
  (0.03,0.10)→3/30, (0.02,0.05)→7/30; primary = (0.01, 0.10). Smoke green
  (run 341, 10 markets, 6 maker fills, 0 failures, plumbing only). INDEX
  regenerated. NEW TOOL: `tools/fills.ts` (fill-counts-only reader; makes
  the outcome-mining-safe read the easy one).

- U30 (session 6): EXP-007 probe JUDGED — **kill** (run 342, N=500,
  177 played, 342 maker fills, EV/market −0.45, CI95=[−0.884,−0.0156],
  t=−2.03 → kill bar met with margin; prediction CONTRADICTED: EV/played
  ≈ −1.27, win rate 0.4011; design-failure clause did not bind at 35.4%
  of markets filled; simulator-favored by construction, which sharpens
  the kill). Model-conditional per D14 — closes the punch-through-
  backtestable version only. Fresh-context Judge verdict appended
  verbatim. LESSONS E17: loud punch-throughs are informative like quiet
  ones (E16); the worst-queue-observable edge space is now EXHAUSTED —
  taker fairly priced everywhere tested (E9-E14), maker punch-through
  adversely selected in both regimes (E16-E17). IDEAS #8 → dead; all 8
  ideas resolved. INDEX regenerated (note: verdicts must be appended as
  plain `- decision: kill` lines, NOT blockquoted — the INDEX parser
  ignores `> `-prefixed lines).

- U31: the U29 fork resolved as branch (b) — DECISIONS D15: in-model edge
  space is exhausted (CAPABILITIES §4: only taker-cross and worst-queue
  punch-through triggers exist; both measured, E9-E17). New knowledge
  artifact `knowledge/EDGE-SPACE.md`: the measured map (all 8 ideas),
  what is structurally unmeasurable (at-touch maker economics), the three
  operator-side instrumentation options (expose `touch_or_better` for an
  optimistic in-model bracket; record trade prints for a queue-realistic
  fill model; live paper at touch), and the BINDING registration bar for
  future ideas (taker: ≥1.5c gross argued from data + not a D5 re-skin;
  maker in-model: closed until instrumentation lands; or a cited venue
  regime change). SCIENTIST.md boot sequence now includes EDGE-SPACE.md
  (protocol change motivated by D15).

- U32: E9-E17 evidence chain AUDITED by a fresh-context auditor against
  the DB (report preserved verbatim in
  `knowledge/AUDIT-2026-07-10-E9-E17.md`). Chain sound: every
  DB-queryable number matches (7 decisive readouts, 8-cell grid, latency
  curve, 4 entry-checks, 9 feasibility counts); all kills satisfy their
  own pre-registered bars; INDEX consistent. ONE factual error found and
  corrected: EXP-006 verdict (and E16, and the U28 entry above) misread
  results.ts `(53/62)` as "62 decisive" — it is wins/losses, so 115
  decisive (23% of N, win rate 0.461 on decisive); conservative wrt the
  kill, which stands. Fixes: erratum appended to EXP-006 (verdicts stay
  append-only), E16 corrected inline, results.ts now prints
  `wins/losses=` (DECISIONS D16, verified on run 336). Known
  unverifiables (by construction, all disclosed): EXP-001 probe snapshot
  (run 301 was extended in place), E13 overflow narrative (run 315
  rolled back), E15 fixture-derived tick stats.

- U33: RUNBOOK reconciled to the D15 state (friction: §3 instructed
  "take the top idea, six are seeded" — impossible since U30 resolved all
  eight). §3 now states the gated status; §5 gained the "instrumentation
  unlocks" control point pointing at EDGE-SPACE §3.

- U34: DECISIONS D17 — venue-drift monitor, so EDGE-SPACE §4's "venue
  regime change" reopening rule can actually fire. New:
  `strategies/_fixtures/diag-venue.ts` (no orders, outcome-free
  per-market book stats: rate, crossedFrac, median UP spread/top-depth
  from 10s samples) + `tools/venue-drift.ts` (per-UTC-month aggregation).
  Baseline sweep COMPLETE (7 monthly chunks × 30 random markets, 198
  unique parsed): table recorded in `knowledge/VENUE-DRIFT.md` with the
  pooled 2025-12→2026-04 reference values (spread 0.0100 → band
  [0.005, 0.02]; depth 479.4 → band [239.7, 958.8]; crossedFrac 0.0012 →
  fires ≥ 0.0024) and the refresh procedure. First evaluation: 2026-05
  and 2026-06 are inside all bands — NO drift; E9-E17 conclusions
  in-regime through 2026-06-14. EDGE-SPACE §4 now points at VENUE-DRIFT
  as the required citation instrument for the microstructure-shift
  clause. (Raw log is gitignored; the per-month table is the durable
  record.)

- U35: EDGE-SPACE §3.1 UNLOCKED IN-LAB — DECISIONS D18. The "operator-side"
  classification of the touch_or_better instrument was wrong: the D7
  wrapper already mutates in-process engine state, and `makerFillMode` is
  a writable runtime property. `tools/run-backtest.ts` gained `--fill-mode
  worst_queue|touch_or_better` (default worst_queue; flag stripped before
  the engine parser; prototype hook on `BacktestExecution.onMarketTick`;
  MECHANICAL GUARD: touch mode refuses to start unless --batchUid contains
  "touch"). tsc clean. Verified: guard rejects unlabeled/bogus invocations;
  same 8 fixed exploration markets, EXP-006 primary cell (offset=0.01,
  quietRangeMax=0.08) → run 352 worst_queue: 2/8 markets, 5 maker fills;
  run 353 touch: 8/8 markets, 19 maker fills (counts read via fills.ts,
  no PnL). D18 interpretive rules are binding: touch results support KILL
  or OPERATOR-ESCALATION only — never advance, never live-EV, holdout
  stays locked. EDGE-SPACE §3.1 and §4 updated; maker in-model
  registrations are now OPEN under the touch bracket + D18 rules.
  (Hygiene note: the first smoke used --random and sampled 2 post-boundary
  slugs, both zero-trade so no outcome exposure; the comparison pair used
  pinned exploration-only slugs. Pin slugs or --to-ms for future smokes.)

- U36 (registration + launch): IDEAS #9 (at-touch maker bracket) added;
  EXP-008 (touch bound on the frozen EXP-006 quiet cell, strategy
  fable-exp-006 reused unchanged) and EXP-009 (touch bound on the frozen
  EXP-007 loud cell, fable-exp-007 reused) registered — validator green,
  INDEX regenerated, specs committed BEFORE any run (30dc724). D18 outcome
  set is {kill, escalate, park}; kills would be CONCLUSIVE in-model (bound
  dominance), escalation writes an operator memo; no advance path exists.
  Smokes green (runs 355/356, 10 exploration markets each, 8/10 filled,
  0 failures, hook line present; fill counts only, no PnL read).

- U37: D18 unlock AUDITED by a fresh-context verifier (report verbatim in
  `knowledge/AUDIT-2026-07-10-D18-UNLOCK.md`). Hook/semantics/labeling/
  charter compliance HOLD. Three findings acted on PRE-RESULTS (commit
  1aec35a, while probes ran; no probe statistic read): (1) BLOCKER — the
  pre-registered touch --extend path was unexecutable (engine forbids
  --batchUid with --extend); wrapper now validates the PARENT run's
  batchUid+cmd instead, refusal paths tested. (2) "bound dominance ⇒
  conclusive kill" was an overclaim (inventory-cap path dependence;
  full-size toxic fills); both specs carry a pre-results amendment
  weakening kill wording to "decisive under the most favorable fill
  assumption the engine can express" — bars unchanged. (3) LESSONS E18:
  inclusive --to-ms leaks exactly the boundary market
  (btc-updown-15m-1777237200) into every probe pool since EXP-006;
  verdicts must disclose if drawn; future sample rules use boundary−1.
  Also: phantom-fill tripwire pre-specified, EV(played) defined, D18
  amendment note appended, --fill-mode missing value now hard error.

- U38 (session 8): EXP-008 probe JUDGED — **kill** (run 357, N=500, 392
  played, 1324 maker fills, EV/market −0.433, q=−0.0632 t=−1.41,
  EV(played) −0.552, win rate 0.4209 → both kill branches fire: prediction
  CONTRADICTED and q≤0 with t≤−1). Per audit amendment 4.1 wording: decisive
  against at-touch quiet provision under the most favorable fill assumption
  the engine can express. Notably the optimistic bound loses MORE than the
  worst-queue parent (−0.433 vs −0.18, run 336) — denser toxic fills hurt.
  Pre-verdict checks all pass: D18 hook lines in log, boundary market NOT
  drawn (E18), phantom-fill tripwire clean (top-5 |PnL| fills at plausible
  0.10–0.78 prices). Fresh-context Judge verdict appended verbatim; INDEX
  regenerated (EXP-008 → kill). Bracket for the EXP-006 cell closed at both
  ends: [worst_queue −0.18, touch −0.433], both negative.

- U39 (session 9): EXP-009 probe JUDGED — **kill** (run 358, N=500, 348
  played, 1482 maker fills, EV/market −0.848, CI95=[−1.628,−0.068],
  t=−2.13, EV(played) −1.218, win rate 0.408 → both kill branches fire).
  Pre-verdict checks pass: D18 hook lines (log line 27244 + end summary
  485 instances), boundary market NOT drawn (E18), phantom-fill tripwire
  clean — the known E6 crossed-book market (1764461700) WAS in best5 at
  +29.1, but it is a winner, so phantom fills cannot account for the sign
  of pnlTotal (park branch cannot bind). Fresh-context Judge verdict
  appended verbatim; INDEX regenerated (all 9 experiments → kill).
  Knowledge chain closed: LESSONS E19 (at-touch bracket closed; optimistic
  bound loses MORE in both regimes — quiet [−0.18,−0.433], loud
  [−0.45,−0.848]; audit 4.1 validated empirically), IDEAS #9 → dead,
  EDGE-SPACE §1 table + §2 + §3.1 (RESOLVED) + §4 dedupe rule updated.
  All 9 ideas resolved; no operator escalation warranted.

- U40: E19 chain AUDITED by a fresh-context auditor (report verbatim in
  `knowledge/AUDIT-2026-07-10-E19-CHAIN.md`; DECISIONS D19). Verdict:
  sound-with-errata — every number reproduces from the DB and independent
  recomputation; both kills fire on their own bars; samples clean
  (boundary market provably absent DB-level in all four touch-lineage
  runs). Errata acted on: EXP-008 erratum appended (the U37 amendments'
  "mechanically checkable pre-results" claim fails for EXP-008 by 1m56s —
  honor-system window; kill unaffected), runs.ts timestamp suffix fixed
  (db-local was printed as Z/UTC — root cause of the missed check; timing
  audits must use the run log's UTC stamps), E19 fill-density wording
  corrected (played 1.97×, raw fills 4.3×). Universe re-checked: unchanged
  (18,635 eligible, last market 2026-06-14) — venue-drift refresh still
  gated on ~a month of new data.

- U41: run-backtest.ts prints the effective latency env at startup (D19
  amendment; motivated by the audit's unverifiable-claims list). Verified:
  pinned invocation logs 0/0, ambient logs the .env DELAY=140 (the E7
  trap, now visible in every run log). D8 pinning is log-verifiable for
  all future runs; 357/358 stay honor-system on this point.

- U42: EDGE-SPACE §3.2 falsified-and-corrected (DECISIONS D20) — trade
  prints ARE historically backfillable: Telonex has a `trades` channel
  (sync-design.md, v1 pulls book_snapshot_full only), the synced catalog
  carries per-market trades_from/trades_to, and new read-only
  `tools/trades-coverage.ts` measured 17,878/18,635 eligible markets
  (95.9%) with trades coverage over the whole universe window (quotes
  100%, onchain_fills 91.6%). §3.2 is now the top instrumentation option:
  a queue-realistic historical fill model would replace both bracket ends
  with one measurement, no live activity. Work is operator-side (src/
  changes); the lab's contribution is the measured advocacy.

- U43 (session 10, IN PROGRESS): wake-up checks ran — universe unchanged
  (18,635 eligible, last 2026-06-14; no venue-drift refresh due), no
  trades-channel ingestion (gate 2 closed). CAL-001 registered (DECISIONS
  D21, `knowledge/CALIBRATION.md`): pre-registered calibration-plane study
  — outcome-free fixture `_fixtures/diag-calib.ts` samples UP top-of-book
  at 7 frozen offsets; `tools/calib.ts` joins result_id ONCE and evaluates
  a frozen 63-cell grid (Bonferroni z≥3.377, minority≥30). Discovery =
  8,516 markets < 2026-03-01; probe reserve = 5,460 markets 2026-03-01 →
  boundary−1; holdout untouched. Method frozen in this commit BEFORE the
  discovery run.

## In progress
- U43c: CAL-001 registration AUDITED pre-results by a fresh-context
  verifier (sound-with-findings; verbatim in
  `knowledge/AUDIT-2026-07-10-CAL-001-REG.md`); all 9 findings acted on
  BEFORE any read (CALIBRATION.md Amendments block, D21 amendment). The
  first two discovery launches were KILLED UNANALYZED while restart was
  cheap: v1 (pid 44945, no capture timestamps — audit finding 1 BLOCKER),
  v2 (pid 65334, UP-book only — amendment #10 extended the instrument to
  both books, halving total compute vs a later DOWN study). Both partial
  DB run rows (CAL-001-discovery, CAL-001-discovery-v2) are VOID —
  instrument defects, never result-based. LIVE RUN: batchUid
  CAL-001-discovery-v3, detached pid 73037, log
  `fable-lab/logs/CAL-001-discovery-v3.log`, code ab2acc9 — verified at
  launch: 8,516 files, latency pinned 0/0, asset=UP|DOWN + ts= present.
  Expected ~2h (~0.8s/market measured on v1). Session 11 mid-run integrity
  check (~3 min in): latency line 0/0 present, 8,516 files loaded, both
  UP and DOWN sampled, 206 distinct slugs processed (~0.7s/market → ETA
  ~1.7h); background monitor armed on pid exit. Session 12 check (~4.5 min
  in): 342/8516, ~0.78s/market, ETA ~106 min; UP/DOWN sample lines in
  exact balance (2,407 each); monitor re-armed. Session 12 pre-read code
  check: tools/calib.ts verified line-by-line against the frozen
  CALIBRATION.md spec (all constants, gates, fee formula, drift filter,
  sub-window rule match; no defects) — done BEFORE any outcome read, so
  the one-shot invocation carries no tool-bug risk we could have caught.
  Session 13 check (~8.5 min in): 726/8516, ETA ~92 min; latency line 0/0
  present, UP/DOWN in exact balance (4,497 each), 759 distinct slugs, zero
  error/failure lines in the log. Confirmed calib.ts was mechanically
  smoke-executed at registration (CALIBRATION.md §Disclosure) — no
  untested-tool risk on the one-shot. Monitor re-armed on pid exit.
  Session 14 check (~11.6 min in): 972/8516, ~0.72s/market, ETA ~90 min;
  latency 0/0, UP/DOWN exact balance (5,784 each), 0 error lines. NEW
  outcome-free check: all 12,036 diag-calib lines match the exact
  well-formed pattern (slug/epoch/asset/off/ts/bid/ask) — no malformed
  lines to trip calib.ts parsing. Two more outcome-free confirmations:
  (a) no CAL-001-discovery-v3 run row exists in the DB mid-run — the
  engine persists the row at completion/termination (v1/v2 killed rows
  show partial counts as "completed"), so absence is expected, not a
  defect; (b) calib.ts resolves outcomes by slug via
  telonex_markets.result_id only (never via run rows), so the void
  v1/v2 rows cannot contaminate the one-shot, and its join-direction
  abort gate (cell 850s/[0.98,0.995] must show winRate>0.9) guards a
  flipped join. Monitor re-armed on pid exit.
  Session 15 check (~15.5 min in): 1,361/8,516 (~0.68s/market, ETA
  ~81 min); latency 0/0, UP/DOWN exact balance (8,097 each), 0 error
  lines, all `[diag-calib]`-prefixed sample lines well-formed (the one
  grep miss was the `[backtest] strategy=fable-diag-calib` header). NEW
  outcome-free checks: (a) epoch range in log = [1764460800, 1765782900],
  strictly below the discovery boundary 1772323200 — the --to-ms window
  holds empirically; (b) 34 GiB free disk — no mid-run exhaustion risk.
  Monitor re-armed on pid exit.
  Session 16 check (~18.2 min in): 1,530/8,516 (~0.71s/market, ETA
  ~83 min); latency 0/0, UP/DOWN exact balance (9,097 each), 0 error
  lines, epoch range [1764460800, 1765908000] inside the discovery
  window, 8,516 files loaded, 33 GiB free disk. Monitor re-armed on
  pid exit. NEW outcome-free check (dedupe/over-sampling): zero
  duplicate (slug,asset,off) tuples across all 19,082 sample lines;
  distinct offsets exactly the 7 frozen values (30/150/300/450/600/
  750/850); per-market line count capped at 14 = 7 offsets × 2 assets
  — calib.ts cell counts cannot be double-counted by the instrument.
  CORRECTION (same session): the U43o guess "fewer lines = book absent
  at early offsets" was FALSIFIED by direct measurement — truncation is
  at LATE offsets (per-offset UP coverage at 1,662 complete markets:
  600s→96.6%, 750s→75.4%, 850s→43.0%; capture prompt when present).
  Missing = no uncrossed book event between offset and 900s.
  CALIBRATION.md amendment #11 (pre-read, outcome-free) freezes the
  interpretation: cells are conditional on a book event at-or-after the
  offset, which coincides with in-engine tradability; 750s/850s verdict
  wording must carry coverage fractions and cannot claim venue-level
  (in)efficiency for excluded quiet markets. No gate/threshold changed.
  Session 17 check (~24.8 min in): 2,005/8,516 (~0.74s/market, ETA
  ~80 min); latency 0/0, UP/DOWN exact balance (11,966 each), 0 error
  lines, epoch range [1764460800, 1766358000] inside the discovery
  window, 8,516 files loaded, 34 GiB free disk. NEW outcome-free check
  (price-field sanity, all 24,246 sample lines): 0 crossed (bid≤ask
  everywhere), ts∈[off,900] everywhere; 110 lines carry fine-tick
  prices outside [0.01,0.99] (Polymarket 0.001-tick regime beyond
  0.96/0.04, concentrated at late offsets near certainty — expected,
  not a defect). Verified calib.ts handles them correctly per the
  frozen spec: raw Number() parsing (no 2-decimal rounding), band
  edges frozen at [0.02 … 0.995] with an explicit -1/drop counter
  (calib.ts:58-65,97) — asks >0.995 or <0.02 are excluded by frozen
  design, not silently mis-binned. Monitor re-armed on pid exit.
  Session 18 check (~28 min in): 2,238/8,516 (~0.75s/market, ETA
  ~78 min); latency 0/0, UP/DOWN exact balance (13,224 each), 0 error
  lines, epoch range [1764460800, 1766549700] inside the discovery
  window, 8,516 files loaded, 34 GiB free disk. NEW outcome-free
  checks (26,844 parsed lines): (a) slug epoch = epoch field on every
  line (0 mismatches); (b) book-mirror consistency — 13,421/13,422
  paired (market,offset) samples have DOWN book EXACTLY 1 − UP book
  (bid_DOWN=1−ask_UP, ask_DOWN=1−bid_UP); the single deviant
  (1764846000, off=850, sums 0.95/0.96) prints ts=850.0 for both
  assets — sub-0.1s book-read gap or a dislocated recorded moment
  (E6 precedent); immaterial at 1/13,422. This FALSIFIES amendment #10's premise that the DOWN ask
  "has its own spread" — CALIBRATION.md amendment #12 (pre-read,
  outcome-free) freezes the interpretation: the DOWN grid stays
  non-redundant (buy DOWN at 1−bid_UP = sell UP at the bid — a trade
  no UP cell measures), but cross-side cell hits share the same book
  samples and must NOT be presented as independent confirmations;
  k=126 / z≥3.565 unchanged (conservative under dependence). Monitor
  re-armed on pid exit.
  U43t (session 18, while run in flight): amendments #11/#12 + E9
  addendum AUDITED by a fresh-context verifier (verdict:
  sound-with-findings; report verbatim in
  `knowledge/AUDIT-2026-07-10-CAL-001-AMENDMENTS.md`). Verifier
  independently recomputed the mirror check on the grown log:
  16,352/16,353 exact, SAME single deviant — #12 confirmed; #12's
  economics (buy-DOWN = sell-UP-at-bid) and Bonferroni-under-dependence
  reasoning confirmed correct; no frozen constant/gate changed by
  #11/#12. All 4 findings acted on pre-read: (1) MAJOR — E9 addendum
  rescoped to dataset-level top-of-book measurement, depth-beyond-
  top-of-book re-registration angle restored; (2) amendment #13 freezes
  the mid-run price-field measurement rule (relabeling-invariant
  aggregates only); (3) post-read erratum obligation recorded in #13
  (stale independent-spread premise in frozen decision rule +
  diag-calib.ts header — flag, don't edit mid-run); (4) verdict must
  treat any overlapping-sample cross-side cell pair as non-independent.
  Session 19 check (~40 min in): 3,175/8,516 (~0.76s/market, ETA
  ~67 min); latency 0/0, UP/DOWN exact balance (18,458 each), 0 error
  lines, epoch range [1764460800, 1767405600] inside the discovery
  window, 8,516 files loaded, 34 GiB free disk. Outcome-free mirror
  re-measurement on the grown log: 18,634/18,635 paired (market,offset)
  samples exactly DOWN = 1 − UP; the SAME single deviant
  (1764846000, off=850) — amendment #12 holds at ~40% of the run.
  NEW pre-read join-coverage confirmations (outcome-free): (a)
  eligibility requires a final result_id by construction
  (src/db/telonexMarkets.ts header), so all 8,516 discovery markets
  join; (b) DB DISTINCT check: result_id ∈ {'0','1'} exactly — the
  calib.ts branches (resultId '0'→UP won, '1'→DOWN won) cover the
  full value set; no third state can silently drop markets.
  Monitor re-armed on pid exit.
  WHEN COMPLETE (successor: check pid 73037 gone / log tail): run ONCE
  `npx tsx fable-lab/tools/calib.ts fable-lab/logs/CAL-001-discovery-v3.log`,
  append the FULL output verbatim to knowledge/CALIBRATION.md Results,
  then judge per the frozen rule (k=126, z≥3.565, minority≥30,
  sub-window consistency; candidates → EXP-010 registration with
  lineage_cells=126, probe on the reserved window 2026-03-01→boundary−1;
  null → LESSONS entry closing BOTH taker half-planes within the stated
  power — power caveats in CALIBRATION.md §Power are binding wording).
  The Results erratum MUST flag the stale independent-spread premise
  per amendment #13; verdict wording obligations from amendments #11,
  #12, #13 all bind.

## Next
- Research is gated on the EDGE-SPACE §4 bar (updated in U39): taker needs
  a ≥1.5c gross argument that escapes E9-E14; maker in-model needs a cell/
  gate that escapes E16/E17 (worst-queue) AND E19 (touch); or a cited
  VENUE-DRIFT regime change. Legitimate non-registration work:
  verification depth, keeping EDGE-SPACE §3 current, friction-motivated
  protocol maintenance.
- Successor wake-up checks (run these FIRST, they are the only things that
  change the gated state from outside):
  1. `tools/universe.ts` — if the last eligible market is ≥ ~1 month past
     2026-06-14 (operator ran the Telonex sync), run the VENUE-DRIFT
     refresh procedure on the new month(s); a fired band reopens §4.
  2. `tools/trades-coverage.ts` + `ls data/events/telonex/` — if the
     operator ingested the `trades` channel (D20 advocacy) and a
     trades-aware converter exists, the queue-realistic fill model
     supersedes both D18 bracket ends; that reopens maker measurement
     with a NEW instrument (full pre-registration required).
  3. Otherwise: verification depth or targeted diagnostics only; do not
     re-run answered questions (E9-E19).
- Venue-drift refresh is only worthwhile once the eligible universe has
  grown by ~a month past 2026-06-14 (VENUE-DRIFT refresh procedure §1) —
  do not re-run it before then.
- The D15 conclusion is now audited (U32). Remaining known caveat from
  the audit worth keeping in mind: the maker-side generalization rests
  on two probe cells (N=500 each); EDGE-SPACE §1-§2 wording already
  scopes this correctly.
- Holdout remains locked and unused (no experiment reached it; it stays
  locked under D15 — holdout data buys nothing without a surviving
  mechanism).

## Notes for a fresh session
- Boot per `protocol/sessions/SCIENTIST.md` (charter scope → protocol map →
  registry INDEX + LESSONS → this file).
- Branch `fable-protocol`; write only inside `fable-lab/`; commit + push
  after every unit; evidence runs local `--sequential` in the background via
  `tools/submit.ts`; never create `fable-lab/DONE`.
