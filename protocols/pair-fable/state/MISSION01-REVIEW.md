# Mission 01 (pair-fable) — Independent Review

- **Review target**: commit `c6d17ed` (the READY commit, branch `wt/pair-fable`)
- **Deliverables reviewed**: `protocols/pair-fable/state/READY.md`, `state/PLAN.json` (all 9 items'
  evidence), `memory/process/evaluator.md`, `memory/capabilities/parity.md`, plus the tools,
  strategies, memory notes, and proposals they rest on
- **Method**: 8 independent verification dimensions (DB reproductions of runs 852–870 in live MySQL,
  code checks at the cited SHAs `e96b246`/`1415c2b`/`c6d17ed` via `git show`, re-execution of
  `evaluate.ts` and `refresh-capabilities.ts`, an overfit red-team, and a line-by-line READY/PLAN
  evidence sweep), then adversarial adjudication of every candidate finding by 1–2 independent
  verifiers instructed to refute. 24 agents, ~475 tool calls. Confidence discipline: CONFIRMED only
  with an executed reproduction; severity strictly by downstream consequence.
- **Context**: `origin/main` (`89b9a8f`) already contains post-READY commits — engine fixes for
  P-001/P-008 (`8848aa6`, `6cc1a3c`, `8b799a2`), the A1–A7 amendments applied (`dcb7746`), and the
  cross-protocol read ruling (`a13be3b`). Severity below accounts for those where relevant.

**Bottom line up front**: the evidentiary record is sound — every load-bearing number and claim
that was checked reproduced exactly against the database and the code (115 checks held up; the
weekly/monthly run-870 tables, noise floor, latency sweep, independence correlation, cost==invested
arithmetic, parity boundary map, P-001/P-008, and the recorded evaluator verdict all reproduce).
The 11 findings are: 4 major forward-looking gaps in the *promotion machinery* the evaluator will
grow into during Mission 02, 1 contested-severity gap, and 6 minor doc/tool corrections. **None
invalidates any Mission 01 conclusion** (the v0 KILL, E-001..E-005, the parity conventions, and the
capital units all stand). Verdict at the end.

---

## 1. What was checked and held up (coverage)

### 1.1 The run record (runs 852–870, live MySQL)

- Full inventory reproduced: 19 runs, all `status='completed'`, `failures_count=0`,
  `protocol='pair-fable'`, `model='claude-fable-5'`; market counts match PLAN evidence exactly
  (852=5, 853=1, 854=20, 855=200, 856–860=3, 861=5, 862=50, 863=300, 864=1000, 865–869=300,
  870=10747).
- **Run 870 (FULL universe)**: 10,747 rows; cmd carries the RULES pins (`--latency-delay-ms 140
  --latency-jitter-ms 20 --protocol pair-fable --from-ms 1775088000000` = the 2026-04-02 floor);
  `SUM(pnl)/COUNT(*) = −2.2375` matches the stored `ev_per_market_total −2.24`; played 9,750 /
  skipped 997, and skipped == the pnl==0 rows exactly (READY A1's premise). Re-running the engine's
  own eligibility query returns exactly 10,747 markets with the same MAX(market_start_ms) — run 870
  covered 100% of the eligible universe at launch. Single `commit_sha` across all 10,747 rows
  (descendant of the strategy-freeze commit `bcca2c8`), spread over 4 fleet machines; wall clock
  805 s ≈ the claimed 13–15 min.
- **"0/16 positive weeks"**: reproduced. 17 weekly segments; exactly 16 pass the ≥300-market filter
  (W14=384, W15–W29 at 670–672; W30=286 excluded); all 16 negative (ev −2.46..−1.66); the excluded
  partial week is also negative, so the verdict is robust to the filter.
- **Monthly stationarity**: exactly 4 months, ev −2.23 / −2.26 / −2.21 / −2.25 — inside the claimed
  [−2.26, −2.21].
- **Noise floor (865 vs 868)**: cmds byte-identical except batchUid; identical params; same 300
  slugs; Δpnl_total 0.26 exact; Δev 0.000867 ≈ the recorded 0.0008; daily correlation 1.0000.
- **Latency sweep (865/866/867/869)**: latency pins 140/300/600/1000 confirmed in cmd; slug
  intersection = 300 = each run's full set; EVs −2.349/−2.342/−2.311/−2.253 match the recorded
  −2.35/−2.34/−2.31/−2.25; taker share 1.40%→3.66%→5.90%→9.09% — E-003's 1.4%→9.1% monotonic drift
  reproduced.
- **Independence (863 vs 868)**: configs differ by exactly `maxPairCost` 0.95 vs 0.98; UTC-day
  Pearson over the 300 common slugs recomputed independently = 0.998895 ≈ the recorded 0.9989
  (note: only UTC bucketing — the documented convention — yields this; local-tz bucketing gives
  0.9967, i.e. the original computation was done correctly).
- **cost==invested (run 856)**: per-market
  `ROUND(avgUp·upSh + avgDn·dnSh + fees, 2) == cost` reproduced to the cent (30.86 / 36.32 /
  50.11), and `pnl == mergable + remainingWinner − cost` (20.14 / 26.68 / 20.89); intent_meta dedup
  reproduced (8 fills from 7 orders → exactly 7 meta entries).
- **Baseline invariants (run 862)**: MAX|up−down| = 10 = incrementSize; SUM(split_cost)=0;
  MAX(cost)=50 exactly (cap binds, never exceeded); 290 maker / 1 taker; segment −121.69 / −2.43 /
  43 played. Run 857 smoke numbers (67.66 / 22.55 / 23 taker / invested 117.34 / profitPer100
  57.66) reproduce.
- PLAN side-evidence: run 855 wall-clock 13,796 ms and the 74/64/36/26 machine split; run 854's
  2-of-4-machine skew; submission uids 78363e30/b6b2edb3; run 857's deterministic
  `batch_uid=smoke-20260730T194744-4vrhbh`; run 864 = exactly 1000 markets (the P-008 bite) with
  W14=384/W15=616 — all reproduced.

### 1.2 Parity map (`parity.md` @ `e96b246`)

All §3 table rows verified against the code at the cited SHA: worst-queue maker fill (strict
`bestAsk < P`, then all-or-nothing at the level), per-level taker partials, FOK semantics and the
`killed` vs `order_rejected` event-kind split, the live-only 15-order batch cap, the
clientOrderId-vs-orderId cancel mismatch (P-006) and live cancel error-swallowing (P-007),
account-wide live `cancel_all`, GTD `expired` vs `canceled`, hardcoded 700 bps vs WS-driven fee
rate, `USER_WS_FILL_AT_STATUS` default MINED, identical risk walls (20 / 2000 / 2000 / −500), the
no-tick-grid-validation claim, and the shared-core claims (§1). The watched paths are unchanged
from `e96b246` through `c6d17ed` *and* through `origin/main` — the note's CLEAN status is genuine.
One wording overstatement found (minor #8 below).

### 1.3 Capital units (`evaluator.md` formulas vs code @ `1415c2b`)

Portfolio BUY basis accumulation (`price·size + takerFee`, round2), the fact that only
sell/split/merge paths reduce basis (the scope guard's three conditions each map to a real code
path), settlement as pure valuation with
`pnl = realized + mergeValue + redeemValue − remainingCostBasis − splitCost`, pnl-net-of-fees (no
double count), the intent_meta dedup mechanics, INITIAL_CAPITAL as pure reporting (justifies A2),
the pnl==0→skipped classification (justifies A1), the taker-fee functional form
`(bps/10000)·p·(1−p)·size`, and the exact correspondence of `runQueries.ts` unit computations to
evaluator.md units 1–5 — all verified. Cited files unchanged from `1415c2b` to `c6d17ed` and to
`origin/main`.

### 1.4 Evaluator tool (`evaluate.ts`)

The recorded end-to-end evaluation **reproduces exactly**: re-running
`evaluate.ts --full-run 870 --sweep-runs 865,866,867,869 --screen-run 863 --screen-baseline 868
--noise-ev 0.0008 --design-ts <bcca2c8>` yields MECHANICAL PASS, S1 ADVANCE (Δev +0.29), S2 FAIL
(ev −2.24, 0/16 weeks, monthly stationary), S3 NA-on-negative-base with the taker-drift warning,
S4 correctly waiting at 0 OOS markets, OVERALL FAILS-S2-FULL. Implementation matches the spec:
partial-week filter applied before gating, chronological week ordering, the engine's walk-forward
gate as documented, strict-greater OOS split, intersection-based sweep gate, no hardcoded constant
contradicting the doc, safe NULL handling. v0's recorded design-ts matches `bcca2c8`'s real commit
timestamp.

### 1.5 Launcher / smoke / capability refresh

RULES pins are unconditionally injected and unknown flags hard-error (exit 2) before any side
effect, vs. the raw CLI which really does drop unknown flags silently (`backtestArgs.ts:414-417`);
`--extend` refused citing P-001; P-008's silent 1000-cap exists at `c6d17ed` exactly as documented
and the launcher's explicit-limit injection defeats it; P-001 existed at `c6d17ed` exactly as
PROPOSALS.md describes. Both are now fixed engine-side on `origin/main`. **The capability-refresh
mechanism was validated against real drift**: run against the moved `origin/main` (`89b9a8f`) it
correctly reports staleness (not CLEAN) for the notes watching the changed engine paths, and it
fetches a fresh origin/main by default. Both PLAN drift simulations reproduce.

### 1.6 READY / PLAN sweep

Every referenced file exists (9 tools + lib, 6 capability notes with `verified:`+`watches:`
headers, team-workflow.md with exactly 7 conventions, LEDGER E-001..E-005, six variant axes in
pair-v0.md, P-001..P-008 each with repro and status). The READY summary numbers match their
sources; "96/day" and "800 ≈ 8.3 days" are structurally correct; the session-9 history behind A4
and the "stateless across 12 sessions" claim match the journal. One quantitative claim contradicted
by the data (minor #11 below).

---

## 2. Findings

All findings below survived independent adversarial adjudication (each was re-reproduced from
scratch and its consequence attacked; votes shown). None affects the validity of Mission 01's own
conclusions. Severity is by downstream consequence for Mission 02+.

### Major — gaps in the promotion machinery Mission 02 will rely on

**M1. `evaluate.ts` stitches stage verdicts from runs of different param sets; MECHANICAL checks
only the strategy id.** — CONFIRMED (2× adjudicated CONFIRMED, major)
`evaluate.ts:197-198` is the only cross-run identity check (`r.strategy !== full.strategy`); params
and latency equality are never compared across the `{full, sweep, screen}` runs. Demonstrated on
real data: the recorded exemplar command itself mixes screen-run 863 (`maxPairCost=0.95`) with
full-run 870 (`maxPairCost=0.98`) and MECHANICAL reports PASS. In the dry run this mixing was
deliberate and documented; over months of autonomous sessions reusing run ids, a variant can
inherit a sibling param set's S1 — or, worse, S3 latency-robustness (a RULES gate) — pass.
*Repro*: `SELECT id, JSON_EXTRACT(params,'$.maxPairCost') FROM backtest_runs WHERE id IN (863,870)`
→ 0.95 vs 0.98, while the exemplar evaluate.ts invocation prints MECHANICAL: PASS.
*Fix (cheap)*: MECHANICAL should require params identity among full/sweep/screen-variant runs and
latency-value equality of the screen pair (`params` is already fetched in RunIdentity). Note the S1
*baseline* is a different variant by design — do not over-constrain it.

**M2. `design-ts` — the foundation of the "un-cheatable" S4 holdout — is self-attested and
machine-checked against nothing; undefined for CLI-param variants.** — adjudicated CONFIRMED (2×,
major)
`evaluate.ts` accepts any `--design-ts` and cross-checks it against nothing (not the strategy
file's git history, not the earliest `backtest_runs.created_at` for that strategy+params — which
exists and is unused). For `--param`-launched variants (like run 863) there *is* no param-freeze
commit, so the anchor is undefined for exactly the sweep-style variants Mission 02 will produce in
volume; and nothing forces a *new* design-ts when iteration continues after a first S1 pass. Since
S4 is the only stage iteration cannot leak into — and the evaluator's own multiplicity guard
explicitly waives control *because* "OOS cannot be p-hacked" — a stale/copied design-ts silently
converts tuning data into "OOS" with no detector. The one executed instance was honest (v0's
design-ts exactly matches `bcca2c8`'s commit time), and the live path keeps a git-anchored,
human-reviewed bar (A5), so this is major, not blocker: the unguarded surface is champion
selection and portfolio admission inside the loop.
*Fix (cheap)*: define design-ts for param variants (e.g. the commit that first *records the config
in the family file*, which is itself committed — machine-checkable), and have `evaluate.ts` sanity
check `--design-ts` ≤ the earliest matching run's `created_at` and warn otherwise.

**M3. S4's champion bar (`OOS ev > 0` at n≥400) is a ~coin flip for a zero-edge variant, and
champion = max over noisy positives — multiplicity is uncontained at the champion level.** —
adjudicated CONFIRMED + PLAUSIBLE, both major
Measured per-market pnl sd on run 870 is 2.488 → SE at n=400 is 0.124; bare `ev > 0` passes a
zero-true-edge variant with ~50% probability (~21% even at true ev −0.1), unlike S1 which gates at
`max(2×noise, 0.05)`. Champion selection then takes the max over these noisy positives
(upward-biased by construction) and dethroning is a thresholdless comparison. The *live* leg is now
protected on `origin/main` (accepted A1: $2/market on OOS ≈ 16σ at n=400 — unreachable by chance),
so no noise champion can reach real money; what's unguarded is the champion label itself steering
weeks of search (champions become S1 baselines) and "validated forward edge" conclusions in family
files. Also worth stating honestly in evaluator.md: a 400-market OOS window is ~4 calendar days —
one regime — "un-cheatable" ≠ "high-powered".
*Fix (cheap)*: an SE-scaled or fixed minimum OOS ev for CHAMPION-ELIGIBLE (e.g. ev > 2·SE(n)), a
dethroning threshold, and champion re-validation as OOS n grows.

**M4. No tool checks engine/strategy code-version consistency across compared runs; team-workflow
rule 4 encourages reusing old runs with no engine-version condition.** — adjudicated CONFIRMED +
PLAUSIBLE, both major
`commit_sha` is stored per market row (and within-run consistency is verified — fleet SHA gating
works), but `RunIdentity` doesn't select it and `evaluate.ts`/`compare.ts` never compare it. The
mission's own 19 runs already span four engine SHAs (benign, launcher-level — but the mechanism has
no defense when a fill-model or fee change lands, and three engine commits landed within a day of
READY). The ≤7-day baseline rule addresses *market* drift, not *engine* drift;
`capability-refresh.md`'s fold-back never says "invalidate or re-run comparison baselines"; and
team-workflow rule 4 allows reusing any-protocol, any-age runs keyed only on
strategy+params+latency. Unguarded remainder: S1 KILLs on mixed-engine deltas (a good axis buried
for 60 days), dethroning across engine versions, stale-engine FULL-run reuse as S2 evidence.
*Fix (cheap)*: add `commit_sha` to RunIdentity; warn on SHA mismatch in evaluate/compare; add an
engine-SHA condition to team-workflow rule 4; add a "re-baseline after semantic engine drift" line
to the capability-refresh fold-back.

**M5 (severity contested). Maker fill-SIZE optimism (all-or-nothing at the level) is bounded by no
number anywhere.** — adjudicated CONFIRMED-major / PLAUSIBLE-minor
The simulator fills the *entire* resting size when price trades through, with no depth constraint —
documented honestly in simulator.md/parity.md §6.4, but "keep increments small" is quantified
nowhere: no stage measures fill size vs depth, `incrementSize` has no schema upper bound, and the
$-per-market headline scales with fill size in the sim but not live. Containment is real (accepted
A1/A2 pin capital caps and per-dollar reporting; the v0 loss anatomy's gradient actually points
*against* larger increments; §6.4/§6.8 human review + DRY_RUN + minimum-size live phase catch it
before money), which is why one adjudicator argues minor. My ruling: keep it as a note worth one
line of code — the iteration-phase ranking risk is real even if capital never reaches the artifact.
*Fix (trivial)*: a schema `max` on `incrementSize` (or a numeric bound in §6.4, e.g. increment ≤
median displayed level depth for the family's price band).

### Minor — confirmed corrections (docs/tool), none verdict-affecting

**m6. Taker-leakage checks are prose-only.** The S1 ">2% taker for maker-only designs" mechanical
check is implemented in no tool, and S3's `takerShareRisingWithLatency` is computed but never
enters the sweep verdict (`evaluate.ts:308-314` — warning print only). Fees are correctly priced
into EV, so economics stay honest; the gap is diagnostic. *Fix*: make the S1 check mechanical in
`evaluate.ts`/`results.ts`; consider making a rising taker trend at least an ITERATE-forcing flag.

**m7. Settlement valuation assumes zero-cost, zero-timing merge/redeem, and evidence-bar 6.4's pnl
decomposition (pair-completion vs directional windfall) is enforced by no stage.** Structurally
small on Polygon vs a $2 target, and bar 6.8 precedes money — but the haircut is unquantified and
the decomposition only happens if a human remembers at live review. *Fix*: one estimated
gas/relayer haircut line in evaluator.md; a decomposition column in `results.ts` output.

**m8. `parity.md:54` overstates backtest CONFIRMED**: `status:'CONFIRMED'` fires only in FOK
complete-fill branches (`BacktestExecution.ts:384,525` @ `e96b246`); GTC/GTD complete fills emit
`order_done('filled')` with no CONFIRMED. Convention 5.3 ("never gate on MINED or CONFIRMED")
already neutralizes design impact. *Fix*: cell should read "CONFIRMED only on FOK complete fill".

**m9. S1 KILL/ADVANCE precedence ambiguity.** evaluator.md lists KILL first; `evaluate.ts:254`
checks ADVANCE first. The branches overlap when a positive variant is worse than a positive
baseline by more than the threshold — unreachable today (all baselines negative), live the moment a
positive champion exists. ADVANCE-first is plausibly the intended semantics (portfolio wants
independent positives). *Fix*: one precedence sentence in evaluator.md §S1.

**m10. Noise-floor note says "one market moved (−0.20)"; actually two moved** (−0.20 and −0.06 —
the second flipped pnl 0 → −0.06, i.e. jitter can flicker the played/flat classification, worth
knowing if a gate ever keys on played-derived denominators). The gate-feeding Δev 0.0008 is
correct and the deltas sum exactly to the recorded 0.26. *Fix*: one-line correction in
evaluator.md:138 + pair-v0.md:86.

**m11. Eligibility-lag claim contradicted by data.** evaluator.md:127 says eligibility "lags ~3
days behind now" — that's the structural min-age floor, not reality: run 870's universe ends
2026-07-23 01:15 (~7-day lag at launch; ~8 days by review time, frontier unmoved — OOS arrival also
depends on the producer's `data:sync` cadence, which no deliverable names as an S4 dependency).
Propagations: LEDGER E-005 records the universe as "→07-27" (actual 07-23), and A5's "~4–5 days of
new markets after freeze" understates the realistic OOS wait (~10+ calendar days). S4 gates on
actual DB counts so no verdict can be corrupted — this is scheduling-expectation error. *Fix*:
correct the three texts; name `data:sync` cadence as an OOS dependency.

---

## 3. What this means

The mission's own standard — every claim run-verified, nothing trusted from notes — survives
hostile checking: **not one evidentiary number failed reproduction** (the only factual errors found
are m10 and m11, both peripheral to any verdict, plus the m8 wording). The tools do what their
contracts say; the capability-refresh mechanism caught *real* post-READY engine drift when
re-executed; the two engine bugs the mission flagged (P-001, P-008) were real at the review SHA and
are already fixed upstream, which is the proposal pipeline working as designed.

The major findings are all of one species: the *evaluation machinery is currently honest because
its operator has been honest*. Identity, provenance-of-design-time, statistical power at the
champion gate, and engine-version consistency are enforced by convention and prose, not by the
tools — acceptable for a 19-run bootstrap mission, not for months of stateless autonomous
iteration, which is exactly the regime Mission 02 enters. All five fixes are cheap, inside the
protocol's own write scope (`tools/`, `memory/process/`), and none requires rework of anything
delivered.

---

## Verdict

**APPROVE WITH NOTES.**

Mission 01's deliverables are approved: the evidence is real, the parity map is accurate, the
capital units are correctly derived, the evaluator's executed verdict reproduces exactly, and the
baseline's stationary-loss finding is robust. Mission 02 may start on this foundation.

The notes: address **M1–M4** early in Mission 02, before the first variant reaches S4/champion
consideration — (1) params+latency identity checks in `evaluate.ts`, (2) a machine-checkable
design-ts rule covering param variants, (3) a noise-aware CHAMPION-ELIGIBLE/dethroning threshold,
(4) engine-SHA awareness in cross-run comparison and team-workflow rule 4 — plus the trivial M5
schema bound. The minor items (m6–m11) are doc/tool corrections to fold in at the next touch of
each file. None of these blocks the start of research; all of them block, and should gate, the
first champion promotion.
