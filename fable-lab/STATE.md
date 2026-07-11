# STATE — Fable Protocol lab

_Last updated: session 49, unit U58c (fleet unblocked + verified both
ways: gates exercised end-to-end, runs 421-423 clean)._

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

- U43 COMPLETE (sessions 10-41): CAL-001 discovery ran end-to-end and was
  JUDGED — **NULL, null-confirmed by fresh-context Judge**. Run
  CAL-001-discovery-v3 (pid 73037, code ab2acc9) finished clean:
  8,516/8,516 markets, 174m21s, 952,211,001 book events, 0 errors. Final
  D23 integrity battery green (104,776 sample lines, UP/DOWN 52,388 each,
  0 malformed/dup/one-sided/ts violations; TWO mirror deviants — the
  known 1764846000/850 plus NEW 1771651800/300, disclosed, 2/52,388
  immaterial). Coverage (frozen script, final log): 600s→0.9766,
  750s→0.8746, 850s→0.5993, denominator 8,133 slugs (383 markets emitted
  no line). One-shot calib.ts read: ZERO candidate cells, ZERO neg-flag
  cells across all 126 (bar z≥3.565); gates passed (join-direction
  0.9854/0.9778; E14 controls z=−1.02/−0.59); extremes z=−3.26/−3.02,
  both negative. All verdict-wording obligations discharged per the
  checklist (amendment #14 erratum + second-deviant disclosure +
  decision-rule stale-premise flag + #11 conditional coverage wording +
  #12/#13 non-independence). Full output + Judge verdict verbatim in
  knowledge/CALIBRATION.md Results. Consequences: no EXP-010; probe
  reserve (5,460 markets) unspent; LESSONS E20 (both taker half-planes
  on-diagonal across the fixed-time plane within stated power; future
  taker registrations must escape the plane scan per EDGE-SPACE §4);
  EDGE-SPACE §1 map row + taker summary + §4 taker bar updated.

- U43bb (session 41): E20 knowledge propagation AUDITED by a
  fresh-context verifier (sound-with-findings; report verbatim in
  `knowledge/AUDIT-2026-07-10-E20-PROPAGATION.md`). Every number in
  E20/EDGE-SPACE/STATE traces to CALIBRATION.md Results. All 5 findings
  acted on: (1) MAJOR — the tightened taker bar over-claimed ("i.e.
  conditional/path only"), silently foreclosing the power-based escape
  the frozen method preserves (a fixed-time mid-range edge in
  ~1.5c–3.8c is NOT excluded by the null); EDGE-SPACE §4 + STATE.md +
  E20(b) now carry the power-scoped wording; (2) EDGE-SPACE "15×" fixed
  to "candidate bar ≈1.3c is ~16× the local fee" with the 600/750/850s
  restriction restored (early-window tail cells are unmeasured, not
  clean); (3) E20 transfer (b) got its in-place power qualifier;
  (4) offsets restriction (same edit); (5) judge-verdict "4,372"
  transcription typo flagged by adjacent italic note in CALIBRATION.md
  (verbatim text untouched).

- U43bc-bf (session 41): CAL-002 registered, audited, read, and JUDGED —
  **NULL for candidates, null-confirmed by fresh-context Judge.** The
  conditional-plane study (D24, `knowledge/CALIBRATION-2.md`): k=60 cells
  (6 adjacent offset pairs × 5 tick-derived move buckets × both sides) on
  the EXISTING CAL-001 discovery log (zero new replay compute), frozen
  pre-read with a BINDING reserve-confirmation rule for any candidate
  (designer had seen the CAL-001 marginals — disclosed). Tool
  `tools/calib2.ts` + synthetic selftest (17/17 assertions, hand-computed
  candidate/neg-flag/gates/filters); pre-read audit
  (`knowledge/AUDIT-2026-07-10-CAL-002-REG.md`, sound-with-findings) — all
  6 findings fixed pre-read, incl. MAJOR: reserve-read semantics frozen
  (--expect-totals mode + discovery-path refusal; no post-table tool edit
  ever needed). One-shot read: ZERO candidates (max positive z=+1.75);
  ONE fully-powered NEG-FLAG UP (600-750, dn2) z=−3.72 n=2,708 (pair
  coverage 0.766; 750-850 pair 0.464) — after a
  ≥2c down-move late in the window the UP ask is stale-high ≈2-2.4c gross
  (continuation, coherent across pairs from 300s on: −2.23/−3.00/−3.72/
  −2.90), but the tradable mirror (buy DOWN, same samples) nets ≤+0.75c
  (z≤+1.75): continuation is real gross and inside spread+fee net. Gates
  all passed; reserve NOT spent; sub-windows never reached. Judge verdict
  verbatim in CALIBRATION-2.md (+ erratum accepting 2 minor reservations).
  LESSONS E21; EDGE-SPACE map row + §4 taker bar updated (conditional
  arguments must now go beyond single-segment move sign/size).

- U43bg (session 41): E21 knowledge propagation AUDITED by a
  fresh-context verifier (sound-with-findings; report verbatim in
  `knowledge/AUDIT-2026-07-10-E21-PROPAGATION.md`). All 7 findings acted
  on: (1) MAJOR — the binding coverage-conditioning caveat was dropped
  from all three derived artifacts; E21/EDGE-SPACE/STATE now carry the
  pair fractions (0.766 / 0.464) in-place; (2) MAJOR — the STATE "Next"
  bullet over-tightened with "i.e." again (the exact E20-audit defect
  class); now "e.g. multi-segment paths, flow/derived features, or
  sub-power windows"; (3-7) MINOR — "e.g." added to the EDGE-SPACE §4
  parenthetical, "no net-positive cell" corrected to "no cell clearing
  the candidate bar", "(2-4 min)" fixed to ~1.7-2.5 min, in-place power
  scoping added to E21 transfer (a), the EXP-006 link hedged to an
  explicit hypothesis, and the maker-side closure wording scoped to
  E16-E19 with the touch-escape path preserved.

- U43bh (session 41): DECISIONS D25 — propagation audits are now a
  mandatory verdict-session step (SCIENTIST.md rule added). Evidence: the
  E20 and E21 propagation audits both found MAJOR same-class defects
  (silently over-tightened bars, dropped binding caveats) that the
  pre-propagation Judge cannot catch by construction.

- U44 (session 42): wake-up checks ran (universe unchanged at 18,635
  eligible / last 2026-06-14; no trades ingestion — both gates closed).
  CAL-003 registered, audited, read, and JUDGED — **null-confirmed by
  fresh-context Judge** (`knowledge/CALIBRATION-3.md`, D26). Two-segment
  path scan on the existing CAL-001 discovery log (zero new replay
  compute, third log reuse with BINDING reserve confirmation): k=40
  (5 triples × 4 big-move shapes × 2 sides), bar z≥3.26 after the
  pre-read audit raised it from 3.25 (anti-conservative;
  `knowledge/AUDIT-2026-07-10-CAL-003-REG.md`, 5 findings all applied
  pre-read). One-shot: ZERO candidates (max +2.40); one fully-powered
  NEG-FLAG UP (450-600-750, up-dn) z=−3.47 n=981 — a big down-move
  REVERSING a prior big up-move leaves the UP ask ≈4.4c stale gross
  (≈1.8× E21's unconditional figure), but the tradable mirror nets
  +2.38c at z=+2.40, below the bar (needs ≈4.1c gross, observed +3.01c)
  — NOT citable, reserve unspent. A-priori dn-dn persistence hypothesis
  NOT supported (+0.39c/+0.59c, z≤+0.85): persistence does not
  concentrate continuation. Triple coverage 0.766/0.464 at late triples
  (binding conditioning). NEW mechanical gate-reproduction check matched
  CAL-002's published gate values 8/8. LESSONS E22; EDGE-SPACE map row +
  conditional-layers summary bullet + §4 taker bar updated.

- U44b (session 42): E22 knowledge propagation AUDITED per D25
  (fresh-context, sound-with-findings; report verbatim in
  `knowledge/AUDIT-2026-07-10-E22-PROPAGATION.md`). All 6 findings
  applied: (1) MAJOR — the "(this scan)" scoping was dropped from the
  EDGE-SPACE §4 bar, silently foreclosing mid-involved two-segment
  shapes CAL-003 never scanned (the exact E20/E21 defect class, caught
  a THIRD time); the bar now reads "big-move sign paths … (this scan —
  mid-involved shapes excluded and formally open)"; (2) §1 header
  scoped to "big-move sign paths" + E22 gains the openness sentence;
  (3) §1 bullet's E21 range re-scoped "from 300s on"; (4) the E21
  LESSONS entry's "2-2.4c" corrected in-place to "1.5-2.4c (2-2.4c at
  the late pairs)" per CAL-003 amendment #3; (5) E22 headline scoped to
  the up-then-dn shape (dn-up shows nothing); (6) cross-side
  non-independence qualifier added where §1 quotes both mirrors.

- U44c (session 42): IDEAS #10 registered as PARKED — the E22 reversal
  mirror with its power arithmetic recorded (reserve yields n ≈ 660,
  ~23% power at α=0.023 at the winner's-curse-biased +2.38c; 80% power
  needs ≈ 28,000 markets ≈ 5× the reserve; no instrument fixes it —
  one independent outcome per market per cell) and a MECHANICAL unlock
  condition (≥ ~15,000 markets in a pre-registrable fresh window +
  venue-drift bands quiet + full pre-registration citing the entry).
  This prevents a successor from burning ~100 min of replay on a
  coin-flip test or spending the reserve's pristine status.
  _(Figures amended in U45 — see below; the park stands.)_

- U45 (session 43): wake-up checks ran — universe unchanged (18,635
  eligible, first 2025-11-30, last 2026-06-14; boundary 1777237200000
  re-verified), trades coverage unchanged (17,878/18,635; only delta /
  delta-typed converters on disk — both gates closed). IDEAS #10 power
  arithmetic AUDITED by a fresh-context verifier (sound-with-findings;
  report verbatim in `knowledge/AUDIT-2026-07-10-IDEAS-10-POWER.md`).
  MAJOR finding: the U44c entry mixed two variance conventions — its
  23%/28k figures used Bernoulli-at-meanAsk while the 15k unlock
  threshold holds ONLY under the scan's own se convention (per-sample
  variance ≈ 0.154, the statistically correct null). PARK licensed
  under both conventions (power ≤ ~33% at the winner's-curse-inflated
  +2.38c); entry restated consistently under the scan-se convention
  with the 95.5% emitting fraction: reserve yield n ≈ 630, se ≈ 1.56c,
  ~32% power at α=0.023, 80% power ≈ 19,000 markets (~3.5× reserve, not
  28k/5×); 15,000-market unlock CONFIRMED (~55% power at true +2c) and
  now names its binding convention. Also from the audit: the session's
  proposed "nothing in 1.5-2.4c is reserve-confirmable" generalization
  was FALSE unconditionally (high-incidence ≳50% or extreme-price cells
  confirm down to ~1.5-1.9c); the correctly SCOPED envelope (mid-priced,
  incidence ≲15-20% → ≥~2.4-3.4c needed) is now in EDGE-SPACE §4 with
  the open side stated — it covers all currently open conditional
  structure, so no fourth discovery-log scan targeting that band can
  produce a citable result until the universe grows. (Motivating
  friction: this session nearly designed such a CAL-004 before the
  power arithmetic stopped it; CAL-003's mid-involved shapes resolve
  only |d| ≈ 8-10c at their n ≈ 250/cell — power-futile.)

- U46 (session 43): VENUE-DRIFT instrument AUDITED by a fresh-context
  verifier (sound-with-findings; report verbatim in
  `knowledge/AUDIT-2026-07-10-VENUE-DRIFT.md`) — it is the sole
  instrument behind EDGE-SPACE §4's regime-change clause and was never
  audited. Three MAJORs, all acted on: (1)+(2) quantified false-fire
  exposure (crossedFrac trigger only ~14% above baseline month 2025-12's
  own value; depth band ~1.5-1.9σ of baseline monthly dispersion,
  ≈10%/month false-fire on depth alone) → DECISIONS D27: any fire needs
  an independent confirmation redraw on the same month (both draws must
  fire on the same metric; crossedFrac fires also need a ≤2-market
  concentration check), adopted BEFORE any refresh was ever evaluated —
  bands themselves unchanged per D17 pre-specification; (3) pooled
  reference not reproducible with the tool → convention settled
  EMPIRICALLY from the surviving baseline log (pooled = statistic over
  all 142 per-market values; all four published values reproduce
  exactly) and `tools/venue-drift.ts` gained a verified `--pooled
  YYYY-MM:YYYY-MM` mode (tsc clean). Also corrected from the log: the
  documented "end-of-chunk flush" artifact NEVER fired — the real loss
  mode is zero-event parquets (12 markets: Dec 2, Jan 6, Jun 4, each
  ~0s replay); plus MINOR wording/procedure fixes (UP-crossed sampling
  scope, depth consequence mapping, upward-only crossedFrac, unseeded
  RAND() disclosure, log-capture step, re-baselining step). EDGE-SPACE
  §4 regime clause now requires the D27-confirmed fire.

- U46b (session 43): U45+U46 application fidelity VERIFIED by a
  fresh-context propagation checker (sound-with-findings; report
  verbatim in `knowledge/AUDIT-2026-07-10-U45-U46-PROPAGATION.md`).
  Every restated figure recomputes under the stated conventions; the
  --pooled spot-check reproduced independently; no silent bar
  tightening, no dropped binding caveat. ONE MINOR fixed in the same
  unit: VENUE-DRIFT.md's baseline block still attributed the 12 missing
  markets to the disproven end-of-chunk flush artifact — now reworded
  to the corrected zero-event-parquet mechanism.

- U47 (session 44): wake-up checks ran — universe unchanged (18,635
  eligible, last 2026-06-14), no trades ingestion (only delta/delta-typed
  converters on disk) — both gates closed. Verification-depth unit:
  `tools/calib.ts` — the CAL-001 instrument behind the E20 null that
  tightened the EDGE-SPACE §4 bar — had NEVER executed its CANDIDATE /
  demotion / NEG-FLAG branches (the real read was all-null; a branch bug
  would be observationally identical to the published null), while
  calib2/calib3 got selftests at registration. Closed per DECISIONS D28:
  calib.ts gained the guarded `--outcomes` synthetic path (calib2
  precedent), proven inert by byte-identical output on the real discovery
  log before vs after (diff clean; the re-run also reproduced the
  published CAL-001 read: gates 0.9854/0.9778, E14 controls
  z=−1.02/−0.59, zero candidates/neg-flags — a same-day consistency
  check, same DB state; "months-later" wording corrected in U47b). NEW
  `tools/calib-selftest.ts` with hand-computed assertions (candidate,
  demotion, both neg-flag kinds, drift/dedupe/band filters, 4 bucket
  edges, unresolved exclusion, gates, gate-abort exit-2 paths, refusal
  guard). tsc clean. CALIBRATION.md carries the post-verdict instrument
  note; tools/README.md lists the calib family.

- U47b (session 44): U47 AUDITED by a fresh-context verifier
  (sound-with-findings; report verbatim in
  `knowledge/AUDIT-2026-07-10-CALIB-SELFTEST.md`). Freeze discipline,
  inertness (auditor re-ran calib.ts on the real log: byte-identical),
  and all selftest math independently confirmed. Findings applied:
  (MAJOR) the "months-later reproduction" claim was false (discovery
  verdict was ~3h50m earlier, same day/DB) — corrected in D28,
  CALIBRATION.md note, and the U47 entry above; (MINOR) summary
  assertions anchored as whole lines (double-listing bug previously
  passable), empty-sub-window demotion block (W3 n=0 → d=na) and
  join-gate n<30 arm added → selftest now 24/24; net>0 clause and
  ≥Mar-2026 epoch dropout recorded as accepted fixture-uncovered
  residue (D28 amendment); guard substring-bypass accepted as
  honor-system-consistent (finding 4).

- U47c (session 44): audit finding 2 TRANSFERRED to the sibling
  selftests it was inherited from — `calib2-selftest.ts` and
  `calib3-selftest.ts` candidate/neg-flag/reserve-mode summary
  assertions are now anchored whole lines (^…$/m), closing the same
  double-listing blind spot there. Both selftests re-run green
  (calib2 16 PASS + guards, calib3 green, no FAILs), tsc clean.
  Recorded as a U47c note in the D28 amendment.

- U48 (session 45): wake-up checks ran — universe unchanged (18,635
  eligible, last 2026-06-14, boundary re-verified), trades coverage
  unchanged (17,878/18,635; only delta/delta-typed converters on disk) —
  both gates closed. Durability unit (DECISIONS D29): the venue-drift
  baseline's 198 per-market `[diag-venue]` lines existed ONLY in the
  gitignored `logs/venue-drift-baseline.log` — VENUE-DRIFT.md's monthly
  table cannot recompute the pooled band references (the exact U46
  audit-finding-3 near-miss; the audit succeeded only because the log
  survived). Lines now committed at
  `knowledge/venue-drift-baseline-lines.log` in the native parseable
  format; verified byte-identical tool output (monthly + --pooled) vs
  the original log, reproducing the published pooled reference
  (142 / 0.0100 / 479.4 / 130.32 / 0.0012). VENUE-DRIFT.md points at the
  committed file. Accepted residue recorded in D29: the ~17 MB CAL-001
  discovery log stays gitignored (closed nulls, committed verdicts;
  nothing open depends on re-reading it).

- U48b (session 45): D29 lens COMPLETED by a mechanical sweep of all
  committed knowledge for gitignored `logs/` references — exactly three
  files cited anywhere: venue-drift baseline (fixed, U48), CAL-001
  discovery log (residue, D29), and `logs/touch-probes.log` (EXP-008/009)
  now classified residue in a D29 amendment: its log-only facts (hook
  lines, UTC stamps behind the U40 erratum, tripwire blocks) were
  verified by two audits and recorded verbatim; no future computation
  takes it as input. The amendment states the distinguishing test for
  future sessions: commit an extract when a future computation needs the
  data as INPUT; residue-classify when the log only evidences an
  already-adjudicated, verbatim-recorded fact.

- U49 (session 46): wake-up checks ran — universe unchanged (18,635
  eligible, first 2025-11-30, last 2026-06-14, holdout boundary
  1777237200000 re-verified), trades coverage unchanged (17,878/18,635;
  only delta/delta-typed converters on disk) — both gates closed.
  Friction unit (DECISIONS D30): RUNBOOK — the operator's interface —
  was stale in three checkable ways: §3 status frozen at U31 (8 ideas vs
  the current 9 experiments + 3 CAL scans, 10 ideas resolved), §5 still
  told the operator touch_or_better needs a src-side change (falsified
  U35/D18, moot since E19) and framed trade prints as live recording
  (corrected U42/D20: historically backfillable, 95.9% coverage), and
  the two wake-up gates — the only external actions that reopen gated
  research — were absent from the control-points section. RUNBOOK §3/§5
  reconciled: new "Growing the dataset (Telonex sync)" control point
  (payoffs: ~1 month → venue-drift refresh + D27-gated reopening;
  ~15,000-market fresh window → IDEAS #10 adequately powered — unlock
  further needs drift-quiet bands + full pre-registration),
  instrumentation bullet rewritten to the current EDGE-SPACE §3 state.
  No bars or interpretive rules changed — documentation reconciliation
  only (U33 precedent).

- U49b (session 46): U49 VERIFIED by a fresh-context checker
  (sound-with-findings; the restating-work defect class D25 warns about
  appeared again). All four findings applied to RUNBOOK + D30 amendment:
  (MAJOR) "~15,000 NEW markets (~5 months)" over-tightened the IDEAS #10
  threshold — the window total counts the pristine 5,460-market reserve,
  so ~9,500 new markets ≈ 3.3 months at ~96/day; (MINOR) the "→ unlock"
  shorthand now names the drift-quiet + full-pre-registration
  conditions; (MINOR) pipeline-convention provenance corrected to
  U42/D20 (not U43); (MINOR) D27 consequence re-scoped to "can reopen
  the specific mechanism-linked question". Verifier confirmed all other
  counts, figures, and direction-of-claim fidelity clean, and that no
  bar/threshold/rule changed in any source artifact.

- U49c (session 46): DECISIONS D31 — the D25 propagation-audit rule is
  generalized: ANY unit restating a bar, threshold, unlock condition, or
  measured figure into a derived artifact gets a fresh-context check
  before it closes (verbatim quotes exempt). Evidence: four consecutive
  restating units carried the defect class (E20/E21/E22 propagations +
  U49, a non-verdict unit D25 did not cover, caught only by discretion).
  SCIENTIST.md rule extended in place.

- U50 (session 47): wake-up checks ran — universe unchanged (18,635
  eligible, last 2026-06-14, boundary re-verified), trades coverage
  unchanged (17,878/18,635; only delta/delta-typed converters on disk) —
  both gates closed. Verification-depth unit (DECISIONS D32): the
  standing STATE claim "Holdout remains locked and unused" had never
  been checked globally — new `tools/holdout-lock-audit.ts` (read-only,
  no outcome columns; flagged rows print fill counts only) swept all 65
  lab runs (ids 295–364) for post-boundary rows. Result: 67 rows, all
  classified in `knowledge/HOLDOUT-LOCK-AUDIT-2026-07-10.md` — 3 =
  boundary market btc-updown-15m-1777237200 DETERMINISTICALLY included
  in the EXP-001 full-window lineage (E18's leak class, but certain, not
  a pool chance; in run 301 main it ENTERED with 1 taker fill — the only
  outcome-bearing holdout contamination in the persisted backtest
  tables; verdict-immaterial by an outcome-free bound: shares=100 ⇒
  |PnL| ≤ 100 ⇒ EV shift ≤ 0.007 on the −0.19 kill readout — E18
  amendment + EXP-001 erratum appended); 2 = run 351 zero-trade smoke
  slugs (already disclosed, U35 hygiene note); 2 = post-boundary April
  markets inside the venue-drift pooled baseline (book-only; VENUE-DRIFT
  label note); 60 = by-design 2026-05/06 drift-evaluation months
  (outcome-free fixture). The 8 grid cells provably never drew the
  boundary market (was luck, now verified). Fresh-context verification
  per D31: sound-with-findings (byte-identical reproduction, all
  restated figures trace); all 4 findings applied — run-295
  discriminator gap fixed (batchUid arm added to the tool; run 295 is
  CLEAN), gap-count scope corrected, unparseable failure slugs now
  flagged not skipped, scope qualifier added (sweep covers persisted
  backtest tables only). Standing procedure: re-run the tool after any
  future evidence run; exit 2 ⇒ classify new rows against the artifact.

- U51 (session 47): tools/README.md index completed — 9 existing tools
  were unlisted (runs, fills, entry-check, venue-drift, trades-coverage,
  run-backtest, detach, calib-coverage.sh, calib-integrity.sh; friction:
  this session recovered the fills.ts outcome-safety precedent from
  STATE history because the index was incomplete). Descriptions quoted
  from each tool's own header read in-session; behavioral claims
  grep-verified; wake-up-gate roles annotated.

- U52 (session 47): E18's transfer rule (a) was recorded in LESSONS but
  NEVER patched into `tools/submit.ts` — all four exploration-bounded
  stages (probe/main/lat/grid) still emitted the inclusive
  `--to-ms <boundary>`, so any future probe would have re-leaked the
  boundary market into its pool — and any future MAIN extension would
  have included it deterministically, U50's exact finding (U50's sweep
  is what surfaced the builder gap). Fixed to boundary − 1; verified by
  printing the stage commands against the frozen EXP-001 spec
  (exploration stages → 1777237199999; holdout stage unchanged and
  correct: inclusive --from-ms 1777237200000 --to-ms holdoutEndMs,
  --from-ms verified gte/inclusive at the engine). D31 fresh-context
  check: sound-with-findings; all 4 applied — the stale inclusive rule
  lived in TWO more carriers (protocol/templates/EXPERIMENT.md sample
  rule, LIFECYCLE.md §probe; both now boundary − 1), smoke was unbounded
  (safe only by ASC-default ordering — run 351's leak class; smoke now
  bounded to boundary − 1 when the spec has a boundary, verified
  printed), and the main-stage severity understatement fixed in this
  entry. Also exercised the
  NEVER-executed holdout refusal branch (D28 class) with a
  deliberately-failing scratch spec in gitignored logs/: validator FAIL
  → "REFUSED … holdout not submitted", exit 1, nothing launched — first
  execution of the last mechanical guard on the one-shot resource.
  Accepted residue: the validator's holdout-discipline COUNT branch (at
  most one <EXP>-holdout run) still has never executed against a
  positive case — it requires a real holdout run row; verify it before
  any first real holdout submission. E18 second amendment records the
  meta-lesson: a rule constraining future commands must be patched into
  the tool that builds the commands, in the same unit.

- U53 (session 48): wake-up checks ran — universe unchanged (18,635
  eligible, last 2026-06-14), trades coverage unchanged (17,878/18,635;
  only delta/delta-typed converters on disk) — both gates closed. Fleet
  reconciliation unit (DECISIONS D33): the operator's charter-3 fleet
  mandate (2026-07-09/11 updates) is mechanically BLOCKED — the engine
  registry auto-discovers only `src/strategies/**`
  (strategyRegistry.ts:24), the worker path
  (backtestWorkerChild → marketProcessor → runSingleMarket:116) loads
  nothing from `fable-lab/strategies/**`, the pre-commit hook forbids
  committing strategies anywhere workers would see them, and the bare
  engine CLI (the exact worker resolution path) rejects `fable-exp-001`
  with `unknown strategy id` at parse time (reproduced locally, no DB
  write). Operator memo `knowledge/FLEET-GAP.md`: evidence, minimal
  patch options (preferred: registry also walks fable-lab/strategies/
  when present), what already works (D8 latency pinning ships in job
  data from the SUBMITTER's env — backtest.ts:557-558; jitter defaults
  to 20 when unset, so the explicit JITTER=0 pin is load-bearing), and the
  pre-committed reconciliation plan (submit.ts evidence stages →
  bare-CLI --detach; capacity tool; fleet D8 re-verify; holdout-lock
  sweep after first fleet run). Stale D7 comment in submit.ts corrected;
  RUNBOOK §1 reconciled + §5 gained the unblocking control point.
  Capacity tool deferred with the same trigger (no consumer until
  submissions are possible). D31 fresh-context check: sound-with-findings,
  4 MINOR, all applied — two line-citation fixes (strategyArgs.ts :42→:57/:74;
  :757 is the sequential path, not job data), STATE's :557→:557-558, and a
  dropped caveat on patch option 1 (a malformed/duplicate lab strategy
  would crash every engine process at import on that clone, live bots
  included — added to the memo and RUNBOOK). Verifier independently
  re-ran the reproduction, the gate-3 probe (GAP), and the submit.ts
  probe print; core claim confirmed end-to-end.

- U54 (session 48): the D33 memo's preferred patch AUTHORED and VERIFIED —
  `knowledge/fleet-gap-registry.patch` (registry additionally walks
  `fable-lab/strategies/` when present; applies clean per
  `git apply --check`). Verified in a throwaway /tmp clone with the patch
  applied (deleted after): gate-3 probe RESOLVED, `tsc --noEmit` clean,
  wrapper skips its own injection. Found + fixed in the same unit: the
  wrapper's duplicate-id guard would have crashed EVERY local run the
  moment the operator applied the patch — `run-backtest.ts` injection is
  now idempotent via module-cache reference identity
  (`strategyRegistry[def.id] === def` ⇒ preloaded same file ⇒ skip;
  same-id-different-object still throws). Unpatched behavior unchanged
  (main repo prints "injected 12", tsc clean). RUNBOOK §5 control point
  now hands the operator the apply procedure. D33 amendment appended.
  D31 fresh-context check: sound-with-findings — the verifier
  independently re-created the patched clone (RESOLVED / idempotent-skip
  / tsc clean all reproduced), proved the module-cache identity argument
  (incl. planting a real same-id collision, which threw as designed),
  and cleared symlink/case/EXT split scenarios. 1 MAJOR applied: the
  RUNBOOK's operator instruction was UNEXECUTABLE as written — the lab's
  own pre-commit hook blocks committing the patched src/ file (verifier
  hit `[guard] BLOCKED` empirically); RUNBOOK/patch header/D33 note now
  instruct a one-time `git commit --no-verify`. 3 MINOR applied: the 5
  order-free `_fixtures/` diagnostics becoming live-bot-selectable is
  now disclosed, the tsx-runtime-only scope of the unlock is stated
  (compiled-.js engines silently discover zero lab strategies), and
  "tsc clean" is scoped to src/** (the wrapper change is verified by
  execution, not tsc).

- U55 (session 48): U52's accepted residue closed (D28 amendment) —
  `validate-experiment.ts`'s holdout-discipline branch, the last
  mechanical guard on the one-shot holdout, had never executed against
  rows in either direction. New guarded `--selftest-holdout-rows` path
  (loud NOT-a-real-validation banner; unreachable from submit.ts's real
  holdout gate). Verified this session: flagless path byte-identical on
  EXP-001/EXP-006 pre/post; 0 rows → OK; exactly 1 row → OK (the first
  legitimate holdout run is not falsely blocked); 2 rows → FAIL exit 1
  listing ids; malformed JSON → hard error exit 1; drizzle like()
  mechanics validated read-only against the real DB (EXP-001-probe% →
  run 301). Residue: the exact `-holdout` suffix still has never matched
  a real DB row (none exists); trivial by inspection. tsc clean. The
  U52 pre-holdout verification obligation is now discharged — before a
  first real holdout submission, only the standing validator+submit
  refusal checks remain.

- U57 (session 49): CAL-004 registered, audited, read, and JUDGED —
  **NULL, null-confirmed by fresh-context Judge**
  (`knowledge/CALIBRATION-4.md`, DECISIONS D34). The CAL-001 fixed-time
  plane decomposed by spread state (T ≤ 0.0105 < W; k=252, bar z ≥ 3.75,
  minority ≥ 30, binding reserve confirmation with a MECHANICAL
  proceed/park criterion frozen pre-read): fourth reuse of the discovery
  log, zero new replay compute. Motivation: the tight state covers
  82-92% of samples on the measured MARGINALS (joint cells vary, down to
  printed tfr ~0.51 late) — the U45 high-incidence confirmable regime —
  and spread was the log's last unscanned single feature axis. Flow:
  tool `tools/calib4.ts` + 32-assertion selftest (green) → pre-read
  audit (sound-with-findings, 5 findings → amendments incl. the
  z ≥ 4.49 + mid-price-W-park proceed/park formula; report verbatim in
  `knowledge/AUDIT-2026-07-11-CAL-004-REG.md`) → one-shot read (six
  identity gates reproduced the published CAL-001 read at printed
  precision; a SIGPIPE-truncated first invocation disclosed, the
  deterministic completion is the read of record) → ZERO candidates,
  ZERO neg-flags; extremes UP W (750s, [0.20,0.35)) z=−3.05
  (buyer-adverse, coverage 0.8746 conditioning) and +2.29 on an n=1
  cell → Judge null-confirmed with one scope correction (erratum:
  per-AXIS exhaustion, not categorical log exhaustion — interaction
  scans stay formally open with less power + the reserve-confirmation
  burden) → LESSONS E23, EDGE-SPACE §1 map row + spread-state bullet +
  §4 bar updated → D25 propagation audit (sound-with-findings, 1 MAJOR
  dropped-coverage-caveat + 3 MINOR, all applied; report verbatim in
  `knowledge/AUDIT-2026-07-11-E23-PROPAGATION.md`). Reserve unspent;
  holdout untouched.

- U58 (session 49): FLEET UNBLOCKED — the operator applied the lab's
  registry patch mid-session (a10b59d + STATE note 2a9b188; wake-up
  probe now prints `RESOLVED`), and the pre-committed FLEET-GAP.md
  reconciliation plan was executed as ONE unit before any fleet evidence
  run: (1) `tools/submit.ts` evidence stages (probe/main/lat/grid/
  holdout) now emit bare engine CLI + `--detach` (smoke stays local
  wrapper `--sequential`), all six stage commands verified printed
  against the frozen EXP-001 spec (boundary−1 bounds, D8 pins, holdout
  validator gate intact; main extension correctly carries no
  --batchUid), with a REFUSAL gate on dirty/unpushed trees (verified:
  refused a dirty tree); (2) `tools/capacity.ts` built and run — 4
  machines, 32 alive worker slots, all on fable-protocol; (3) D8
  re-verified EMPIRICALLY on the fleet path: runs 421/422
  (FLEET-SMOKE-D8/-D8B, fable-exp-006 — killed mechanism, plumbing
  only) completed 10/10 with 0 failures on worker-executed commit
  cab72171, and the D8B market-job payloads read from Redis pre-drain
  all carry `latency={"delayMs":0,"jitterMs":0}` from the submitter's
  pinned env; holdout-lock sweep re-run: no new rows vs the
  classified 2026-07-10 baseline (exit 2 comes from the 67 pre-existing
  classified rows; runs 421/422 CLEAN). Docs reconciled: FLEET-GAP STATUS section, D33
  amendment, RUNBOOK §1/§5, tools index, this file's gate 3. The
  malformed-lab-strategy coupling caveat STANDS (RUNBOOK §5).

- U58c (session 49): U58 D31-verified by a fresh-context checker
  (sound-with-findings; 2 MAJOR + 2 MINOR, all applied). MAJOR 1: the
  fleet --execute dirty gate could NEVER pass in this worktree — `data`
  and `node_modules` are untracked SYMLINKS that .gitignore's
  directory-only patterns miss, so the allow-arm had never run; submit.ts
  now exempts exactly those two known environment-symlink porcelain
  lines, and BOTH arms are now exercised end-to-end: a real untracked
  file still REFUSES, and a clean+pushed tree submitted run 423
  (EXP-999-probe, 5 markets, gitignored scratch spec, killed strategy —
  plumbing only, never evidence) through submit.ts --execute, completed
  5/5 with 0 failures; post-run holdout sweep: no new rows (67
  pre-existing classified rows across 68 runs). MAJOR 2: capacity.ts
  restated the worker-alive threshold as <5 min — the dashboard's actual
  bar is <30 s (workers.ts:113,130; 5 min is the heartbeat-less prune
  grace); header + banner corrected. MINOR: "parity checks" restored to
  the local-`--sequential` scope in three docs (charter wording,
  silently narrowed); sweep-"clean" claims reworded to the exit-2
  convention in four docs.

- U59 (session 50): wake-up checks ran — universe unchanged (18,635
  eligible, last 2026-06-14), trades coverage unchanged (17,878/18,635;
  only delta/delta-typed converters on disk) — both gates closed; fleet
  healthy (32 alive slots, registry probe RESOLVED). Verification unit:
  the operator's main-merge (f1cf90b, 2026-07-11) AUDITED end-to-end
  against lab dependencies (`knowledge/MERGE-AUDIT-2026-07-11-f1cf90b.md`).
  Verdict: no cited replay/fill/fee/tick/statistics semantics changed —
  src/trading, src/market, src/parquet, src/strategy untouched; E9-E23
  and CAPABILITIES.md stand. Three lab-relevant findings: (1) engine-side
  computeQuality guard (null for |q|>99,999,999) closes the E13 crash
  class at the source INCLUDING the fleet worker path, which since U58
  bypasses the D12 wrapper clamp and had carried the exposure unmitigated
  — D12 amendment + E13 update appended; (2) durationWallClockMs changed
  span→union-of-busy-intervals — swept: no lab tool/verdict reads it;
  (3) worker self-update orphan fix + lockDuration 10→3 min — fleet
  submissions safer; stalled-job worst case for polling math is now
  ≤ 3 min lock expiry + 30 s detection. D31 fresh-context check:
  sound-with-findings — all load-bearing conclusions independently
  reproduced (diff stat, guard text at exact lines, sole-producer trace
  incl. an adversarial sweep of rebuild-backtest-segments and the
  research insert script, union ≤ total argument, lab consumer sweep,
  D12/E13 fidelity — no bar or figure tightened); 6 MINOR findings all
  applied: additional driver-boundary write sites enumerated in the
  audit §1 (all downstream of the one guarded producer, so the
  conclusion stands), three stale batchStats.ts line citations corrected
  (merge shifted the file 337→343 lines: CAPABILITIES.md 172-337→180-343,
  data-results-pipeline.md same + 160-167→162-175, EPISTEMOLOGY.md
  162-175), invented `research-*` id prefix fixed to the actual
  `endgame-panic-bid.*` ids, commitGate.ts "new"-file wording fixed +
  stats/package.json table row added, fleet-persist process description
  corrected (aggregate persist runs in the parent worker via
  aggregateProcessor.ts:161, not the child), §3 stall arithmetic made
  internally consistent.

- U60 (session 50): CAL-002/003/004 published reads REPRODUCED
  byte-identically (verification depth, U47 calib.ts precedent — the
  siblings' one-shot reads had never been reproduced; a transcription
  error in a published Results block would have been invisible, the
  U43bb "4,372" typo class). All three tools byte-unchanged since their
  read commits (git log empty over f5d9aa3/a505f1d/974c418 → HEAD);
  re-run on the surviving discovery log with current DB state; diffs
  clean: CAL-002 re-run vs published block (77 lines — the block was the
  ONLY record, now proven faithful), CAL-003 re-run vs raw capture vs
  published block, CAL-004 re-run vs committed raw vs published block.
  One-shot-rule reasoning recorded in each note: post-verdict
  reproduction of a closed null against its own published bytes cannot
  inflate false-positive rate or enable data-dependent selection —
  verification, not a second read. Notes appended to all three
  CALIBRATION files. D31 fresh-context check: sound-with-findings — the
  verifier RE-RAN all three tools itself (byte-identity confirmed
  end-to-end; freeze claims, commit ids, line counts, "no CAL-002
  capture exists" all independently confirmed); 3 MINOR applied to the
  CAL-002 note: "nothing it can show steers any decision" tightened to
  the harms-the-rule-prevents phrasing (a failed repro WOULD steer
  work), the input-log dependence of "faithful transcription" made
  explicit with the log's sha256 fingerprint now committed in the note
  (f8b7678f…, 17,161,328 bytes — verified by both verifier and session),
  and the gitignored-repro-artifacts point recorded (published blocks
  are the durable record).

- U61 (session 50): DECISIONS D35 — operator-merge audit added as
  standing wake-up check 4 (motivating evidence: f1cf90b sat unaudited
  two sessions and turned out to carry a lab-relevant semantic change,
  U59; only luck made it neutral-or-positive). Audited point recorded:
  f1cf90b + a10b59d; successors diff from there.

## In progress
- (nothing in flight)

## Next
- Research is gated on the EDGE-SPACE §4 bar (updated in U39, tightened
  by E20, E21, E22, and E23): taker needs a ≥1.5c gross argument that
  escapes E9-E14, the CAL-001 fixed-time plane scan, the CAL-002
  single-segment conditional scan, the CAL-003 two-segment path scan AND
  the CAL-004 spread-state scan (e.g. finer
  path/flow/derived features, or sub-power windows while clearing ~1.5c
  via another instrument, per EDGE-SPACE §4 — the E22 up-dn reversal
  mirror at ≈+2.4c net, z=+2.40, is the concrete open point but needs a
  NEW instrument or reserve-window evidence under full
  pre-registration); maker in-model needs a cell/gate that escapes
  E16/E17 (worst-queue) AND E19 (touch); or a cited VENUE-DRIFT regime
  change. Legitimate non-registration work:
  verification depth, keeping EDGE-SPACE §3 current, friction-motivated
  protocol maintenance.
- Successor wake-up checks (run these FIRST, they are the only things that
  change the gated state from outside):
  1. `tools/universe.ts` — if the last eligible market is ≥ ~1 month past
     2026-06-14 (operator ran the Telonex sync), run the VENUE-DRIFT
     refresh procedure on the new month(s); a fired band reopens §4
     only after the D27 confirmation redraw (U46).
  2. `tools/trades-coverage.ts` + `ls data/events/telonex/` — if the
     operator ingested the `trades` channel (D20 advocacy) and a
     trades-aware converter exists, the queue-realistic fill model
     supersedes both D18 bracket ends; that reopens maker measurement
     with a NEW instrument (full pre-registration required).
  3. Fleet health (the D33 gap is RESOLVED as of 2026-07-11 — operator
     patch a10b59d, reconciliation executed in U58): before any fleet
     submission run `npx tsx fable-lab/tools/capacity.ts` (live slots;
     refuses at 0) and verify the tree is committed AND pushed
     (submit.ts enforces this on --execute). The old registry probe
     (`'fable-exp-001' in strategyRegistry` → RESOLVED/GAP) is now a
     regression check: `GAP` would mean the operator REVERTED the patch
     — stop fleet submissions and fall back to local `--sequential`
     (D7/D10) until reconciled.
  4. Operator-commit drift (D35): `git log --oneline
     <last-audited-point>..origin/fable-protocol` — if any non-fable-lab
     commit touches `src/` (or drizzle/, or dashboard API surfaces a lab
     tool consumes), audit the diff against lab dependencies before
     relying on conclusions that cite the touched files (method:
     `knowledge/MERGE-AUDIT-2026-07-11-f1cf90b.md`). Last audited
     point: f1cf90b + a10b59d (session 50; all later commits to date
     are lab-authored).
  5. Otherwise: verification depth or targeted diagnostics only; do not
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
  after every unit; evidence runs go through the WORKER FLEET via
  `tools/submit.ts` (`--detach`, committed+pushed code — U58); smokes,
  debug, and parity checks stay local `--sequential`; never create `fable-lab/DONE`.

## Operator update — worker fleet unlocked (2026-07-09)

All distributed workers now track `origin/fable-protocol` and lazily
self-update to whatever you push there. Charter constraint 3 updated:
evidence runs go through the fleet (`--detach`, committed+pushed code),
~1000 markets in 15-25 min. Local sequential stays for smokes/debug.

## Operator update — fleet rules refined (2026-07-11)

Charter constraint 3 updated: (a) every fleet submission — new runs AND
extensions — uses `--detach`; (b) fleet capacity now changes over time
(operator added workers; may add/remove more) — check live worker counts
before sizing batches instead of assuming; throughput ≈ markets × 1.75s /
active slots; (c) main was merged into this branch (wall-clock stats fix +
dashboard improvements). Re-read charter constraint 3 before your first
submission this session.

## Operator update — journal added (2026-07-11)

New standing requirement (charter, resumability section): append plain-
language progress lines to `fable-lab/JOURNAL.md` AS YOU WORK — the
operator follows it live with tail -f. Seeded at repo; start every session
by noting in it that you resumed and what you are picking up.

## Operator update — fleet-gap patch APPLIED (2026-07-11)

Your fleet-gap-registry.patch was reviewed and applied by the operator:
commit a10b59d on fable-protocol (registry file only; nothing else touched).
Verified before committing: the registry now resolves fable-exp-004/006/007
and the fixtures. Workers self-update on their next job. Your wake-up probe
should find the unlock live — proceed with the pre-committed reconciliation
plan (fleet --detach + capacity tool) when it does.
