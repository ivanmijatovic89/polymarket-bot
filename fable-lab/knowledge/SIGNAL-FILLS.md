# SIGNAL-FILLS — SIGNAL-003, the per-fill toxicity scan (IDEAS #22)

_Registered session 64 (U99), 2026-07-11. Motivating evidence (governor):
E29 — run 472's ungated DOWN at-touch cell breaks exactly even (q̂=+0.0033,
t=+0.07, N=500, 479 played), so the fill population averages ~zero; if ANY
tick-observable pre-fill state predicts fill toxicity, its complement is
positive-EV by arithmetic. Run-472's DB grain is exhausted (U97: 1 trade
per market, bands/seasonality noise) — the instrument must log state AT
each simulated fill. This is the only maker direction that satisfies the
E29-raised EDGE-SPACE §4 bar, and it is falsifiable: a null closes the
maker family for good._

## 0. Epistemic grade

**Map-grade** (SIGNAL-MAP §0 conventions apply verbatim): outputs are
hypothesis-generating, gross-of-costs, uncitable. A candidate licenses a
mechanically derived complement gate that must then survive a **fresh D49
screen on a NEW sample** (E26c winner's-curse discount in sizing — the
measured dilution precedent is ~8×). This scan is outcome-USING (per-fill
PnL is the target), so the CAL discipline binds: method + cells + bars
frozen in this commit BEFORE any real log line or outcome is read;
discovery window only; ONE-SHOT read after all shards complete and the
coverage accounting is clean.

## 1. Instrument

`strategies/_fixtures/diag-fill.ts` (`fable-diag-fill`): replays the EXACT
run-472 SCR-008 cell — ungated DOWN-side at-touch bid, hardcoded frozen
params (30-870s window, requote at 1c drift, price bounds [0.02, 0.98],
inventory cap 100, size 100) — and emits one `[diag-fill]` line per own
fill. Outcome-free: no PnL read or logged; `tools/signal3-scan.ts` joins
`telonex_markets.result_id` ONCE at the one-shot read.

**Causality (the load-bearing property):** `StrategyRunner.onMarketTick`
drains execution fill events BEFORE the strategy sees the fill-triggering
tick (StrategyRunner.ts:174-180 vs :296), so the state block logged at
fill time is the last tick a live strategy could have ACTED on (canceled
the quote). Known optimism, disclosed: acting on it live costs one cancel
latency; runs are pinned DELAY=0/JITTER=0 (D8/D51), so a candidate gate's
fresh screen must consider latency sensitivity before any escalation.
Fill-triggering-tick state is deliberately NOT logged — nothing in this
scan may depend on information that arrives simultaneously with the fill.

**Fill model:** touch_or_better (D18) — the same optimistic bound as run
472. D18 rules bind downstream: gates found here feed screens whose
outcome set is {kill, escalate}, never advance/live-EV.

## 2. Sample (frozen)

- Universe: ALL 8,516 discovery-window markets
  (`market_start_ms < 1772323200000` = 2026-03-01T00:00Z), the same window
  as SIGNAL-001. Reserve and holdout untouched. Boundary market moot
  (all markets predate it).
- Runs: 6 disjoint local shards, batchUids `SIGNAL-003-touch-s[0-5]`
  (`touch` label per D18 guard), `--sequential --fill-mode
  touch_or_better`, latency pinned 0/0 (D51 enforces). Shard disjointness
  verified at launch via loaded-market counts summing to 8,516.
- **Primary sample:** FIRST fill per market (`fillSeq=0`), `fLiq=MAKER`,
  `fPrice ∈ [0.02, 0.98]`, resolved market (`result_id ∈ {0,1}`). One
  observation per market → independence across observations is clean.
  Later fills and non-maker first fills are counted and excluded
  (run 468 measured 0 taker fills at pinned latency; the count is a
  cross-check). Rows with `qAgeSec=-1` (requote-race attribution
  sentinel) stay in the primary sample but are excluded from the
  `qAgeSec`/`qMidDrift` tests only.
- **Target:** residual r = wonDown − fPrice per fill (DOWN buy held to
  settlement; maker fee 0 in the engine model — same convention as the
  run-472 economics).

## 3. Features (21, all causal at the last pre-fill tick)

Book state: `spread` (dnAsk−dnBid), `l1Imb`, `l5Imb`, `l10Imb` (UP-book
depth imbalance; DOWN is an exact mirror, CAL-001 am. #12), `dTot5`,
`dTot10`. Quote-derived: `qAgeSec` (fill time − quote placement),
`qMidDrift` (pre-fill UP mid − mid at quote placement — the drift INTO the
fill). Activity/path (diag-signal conventions): `nTicks`, `rate60`, `vol`,
`nz`, `flips`, `range`, `posR`, `move60`, `move10` (new: 10s mid move —
sweep precursor at fill horizon), `firstMid`, `firstTs`, `crossedN`.
Timing: `fElapsed` (fill time in window).

## 4. Frozen statistics

1. **Monotone screen (primary):** per feature — Spearman rank-correlation
   of feature vs residual within fill-price strata LO [0.02,0.35) /
   MID [0.35,0.65] / HI (0.65,0.98] (strata with n ≥ 200 only), z_p =
   ρ·√(n−1), Stouffer-combined with w = √n. k = 21. **CANDIDATE
   |z| ≥ 3.50** (Bonferroni α ≈ 0.01: 0.01/21 two-sided → z=3.49), WARM
   |z| ≥ 3 (recorded, not candidate).
2. **Cell grid (shape readout):** feature quintiles (rank-based) within
   (stratum, feature); d = mean residual, z under the scan-se convention
   (empirical sd). k ≈ 315 evaluated cells (n ≥ 30). **CANDIDATE
   |z| ≥ 4.20** (0.01/354 incl. seasonality → z=4.19). Non-monotone
   shapes can appear here without a monotone flag; both bars stand
   independently.
3. **Fill seasonality:** hour-of-day (six 4h UTC bins) and day-of-week
   cells per stratum; same cell bar 4.20.

**Gates (abort before any table):** G1 join-direction (fills with
fPrice ≥ 0.90, n ≥ 30, must win > 75%; vacuous-if-underpowered is
disclosed, not fatal). G2 global zero anchor (|z| of overall mean residual
< 6 — E29 measured ≈ 0; a large global deviation is a parse/join bug, not
a discovery).

**Multiplicity honesty:** three families at family-wise Bonferroni ~0.01
each (joint ~0.03). Features are mutually correlated (vol/nz/flips/range;
depth levels) — Bonferroni is conservative under that dependence. A
monotone candidate lighting its extreme quintile cells is ONE finding.

**Tool:** `tools/signal3-scan.ts`; selftest `tools/signal3-selftest.ts`
(17 assertions green pre-freeze: hand-counted filter accounting incl. the
sentinel row, planted zero-mean monotone toxicity detected as CANDIDATE
with correct sign, noise feature quiet, G1 flip abort, G2 shifted-join
abort, --outcomes refusal). The selftest's planted world IS the E29
hypothesis: global mean ~0 while one feature separates good from bad
fills — the instrument provably detects exactly what it hunts.

## 5. Power (stated up front)

Expected primary n ≈ 8,100 (95.8% of markets played in run 472 × 8,516;
one fill per market). Monotone screen at n ≈ 8,000 resolves |ρ| ≳ 3.5/√n
≈ 0.039 — on a residual sd of ≈ 0.5 that is roughly a 4c PnL spread
across the feature's range, comfortably below the ~1.2c/fill gross that
would already be economically interesting at the E29 zero anchor. A
MID-stratum quintile cell (n ≈ 500 if MID holds ~30% of fills) resolves
|d| ≳ 4.2·0.5/√500 ≈ 9.4c — single cells are coarse; the pooled monotone
screen is the sensitive instrument. Dead zones below these resolutions
remain formally open.

## 6. Pre-committed interpretation

- **Zero candidates in all three families** → fill toxicity in the
  run-472 cell is unpredictable from causal tick state at stated power →
  **the maker family closes for good** (IDEAS #22 → dead; EDGE-SPACE
  maker bar becomes a closure statement; the E29 equilibrium reading
  stands as the family's tombstone). No further maker screens without an
  operator-side instrument change (queue-realistic fill model) or a
  D27-confirmed venue-drift fire.
- **Candidate(s) whose adverse side is tick-avoidable** → the complement
  gate is derived MECHANICALLY (frozen rule: gate = exclude the adverse
  sign side / adverse extreme quintiles of the candidate feature — no
  post-hoc cell shopping; the gate cell is the candidate's complement,
  nothing else), then registered as a D49 screen on a NEW sample
  (post-discovery markets or a fresh random draw from the reserve-free
  region), sized with the E26c winner's-curse discount. D18 outcome set
  applies (kill/escalate).
- **Candidates in a non-gateable direction** (e.g. seasonality-only, or
  a feature whose complement empties the fill population) → recorded as
  dead zones with sign; aiming value "avoid".
- The E29 zero is the arithmetic anchor: if a candidate's adverse cell
  averages −x on fraction p of fills, the complement averages
  +px/(1−p) BEFORE the winner's-curse discount — that number goes in the
  screen's prediction line.

## 6b. Disclosures (append-only, pre-read)

- **Smoke-summary exposure (session 64, post-freeze):** while verifying
  log-line formats for the coverage tool, a grep against the 10-market
  SMOKE log printed part of the engine's end-of-run summary block, which
  includes PnL aggregates (streak fields) for those 10 oldest discovery
  markets. This happened AFTER the freeze commit (3e8976c), touches only
  the smoke's own aggregate (never a discovery shard), and cannot alter
  the frozen method; it is disclosed per E28-adjacent hygiene. Lesson
  applied mechanically: `tools/signal3-coverage.sh` is count-only by
  construction — pre-read greps over shard logs must never print matched
  content because the engine's tail summary is outcome-laden.

## 6c. Pre-read amendments (append-only, session 64 — from the
fresh-context registration audit, verdict SOUND-WITH-FINDINGS, report
verbatim in `knowledge/AUDIT-2026-07-11-SIGNAL-003-REG.md`; all frozen
BEFORE the one-shot read, none touches `signal3-scan.ts` or the fixture)

- **Amendment 1 (audit MAJOR 2) — the complement-gate rule is now fully
  mechanical:** (a) a monotone-screen CANDIDATE → the gate excludes the
  single adverse EXTREME quintile per stratum, adverse side determined by
  the Stouffer z sign (z>0: q1 is adverse; z<0: q5 is adverse); (b) a
  cell-grid-only CANDIDATE → the gate is exactly the union of the flagged
  cells, nothing else; (c) a feature is GATEABLE iff it is computed by
  the fixture's own tick code path (all 21 except `fElapsed`, which
  gates by clock and is gateable trivially); seasonality-only candidates
  are non-gateable by this rule (recorded as zones). No other gate shape
  may be derived from this scan's tables.
- **Amendment 2 (audit MAJOR 1) — selftest extended pre-read** to pin
  all three statistical families: a planted zero-mean U-shaped quintile
  effect (invisible to the monotone screen by symmetry) must flag its
  adverse extreme cells, and a planted day-of-week effect must flag its
  seasonality cell; plus a cellTotal>0 assertion. Scan semantics
  untouched.
- **Correction (audit MINOR 4, E28 class):** §4 and D52 claimed
  "selftest 17/17" — the file contained 16 assertions (16 PASS when
  run). Corrected by this note; after amendment 2 the count is 23
  (grep-verified 23 check() calls, 23 PASS printed). Written-from-memory
  numbers struck again.
- **Disclosures (audit MINORs 3, 5-11), all pre-read:**
  - The scan does not itself enforce the discovery epoch boundary;
    enforcement is launch-side (verified: all 8,516 launched slugs <
    boundary) + `signal3-coverage.sh`, which now also checks epochs.
    G2 is silently skipped under n<100 (would be disclosed manually).
  - Families 2 and 3 carry an unregistered stratum n≥200 precondition
    (inherited from the scan's shared stratum loop) — stricter than §4's
    per-cell n≥30 alone; immaterial at n≈8,100, disclosed.
  - `qMidDrift` can log a fake 0.0000 when the tracked quote predates
    the first valid UP tick (attribution stays true); rare corner,
    scan-side undetectable, dilutive not directional.
  - A fill arriving before any valid state block is silently dropped
    WITHOUT consuming fillSeq, so a later fill could be relabeled
    fillSeq=0; structurally near-empty under the mirror-book invariant,
    disclosed as a silent arm.
  - `fElapsed` is mapped from the fill's own timestamp (fTs), not the
    pre-fill stateTs — causal for a clock gate (time is knowable in
    advance) but strictly fill-tick information; disclosed.
  - Family 3 bins by MARKET-OPEN time (epochSec), not fill time —
    it measures market-open seasonality of fill PnL; ≤1 bin skew.
  - `lastState` staleness (fTs − stateTs) is unbounded in principle;
    causal (never future-leaking), dilutes power at worst. The coverage
    tool now prints the staleness distribution (timestamps only,
    outcome-free).
  - Depth features (l5/l10 imbalance, dTot5/10) depend on ambient
    `WEB_UI_ORDERBOOK_LEVELS`; the shards ran with the repo `.env`
    value 10 (= engine default). Any recut must pin it.
  - The one-shot property remains procedural (coverage gate + this
    file's rules); a scan-side mechanical read-once guard was considered
    and skipped — the frozen tool must not be edited pre-read, and the
    honor-system scope here is a single session with the rule written.

- **Amendment 3 (session 65, pre-read — D53):** the candidate-branch
  fresh-screen sample rule in §6 ("post-discovery markets or a fresh
  random draw from the reserve-free region") is frozen to ONE mechanical
  rule: a uniform random draw of N from the reserve window
  `--from-ms 1772323200000 --to-ms 1777237199999 --random --limit N`
  (N per D49 sizing with the E26c discount). Rationale, CONFIRM-010
  non-interference argument, and rejected alternatives in DECISIONS D53.
  Frozen while shards were still running, before any log line or outcome
  was read.

## 7. Results (append-only, written after the one-shot read)

_Read session 65, 2026-07-11. Pre-read gates: all 6 shards exited clean;
`signal3-coverage.sh` printed COVERAGE CLEAN (loaded=8,516 completed=8,516
failures=0, fillMkts=8,130, 0 epochs ≥ discovery boundary, staleness
mean 0.03s / 4 rows >10s). One-shot read executed once; output verbatim:_

```
parsed 8130 primary fills across 8130 markets (0 malformed, 0 later-fill rows excluded, 0 non-maker first fills excluded, 0 price-range excluded; 8130 markets emitted any fill line)
quote attribution: 8130/8130 attributed (0 sentinel rows excluded from qAgeSec/qMidDrift tests only)
outcome joined for 8130/8130 fills (0 missing/unresolved — excluded)
gate G1: n=4 < 30 high-price fills — gate vacuous (disclosed)
gate G2: mean residual -1.012c z=-1.87 (n=8130)

=== MONOTONE SCREEN (Spearman feature vs residual, Stouffer across fill-price strata; CANDIDATE |z|≥3.50, WARM |z|≥3.00) ===
  move60 z=+3.06 [LO:271,MID:7171,HI:688] WARM
  firstMid z=-2.50 [LO:271,MID:7171,HI:688]
  l10Imb z=-2.47 [LO:271,MID:7171,HI:688]
  posR z=+2.45 [LO:271,MID:7171,HI:688]
  fElapsed z=-2.09 [LO:271,MID:7171,HI:688]
monotone screen: 0 CANDIDATE, 1 WARM of 21 tests (|z|<2 suppressed from listing)

=== CELL GRID (feature quintiles within (stratum, feature); CANDIDATE |z|≥4.20) ===
  LO l1Imb q5 d=-15.57c z=-3.16 n=54 warm
  LO crossedN q1 d=-16.19c z=-3.57 n=58 warm
  MID l10Imb q5 d=-5.54c z=-4.30 n=1435 CANDIDATE
  MID posR q2 d=-4.91c z=-3.70 n=1398 warm
  HI qAgeSec q2 d=10.74c z=+3.39 n=150 warm
  HI vol q2 d=10.44c z=+3.18 n=135 warm
cell grid: 1 CANDIDATE, 5 warm (|z|≥3) of 295 evaluated cells

=== FILL SEASONALITY (hour-of-day 4h bins + day-of-week, UTC; CANDIDATE |z|≥4.20) ===
fill seasonality: 0 CANDIDATE

scan complete — interpretation rules are frozen in knowledge/SIGNAL-FILLS.md (map-grade only)
```

### Verdict (mechanical, per §6 + amendment 1)

**ONE cell-grid CANDIDATE: MID stratum × l10Imb q5 (d=−5.54c, z=−4.30,
n=1,435).** Monotone family: 0 candidates (move60 WARM +3.06, recorded).
Seasonality: 0 candidates. The candidate branch of §6 fires.

- **Gate (amendment 1b, cell-grid-only candidate):** exclude exactly the
  flagged cell — fills whose price falls in the MID stratum [0.35, 0.65]
  AND whose pre-fill `l10Imb` lies in that stratum's top quintile. Nothing
  else. `l10Imb` is computed by the fixture's own tick code path →
  GATEABLE per amendment 1c. (Sign reading: high UP-book 10-level depth
  imbalance predicts the DOWN buy loses — consistent with the monotone
  l10Imb z=−2.47 direction, below its own bar.)
- **Prediction-line arithmetic (both anchors disclosed):** the frozen §6
  formula assumes the E29 zero anchor: p = 1435/8130 = 0.1765,
  x = 5.54c → complement = +px/(1−p) = **+1.19c/fill**. HOWEVER this
  scan's own measured global anchor is −1.012c (G2 line, z=−1.87, n=8,130
  — statistically compatible with E29's run-472 q̂=+0.33c at N=500 but 16×
  the sample), and under the measured anchor the complement of the flagged
  cell averages (m + px)/(1−p) = **−0.04c/fill** — the candidate cell
  accounts for essentially ALL of the pooled negative drift. Both numbers
  go to the screen's prediction line; the honest point prediction is ≈ 0,
  and the E26c winner's-curse discount applies on top of the −5.54c cell
  estimate itself. The screen's frozen D49 bars decide, not these numbers.
- **Consequence:** IDEAS #22 stays OPEN pending the fresh screen
  (SCR-009): run-472 cell + the mechanical complement gate, NEW sample
  per amendment 3 / D53 (uniform random reserve-window draw), D18 outcome
  set {kill, escalate}. If that screen kills, the maker family closes for
  good per §6's null branch logic (the gate was the family's last
  arithmetic escape).
- **Warm zones recorded (aiming aids only, not citable):** LO-stratum
  extreme cells are large but tiny-n (|d|≈16c, n≈55); HI qAgeSec/vol q2
  positive cells (≈+10.5c, n≈140) are sub-bar and unstable-n; monotone
  move60 (+3.06) says recent 60s UP-drift mildly predicts BETTER DOWN
  fills — same family as the candidate's sign (fills against drift are
  toxic).
- Judge note: verdict is mechanical against frozen bars (candidate z=−4.30
  vs bar 4.20 — no discretion exercised); per the operator closing-sprint
  directive (STATE 2026-07-11) the optional fresh-context audit of this
  read is SKIPPED — the false-positive protections that remain are the
  frozen bars above and the fresh-sample screen itself, which is the
  binding test.

### §7 addendum — candidate branch resolved (session 65)

SCR-009 (BATCH-004, the mechanical complement gate on a fresh N=2,000
reserve-window draw) was **KILLED**: kept fills −1.96c/share, q̂=−0.0404,
t=−1.81, winRate 0.493 (pooled readout verbatim in BATCH-004 Results).
Per §6, the maker family is now CLOSED FOR GOOD; IDEAS #22 dead; E30
carries the transferable lesson. No further maker screens without an
operator-side instrument change or a D27-confirmed venue-drift fire.
