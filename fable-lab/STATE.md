# STATE — Fable Protocol lab

_Last updated: session 8, unit U38._

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

## In progress (detached runs via tools/detach.mjs per D10)
- EXP-009 probe (touch mode, second in the U36 chain): still running under
  pid 21693, log `fable-lab/logs/touch-probes.log` (D18 hook line confirmed
  at its start, line 27244). When done: same judging procedure as U38
  (results.ts --batch EXP-009-probe-touch, boundary + tripwire checks,
  fresh-context Judge, append verbatim, INDEX regen). After both verdicts:
  LESSONS entry (E19) for the at-touch bracket, IDEAS #9 resolution,
  EDGE-SPACE §3 update recording the measured brackets.

## Next
- U36: register the touch-bracket experiment — re-run the FROZEN EXP-006
  and EXP-007 primary cells under --fill-mode touch_or_better (new
  experiment file(s); cells inherited frozen from the killed specs, so no
  new tuning freedom; pre-register prediction + kill/escalate bar per
  D18; batchUid EXP-NNN-probe-touch). Probes N=500 exploration-only,
  detached per D10. Outcome is binary by construction: at-touch maker
  economics dead in-model conclusively, or a measured bracket handed to
  the operator (§3.2/§3.3 escalation).
- After U36 resolves: research returns to the EDGE-SPACE §4 bar.
  Legitimate non-registration work: verification depth, keeping
  EDGE-SPACE §3 current, friction-motivated protocol maintenance.
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
