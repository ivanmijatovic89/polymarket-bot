# LEDGER — experiment registry

One entry per experiment. Spec fields freeze at first evidence
submission (the commit is the timestamp). Judgments append; nothing is
rewritten. Grep here before proposing (dedup rule, EPISTEMOLOGY §4).

Template:

    ## E###-<slug> — <one-line title>
    - **Type:** axis | candidate | probe
    - **Status:** proposed | frozen | running | judged | aborted
    - **Mechanism:** <who pays and why this collects, one sentence>
    - **Knobs:** <param: range (prior citation)>
    - **Coverage:** <explicit from-ms → to-ms, N markets, halves plan>
    - **Execution:** <latency arms, sizing, feeds>
    - **Success criteria (frozen):** <axis: resolution target;
      candidate: EVALUATION gate vector + version>
    - **Kill/stop:** <conditions>
    - **Runs:** <batchUid → submissionUid / runId, appended as submitted>
    - **Judgment:** <appended after results.ts readout; quotes frozen
      criteria + measured numbers + max-of-N labels>
    - **Lesson:** <one line, mandatory at judgment>

---

## E001-smoke — pipeline probe (L0 exit test)
- **Type:** probe
- **Status:** judged
- **Mechanism:** n/a (plumbing probe; never evidence). Proves strategy →
  backtest → DB → results.ts and settles: (1) intent_meta persistence +
  acc reference-vs-clone semantics, (2) maker fill = own px/sz
  (settlement recheck), (3) taker-cross fee reconstruction vs fees_paid.
- **Knobs:** defaults only (shares 6, rungOffset 0.01, requote 0.03,
  maxInventory 30, takerProbe on).
- **Coverage:** 5 markets, search window (explicit from/to via submit).
- **Execution:** sequential, lat 0 (deterministic), jitter 0.
- **Success criteria (frozen):** run persists (backtest_runs row +
  segments + markets); results.ts renders full readout; settlement
  recheck OK on ALL markets; fee reconstruction VALID (|recon−db| ≤
  tol); meta coverage 100% of traded markets; acc semantics decided
  (ref vs clone) from DB contents.
- **Kill/stop:** any criterion fails → fix plumbing, re-run as --r2;
  probe never freezes strategy code.
- **Runs:** run 662 `glab--E001-smoke--smoke--lat0` (5 markets, seq,
  lat0); run 663 `glab--E001-smoke--smoke-r2--lat0` (identical re-run
  after adding acc.dockU/dockD).
- **Judgment (2026-07-17T05:25Z):** ALL frozen criteria PASS.
  (1) Persistence: runs+segments+markets rows written by sequential
  mode; 5 markets, 51 trades (47 maker / 4 taker) both runs —
  determinism confirmed (identical pnlTotal −17.13 across 662/663).
  (2) results.ts full readout renders; segments cross-check OK
  (−3.430 vs −3.426, rounding).
  (3) Settlement recheck OK on ALL markets → maker fills execute at own
  px/sz and buy-only settlement arithmetic is exact.
  (4) Fee reconstruction VALID: |recon−db| $0.01 ≤ tol $0.10; meta
  coverage 100%. Sim share-docking observed on real data (upShares
  35.91 = 36 bought − 0.09 docked by the taker fee).
  (5) acc semantics: REFERENCE — every persisted meta entry carries the
  FINAL accumulator (n=11 on the first order placed at t=77s). Exact
  realized per-fill economics reach the DB; results.ts now prefers acc.
  Probe numbers (NOT evidence): EL −3.47/market on blind 1c-below-bid
  rungs at lat0 — the adverse-subset doctrine illustrated.
- **Lesson:** the shared-accumulator meta channel survives to the DB by
  reference — the lab has an exact per-fill export mechanism with zero
  engine changes; use acc as primary, static metas as fallback.

## E002-baseline — L1 reference: archetype-faithful parity ladder
- **Type:** axis (reference measurement; exempt from championship gates
  per EVALUATION §7 — it calibrates TAIL_K + capital floor for v1.1)
- **Status:** judged
- **Mechanism:** passive two-sided BUY-only maker collects the
  time-separated pair discount (pair cost < $1 across oscillation, KB
  P38); parity keeps the unpaired remainder small so settlement risk is
  bounded; who pays = impatient/uninformed takers hitting resting bids
  (the sim shows only the adverse subset of these — doctrine §3).
- **Knobs (defaults frozen for the reference; sweeps are later axes):**
  clipShares 6; rungOffsets [0.01,0.03] (archetype mass touch..−4c, D2);
  parityTolShares 12 (≈2 clips; archetype 0.1% is sub-clip at this
  scale); pairCostCap 0.99 (2c/pair Dec margin, BRIEF §1); soloCap 0.65
  (band p75); band [0.11,0.85] (p5–p95); startSec 60; stopSec 840
  (final-minute cut, A17); requoteDelta 0.02; maxSharesPerSide 120.
- **Coverage:** full search window (2026-04-01 → 2026-05-31 inclusive,
  ~5,800 markets), NO half-split (single reference variant, no
  selection among arms — E31 rule not triggered).
- **Execution:** BullMQ parallel, local worker(s) from this worktree;
  latency battery lat140 (primary) then lat0/lat500/lat1000; jitter 0.
- **Success criteria (frozen):** (1) all four arms complete with
  validators green (settlement recheck all-OK, meta coverage 100%,
  maker-only confirmed: taker fills = 0); (2) EL measured at 140ms with
  sign determined (|EL| > 2·se) or N ≥ 5,000; (3) weekly table, tails,
  pairing, capital, L-ratios all rendered from results.ts; (4) the
  per-market EL distribution is exported for TAIL_K calibration.
  NOT gated on EL sign — the reference number is the deliverable.
- **Kill/stop:** worker-path failure or validator quarantine → fix
  plumbing, re-run arm as --rN. No result-based stopping.
- **Runs:**
  - lat140: `glab--E002-baseline--full--lat140--017d9a2e-9e00-4fe4-b33e-fad9bf986fb4`
  - lat0: `glab--E002-baseline--full--lat0--74ba35a3-b57c-4120-bdc2-c1d0fb7bf1b0`
  - lat500: `glab--E002-baseline--full--lat500--85ddeb17-ceba-41e6-a929-930775e48cc9`
  - lat1000: `glab--E002-baseline--full--lat1000--f6ee28c3-c7b8-47de-9ed2-7211c086b4d9`
  - NOTE (2026-07-17T06:05Z): producer default LIMIT 1000 truncated each
    arm to the first ~1,000 window markets (≈ Apr 1–11). submit.ts fixed
    (explicit limit).
  - NOTE (2026-07-17T07:40Z): extension of the four chunk runs is
    IMPOSSIBLE — E002's rungOffsets schema (string-only transform) does
    not round-trip the persisted array on --extend re-validation, and
    the file is frozen (no edits on rationalizations). The four chunk
    runs (666 lat0 / 670 lat140 / 667 lat500 / 669 lat1000; 1,000
    markets each, 0 failures) are SUPERSEDED as evidence by fresh
    full-window arms; they remain valid as the first-chunk preview that
    surfaced the churn×latency conversion mechanism (JOURNAL 07:05Z).
    E003's schema fixed to accept both forms (unfrozen at the time).
  - FULL-WINDOW ARMS (the evidence; 5,856 markets each, submitted
    detached at SHA d5574428):
    - lat140: `glab--E002-baseline--fullwin--lat140--b408f76c-6241-4414-a114-9010c788bda3`
    - lat0: `glab--E002-baseline--fullwin--lat0--4a2330ec-d143-4ea6-b75b-6d1d32468f36`
    - lat500: `glab--E002-baseline--fullwin--lat500--2e2406ad-6dee-41eb-bc80-9e16aaa7b45e`
    - lat1000: `glab--E002-baseline--fullwin--lat1000--f711124e-5b20-49b8-8176-4592234efc88`
  - Run ids: **lat0 = 675** (persisted first, 2026-07-17 ~04:45Z; 5,856
    markets, 0 failed, validators green: settlement recheck OK,
    fee-recon diff 0.00, meta coverage 100%, maker-only confirmed).
    lat140/500/1000 still draining at check time.
  - **lat0 PREVIEW** (session 3; full judgment after the battery):
    EL −0.4207 (t −8.52), 0/9 weeks positive, PF 0.75, CVaR5 −6.81,
    maxLose −12.54, pairRate **0.291** with imbalance p50=p90=1.00
    (the median played market ends fully one-sided), avg outlay 6.33,
    EL/$100 −6.65, fills 13,486 maker / 0 taker, REB 0 (raw 0.0403
    under the $1 threshold as sized). Played 84.7%.
- **Judgment (2026-07-17T05:25Z, session 3; EVALUATION v1; runs
  675/678/676/677 = lat0/140/500/1000, 5,856 markets each, 0 failed):**

  Frozen criteria, evaluated verbatim:
  1. "all four arms complete with validators green (settlement recheck
     all-OK, meta coverage 100%, maker-only confirmed: taker fills =
     0)" — arms complete ✓; settlement recheck all-OK ✓ on all four;
     meta coverage 100% ✓; fee-recon VALID ✓ (diffs 0.00/0.31/0.21/
     0.39 vs tol 117). **Maker-only FAILS as written on every latency
     arm**: taker fills 0 / 38,144 / 67,289 / 83,644 at 0/140/500/
     1000 ms. This is not plumbing (kill/stop untriggered) — the
     frozen clause encoded the assumption that a decision-time cross
     guard keeps the strategy maker-only; the measurement refuted the
     assumption. Under latency the book moves during flight and the
     requote stream (requoteDelta 0.02) converts to taker at arrival.
     Recorded as the experiment's central mechanism finding, and the
     criterion miss is quoted, not excused.
  2. "EL measured at 140 ms with sign determined (|EL| > 2·se) or
     N ≥ 5,000" — ✓ both: N = 5,856, t(EL) = −43.5.
  3. "weekly table, tails, pairing, capital, L-ratios rendered" — ✓
     (readouts above/below; L-ratios undefined per §4 since
     EL(140) < 0 — degradation ratios quoted descriptively instead).
  4. "per-market EL distribution exported for TAIL_K calibration" — ✓
     (logs/exports/e002-fullwin-lat140.csv, 5,856 rows → calibrate.ts
     table → EVALUATION v1.1 + DECISIONS D-007).

  The battery (EL $/market, era-corrected; REB under $1 threshold at
  this sizing in all arms — raw 0.04–0.24 scale diagnostic):

  | arm | EL | t | PF | CVaR5 | maxLose | pairRate | imb p50 | outlay | EL/$100 | fills m/t |
  |-----|-----|-----|------|--------|---------|----------|---------|--------|---------|-----------|
  | lat0 | −0.4207 | −8.5 | 0.75 | −6.81 | −12.5 | 0.291 | 1.00 | 6.33 | −6.65 | 13,486/0 |
  | lat140 | −4.3904 | −43.5 | 0.22 | −20.65 | −72.1 | 0.644 | 0.187 | 54.62 | −8.04 | 74,111/38,144 |
  | lat500 | −5.0288 | −40.3 | 0.24 | −26.64 | −67.9 | 0.677 | 0.159 | 68.29 | −7.36 | 72,195/67,289 |
  | lat1000 | −5.3047 | −37.8 | 0.27 | −29.40 | −70.5 | 0.689 | 0.144 | 74.08 | −7.16 | 67,791/83,644 |

  Weekly: 0/9 weeks positive in EVERY arm (all 36 arm-weeks negative);
  weekly EL band at lat140: −3.65 (W20) to −5.38 (W14) — a steady
  bleed, no regime dependence, no single-week blowup driving the mean.

  Findings (mechanism-level):
  1. **The frictionless floor loses.** At lat0 the fee-free maker
     stream alone is EL −0.42/market (t −8.5) — under worst_queue,
     shallow blind rungs ([−1c,−3c]) collect the adverse subset and
     the collected pair discount does not cover the one-sided
     remainder's settlement losses. Conservative-floor caveat: real
     books would also grant benign touch fills (D2: worst_queue admits
     44–49% of real fills), so live EV at lat0 is better than −0.42 —
     but the SIGN of the sim reference is negative and stable.
  2. **Latency does not degrade this design — it replaces it.** The
     0→140 ms jump multiplies fills 8.3× (13.5k → 112k) and costs
     +$3.97/market; 140→1000 ms adds only +$0.91 more. At every
     nonzero latency the strategy becomes majority-churn: cancels lag,
     dead rungs get hit, replacement quotes cross as takers (34%/48%/
     55% of fills at 140/500/1000 ms). The era-fee correction on those
     conversions (−$0.39/market at 140 ms) is minor next to their
     adverse prices. The charter's latency-robustness bar is
     unreachable for ANY high-churn requote design of this shape —
     requote discipline (standing ladders, wide requote deltas, or
     requote bans) is promoted to a first-class axis (E005 scope,
     already in backlog).
  3. **Pairing under latency is manufactured, not captured.** lat0
     pairRate 0.291 with imbalance p50 = 1.00: the shallow ladder
     almost never genuinely completes a pair — the median played
     market ends fully one-sided. The apparent pairRate 0.64–0.69 in
     latency arms is churn conversions "completing" pairs at bad
     prices (pay 156 bps sim / era curve corrected, still lose). The
     archetype's real pairing engine (KB: pairRate 0.78 at pair cost
     0.964–0.976, A30) must come from deeper placement + patient
     completion, not from latency accidents. E003 (parity axis) and
     E005 (ladder shape + deep-pair cell) carry this question.
  4. **Capital scale-up under churn is pure downside**: avg outlay
     6.33 → 54.6–74.1 (lat0 → latency arms) while EL/$100 stays −6.7
     to −8.0 everywhere. No sizing tweak rescues this design.

  Verdict (EVALUATION §8 vocabulary): **AXIS-CLOSED** — the
  archetype-faithful shallow-requote region is DEAD at all latencies
  (EL < 0, t ≤ −8.5, 0/36 arm-weeks positive, N = 5,856, selection
  width 1 — no cherry-pick possible). L1's reference number is set:
  **EL(140) = −4.39/market**; the frictionless bound is −0.42. Every
  future variant must beat these on the same window/battery. Claims
  lean on worst_queue (adverse subset; conservative for maker EV) and
  all-or-nothing fills (sim size lies; no capacity claims).
- **Lesson:** requote churn × latency converts a passive maker into an
  involuntary taker — quote-stability is a design axis, not an
  execution detail; and shallow rungs don't pair (imb p50 1.00 at
  lat0), so the pair discount must be engineered at depth, not
  harvested from noise.

## E003-pair-accumulator — the L2 workhorse strategy + parity axis
- **Type:** axis
- **Status:** frozen (2026-07-17T05:50Z, session 3, at launch; spec
  below verbatim from the draft; strategy file unchanged since 45a2e32
  — the determinism smokes 672/673/674 ran exactly this code)
- **Mechanism:** same as E002 but with ALL campaign knobs parameterized
  in ONE file (`glab.E003-pair-accumulator`): relative parity tolerance
  (pct of total shares, floored at 2 clips to avoid cold-start
  deadlock), ladder shape (offset list incl. deep rungs), completion
  policy (maker-only | taker-cap≤X | taker-free), time weighting
  (uniform | back-loaded 8–13 | open-avoid), band, caps. Axis sweeps
  are then params-only experiments on this frozen file (same-code
  comparisons; the maker-fill stream cancels in rankings).
- **First axis (this experiment):** parityTolPct ∈ {0.1, 2, 10, 20, 40}%
  (handoff seed-1 grid; archetype 0.1% vs current winners 20–40%),
  completion=maker-only, ladder/timing at E002 defaults.
- **Draft amendment (2026-07-17T05:35Z, pre-freeze):** completion path
  hardened after fresh-eyes review — completionTtlSec knob (default 10)
  cancels a missed cross instead of letting it rest forever (it blocked
  all later completions and could fill in the endgame); crosses now
  also cancel at gate-close. Axis-1 arms (maker-only) are unaffected;
  smoke 668's pairRate 0.73 pre-dates this code and E004 must re-smoke.
- **Coverage plan:** two disjoint halves inside the search window
  (E31 rule — this IS a selection among >3 arms): h1 = Apr 1–30,
  h2 = May 1–31, lat 140 only for the axis; battery on the winner
  region later.
- **Advance rule (precise):** (a) the direction of the parity response
  (EL vs parityTolPct, sign of the fitted monotone trend) agrees across
  halves; (b) the top-2 arms by EL are the same SET in both halves.
  Both hold → the agreeing region seeds E004/E005 defaults. Either
  fails → verdict "axis unstable at this coverage"; no arm advances on
  a single-half ranking.
- **Success criteria (freeze-ready; freezes verbatim at submit):**
  (1) all 10 runs complete, validators green (G9 fee-recon, settlement
  recheck, meta coverage 100%); (2) per-arm, per-half readout rendered:
  EL±se, TRADE_corr, REB(+raw), fills maker/taker, conversion share
  (taker fills / all fills — churn exposure), pairRate, imbalance
  p50/p90, avg outlay; (3) adjacent arms distinguished (|ΔEL| > 2·se_diff)
  or declared indistinguishable; (4) the advance rule evaluated as
  written. NOT gated on EL sign (axis experiments face only G2/G3/G9).
- **Sizing note:** clip 6 kept (same-code comparability with the E002
  reference; REB will sit under the $1/market floor at this scale —
  reported with rebRaw as the scale counterfactual). Candidate-grade
  confirmation re-runs at EVALUATION §2 sizing come after the axis
  program; that re-run is where rebate-threshold realism binds.
- **Launch plan (10 detached submissions via submit.ts; suffix encodes
  pct*10 since dots are banned in suffixes):** for (tol, code) in
  {0.1:p001, 2:p020, 10:p100, 20:p200, 40:p400}:
  - h1: `npx tsx gabagool-lab/tools/submit.ts --exp E003-pair-accumulator
    --suffix ax1h1-<code> --strategy glab.E003-pair-accumulator
    --window 2026-04-01T00:00:00Z..2026-04-30T23:59:59.999Z --lat 140
    --param parityTolPct=<tol> --detach`
  - h2: same with ax1h2-<code> and
    `--window 2026-05-01T00:00:00Z..2026-05-31T23:59:59.999Z`
  (completionMode default none; all other knobs at file defaults =
  E002 values; ~5,856 market jobs total across the 10 runs.)
- **Runs (launched 2026-07-17T05:23Z real / recorded 06:0xZ, session 3,
  SHA 3d707855; h1 = 2,880 mkts, h2 = 2,976 mkts each):**
  - ax1h1-p001: `…--ax1h1-p001--lat140--e9406593-e38d-4007-9cf3-1d83e1e95940`
  - ax1h1-p020: `…--ax1h1-p020--lat140--47d8d807-554b-40bb-be36-185246646fbf`
  - ax1h1-p100: `…--ax1h1-p100--lat140--69230ee8-55f4-4196-9a13-ae58225dea6e`
  - ax1h1-p200: `…--ax1h1-p200--lat140--69c490e3-3366-4468-b135-cb473841c744`
  - ax1h1-p400: `…--ax1h1-p400--lat140--89df8889-0699-44b5-b8d4-ffb7b5b840ce`
  - ax1h2-p001: `…--ax1h2-p001--lat140--41e1826e-fed4-4277-93e9-c6d161baab27`
  - ax1h2-p020: `…--ax1h2-p020--lat140--b68867c5-f215-4c3a-8258-3d54d1ab64c7`
  - ax1h2-p100: `…--ax1h2-p100--lat140--ee8fa12b-4d2a-4d8b-84d9-00541575eb59`
  - ax1h2-p200: `…--ax1h2-p200--lat140--d0fddbb5-ba81-4328-8e6d-0077f3d7c020`
  - ax1h2-p400: `…--ax1h2-p400--lat140--b9aa0f33-4ce4-4969-b4c0-4ff34b165e85`
  - INCIDENT (2026-07-17T05:24Z): a sloppy verification one-liner
    re-invoked launch-e003.sh with a stray flag; submit.ts tolerated
    it → all 10 flows DOUBLE-submitted (~29k duplicate market jobs).
    Cleanup: tools/dedupe-flows.ts (new) removed 9 duplicate flows
    parent-first; the 10th (ax1h2-p400 dup) was promoted by a
    children-first removal attempt and aggregated empty by the
    operator's aggregate worker → **run 679 = labeled-failed tombstone
    (m=0, f=2976), not evidence; ignore**. Its DB row is
    pipeline-written and stays (charter: no manual DB writes).
    Hardening: submit.ts now REFUSES unknown flags; launch-e003.sh
    accepts only --dry-run and refuses to run if E003 flows are
    already queued. The 10 runs above are the SOLE evidence set.
- **Judgment (2026-07-17T06:31Z, session 11, runs 681–690; h1 = Apr
  2,880 mkts, h2 = May 2,976 mkts, lat 140, clip 6, maker-only,
  selection width 5 arms):**

  Frozen criteria, evaluated verbatim:
  1. "all 10 runs complete, validators green" — ✓ all: 0 failed
     markets on every run; settlement recheck all-OK; fee-recon VALID
     (diffs 0.01–0.26 vs tol 57.6/59.5); meta coverage 100%; segments
     cross-check OK; G2 PASS (played 99.5% everywhere); G9 PASS; G3
     n/a (no quoted win rate > 0.9). Run 679 tombstone excluded as
     pre-registered.
  2. "per-arm, per-half readout rendered" — ✓ (table below).
  3. "adjacent arms distinguished or declared indistinguishable" — ✓:
     ONLY h1 20-vs-40 is adjacent-distinct (|Δ| 0.657 > 2·se_diff
     0.568); all other adjacent pairs indistinguishable in both
     halves. ENDPOINTS (0.1 vs 40) are DISTINCT in BOTH halves
     (h1 |Δ| 1.007 > 0.537; h2 0.646 > 0.492) → per u17b rule 1:
     measurable direction, insufficient in-between resolution —
     endpoint-direction reporting, no interpolation.
  4. "advance rule evaluated as written" — (a) trend sign −1 in both
     halves: HOLDS; (b) top-2 by EL = {0.1, 2} in both halves: HOLDS
     → BOTH HOLD; the agreeing region seeds E004/E005 defaults.

  Axis table (EL $/market era-corrected; REB raw 0.23–0.31 all under
  the $1 threshold — scale diagnostic only):

  | tol% | half | run | EL | t | taker% | pairRate | imb p50 | outlay | CVaR5 |
  |------|------|-----|-----|-----|--------|----------|---------|--------|-------|
  | 0.1 | h1 | 686 | −4.5656 | −30.7 | 33.9 | 0.657 | 0.175 | 56.82 | −21.46 |
  | 2   | h1 | 682 | −4.5656 | −30.7 | 33.9 | 0.657 | 0.175 | 56.82 | −21.46 |
  | 10  | h1 | 684 | −4.6612 | −30.6 | 33.9 | 0.655 | 0.176 | 57.70 | −21.96 |
  | 20  | h1 | 687 | −4.9153 | −28.1 | 33.3 | 0.646 | 0.222 | 62.08 | −24.43 |
  | 40  | h1 | 689 | −5.5724 | −25.0 | 32.4 | 0.629 | 0.264 | 68.95 | −32.04 |
  | 0.1 | h2 | 681 | −4.2209 | −30.8 | 34.0 | 0.632 | 0.199 | 52.49 | −19.75 |
  | 2   | h2 | 683 | −4.2209 | −30.8 | 34.0 | 0.632 | 0.199 | 52.49 | −19.75 |
  | 10  | h2 | 685 | −4.2642 | −30.6 | 33.8 | 0.630 | 0.199 | 53.08 | −20.11 |
  | 20  | h2 | 688 | −4.4698 | −27.2 | 33.7 | 0.621 | 0.230 | 56.99 | −23.09 |
  | 40  | h2 | 690 | −4.8666 | −23.8 | 32.8 | 0.605 | 0.289 | 63.08 | −28.89 |

  Findings (mechanism-level):
  1. **The floor ties the axis's left end and reproduces E002
     exactly.** p001 ≡ p020 bit-identical per half (2% of max total
     240 shares = 4.8 < the 12-share floor ⇒ both arms ARE the
     floor), and the p001 pair over h1+h2 IS E002-fullwin-lat140 to
     the fill: 74,111 maker + 38,144 taker fills, weighted EL
     −4.3904. Full-scale same-code determinism demonstrated from an
     independently written file; the axis's tight end = the L1
     reference, reproduced.
  2. **Loosening parity monotonically worsens EL, and the channel is
     directional inventory, not completion churn.** Taker share is
     flat-to-slightly-down (33.9→32.4 h1; 34.0→32.8 h2) while fills
     RISE (57.2k→70.9k h1 total) — u17b mechanism (a), not (b). The
     extra fills the loose gate admits end unpaired: pairRate falls
     (0.657→0.629; 0.632→0.605), imbalance p50 rises (0.175→0.264;
     0.199→0.289), tails deepen (CVaR5 −21.5→−32.0; −19.7→−28.9),
     outlay rises (56.8→69.0; 52.5→63.1). Marginal economics at h1
     tol 40 vs floor: ~13.7k extra fills cost ~$2.9k ≈ −21c/fill —
     the parity gate was the only thing refusing adverse one-sided
     accumulation.
  3. **Honesty note on the top-2 set match:** it holds mechanically,
     but the top-2 is an exact tie (floor≡floor), and tol 10 is
     indistinguishable from the floor in both halves (Δ ≤ 0.096 vs
     2·se_diff ≥ 0.39). The defensible region statement: tol ≤ 10
     (floor-dominated) indistinguishable from floor; tol ∈ {20, 40}
     measurably worse. The seed is the FLOOR REGION, not a point.
  4. **SEED = parityTolPct 2** (from the tied top-2): identical
     evidence to 0.1 at this scale, less degenerate encoding (scales
     as a true relative tolerance if sizing ever grows; 0.1% is
     hard-floored forever). E004 control pair = runs 682/683
     (batchUids recorded in §E004 at freeze).

  Verdict (EVALUATION §8): **AXIS-CLOSED** — parity tolerance has a
  measured direction (tighter is better; endpoints distinct in both
  halves) and NO payable region at this cell: the best arm is the
  floor and the floor is the L1 reference, EL −4.39 (window Apr–May,
  lat 140, sel-width 5, worst_queue adverse-subset caveat). Loose
  parity {20, 40} is a dead sub-region (ΔEL −0.25 to −1.01/mkt vs
  floor, CVaR5 down to −32). Parity tolerance cannot rescue the
  shallow ladder; it can only cap the damage. Pair creation must come
  from depth (E005), completion policy (E004), or timing (E006).
- **Lesson:** parity tolerance is a brake, not an engine — every
  loosening beyond the floor buys adverse one-sided inventory
  (−21c per marginal fill at tol 40) with zero pairing gain, so tune
  it as a risk cap AFTER an edge exists, never as an edge source; and
  a relative-tolerance knob whose floor binds at the whole tested
  scale is really a constant — design axes so arms differ in the
  regime the sizing actually reaches (LS-6).

## E004-completion-policy — H6 axis (the margin knob)
- **Type:** axis
- **Status:** frozen (2026-07-17T06:35Z, session 11, at launch; SEED
  slot filled from the E003 judgment — parityTolPct = 2; everything
  else verbatim from draft amendment 2. Control pair (NOT
  resubmitted, per the amendment): run 682 =
  `glab--E003-pair-accumulator--ax1h1-p020--lat140--47d8d807-554b-40bb-be36-185246646fbf`,
  run 683 =
  `glab--E003-pair-accumulator--ax1h2-p020--lat140--b68867c5-f215-4c3a-8258-3d54d1ab64c7`)
- **Mechanism:** on the E003 file: completion ∈ {maker-only,
  taker-cap pair≤0.99, taker-cap pair≤0.97, taker-free}; cross the
  lagging leg only when projected pair cost + ERA fee stays under the
  cap (fee-aware crossing: prefer completions far from the p=0.5 fee
  peak — the b55f-vs-0xce25 2%/turnover gap, H6). Sim ranks these
  exactly (same maker stream); corrected fees via acc.
- **Prior:** H6 kill criterion — if the completion-policy spread on
  identical maker fills is <0.3% of turnover, the live gap was book-mix
  or timing, not policy.
- **Fee basis (pre-freeze note, A32):** verdicts must state they price
  the COLD-START taker leg (tier-0 ≈ full era curve, no refunds —
  TRADE_corr's existing assumption, conservative within 3%);
  incumbents' observed completion economics are 1.5–3.5%-of-taker-
  notional better and must not be used to justify a marginal arm.
- **Re-smoke (2026-07-17T06:20Z, run 680, NOT evidence):** 10 markets
  sequential, lat140, completionMode=cap: crosses issue and fill
  ('x' metas with px recorded), 126m/99t fills, pairRate 0.724,
  rej=0, settlement recheck OK, fee-recon VALID, meta coverage 100%.
  The u9 TTL/gate-close code path functions at cap-mode under latency
  (672 smoke-ttl covered basic TTL at 45a2e32). E004 may freeze.
- **Draft amendment 2 (2026-07-17T05:50Z, s4 u19, pre-freeze — arms, control reuse,
  criteria, advance rule; pre-registered BEFORE any E003 axis numbers
  exist; the only slot filled at freeze is SEED):**
  - **Arms (precise):** on the frozen E003 file at parityTolPct = SEED
    (E003's agreeing region, else file default 10): completion ∈
    {none (control), cap 0.99, cap 0.97, free} × halves {h1 Apr,
    h2 May}, lat140, clip 6, jitter 0. The `none` control is NOT
    resubmitted — it IS the E003 run pair at parityTolPct=SEED
    (identical file/params/window/lat; determinism basis: det smokes
    673≡674 + u17b p001≡E002 4-dp; the two batchUids are recorded
    here at freeze). 6 new runs (~3.5k jobs) via
    `tools/launch-e004.sh --tol SEED` (LS-3 hardened: --tol/--dry-run
    only, refuses off-grid seeds and queued ax2 flows).
  - **Success criteria (freeze-ready; freezes verbatim at submit):**
    (1) all 6 new runs complete, validators green (G9 fee-recon,
    settlement recheck, meta coverage 100%); (2) per-arm×half readout:
    EL±se, TRADE_corr, REB(+raw), fills maker/taker, taker share,
    crosses issued/filled ('x' metas), share of completed pairs closed
    by cross, avg completed-pair cost incl. fee, taker fees paid (acc),
    pairRate, imbalance p50/p90, avg outlay; (3) policy spread per
    half: max−min EL across the 4 arms, absolute and as % of arm
    turnover — H6 pre-registered read: spread < 0.3% of turnover in
    BOTH halves ⇒ "H6 refuted at this cell: completion policy is not
    the margin knob; the live b55f-vs-0xce25 gap was book-mix/timing";
    (4) adjacent arms (ordering: none < cap0.97 < cap0.99 < free, by
    completion aggressiveness) distinguished at |ΔEL| > 2·se_diff or
    declared indistinguishable. Rule evaluation is by explicit 8-cell
    table (set-match + sign agreement; no OLS trend needed).
  - **Advance rule (precise):** (a) top-2 of the 4 arms by EL are the
    same SET in both halves; (b) for each non-`none` member of that
    top-2, sign(EL(arm) − EL(none)) agrees across halves. Both hold →
    the winning policy becomes the completion default for
    candidate-grade confirmation runs (EVALUATION §2); E005 stays
    maker-only by design (axis isolation). Either fails → "axis
    unstable at this coverage"; candidate confirmations run maker-only,
    stated.
  - **Mechanism split (pre-registered):** any EL difference is
    decomposed into Δ(locked-pair value from crosses) vs Δ(taker fees
    paid) vs Δ(completion px adversity). EL(free) < EL(none) with high
    cross counts ⇒ completion pressure buys tops (H6 fail direction);
    EL(cap) > EL(none) with few crosses ⇒ selective completion works
    only far from the fee peak. Quote the cap arms' realized
    completion-px distribution either way.
- **Runs (launched 2026-07-17T06:36Z, session 11, SHA 77195ba9 = the
  freeze commit; 6 flows, h1 = 2,880 mkts, h2 = 2,976 each; control
  arm = E003 runs 682/683, uids in Status above):**
  - ax2h1-c990: `…--ax2h1-c990--lat140--ffcaa9e2-4683-4eed-9a2e-3e2dbb2ab39f`
  - ax2h2-c990: `…--ax2h2-c990--lat140--c4d5e5c3-9dd4-49ef-a44b-edf19e897634`
  - ax2h1-c970: `…--ax2h1-c970--lat140--25b98901-f939-4846-9a79-bbb6c9ef1748`
  - ax2h2-c970: `…--ax2h2-c970--lat140--0f57c911-a12a-4b94-a437-2bb1ef543b10`
  - ax2h1-cfree: `…--ax2h1-cfree--lat140--90fda871-e315-4dc0-8d85-34aa7228dbca`
  - ax2h2-cfree: `…--ax2h2-cfree--lat140--5fcd4e00-1f34-44f8-a016-bc2012e6beb7`
  (verified read-only via agg-inspect.ts post-launch: 6
  waiting-children flows, all at SHA 77195ba9; markets queue 17,461
  waiting + 12 active ≈ the expected 17,568 jobs; no double-submit.)
- **Judgment (2026-07-17T07:35Z, session 12, unit 33): H6 SURVIVES —
  completion policy IS a margin knob (spread ≈ 2% of turnover, 6.6–7.5×
  the kill line). Free completion is the strongest lever measured in
  the lab so far (+1.10/+0.87 $/mkt vs control, DISTINCT in both
  halves); cost-capped completion is dead. The frozen advance rule
  FAILS on the tied middle of the ranking, so no completion default is
  exported: candidate confirmations run maker-only, stated.**
  - **Identity check first:** all 6 new runs completed 0-failed; runs
    691–696 submission uids match the frozen launch uids to the digit
    (verified via DB query u33); control = runs 682/683 as frozen.
  - **Validators (criterion 1): green ×6** — settlement recheck OK
    (all markets); fee-recon |recon−db| ≤ 0.27 vs tol ≥ 57.60 → VALID,
    meta coverage 100% every run; segments cross-check OK (max drift
    0.0046, run 691).
  - **8-cell readout (criterion 2; e004-table.ts, arm=run h1/h2):**
    - none (682/683): EL −4.5656±0.1487 / −4.2209±0.1371; taker 33.9/
      34.0%; pairRate 0.657/0.632; imb p50 0.175/0.199, p90 1.000 both;
      outlay 56.82/52.49; xN 0; conv 19,385/18,759; fills m/t
      37,767/19,385 and 36,344/18,759; tFee$ 0.630/0.583; S 0.9767/
      0.9696; REB 0 (raw 0.2478/0.2278).
    - c970 (692/693): EL −4.4642±0.1458 / −4.3580±0.1299; taker 39.2/
      39.3%; pairRate 0.674/0.650; imb p50 0.158/0.176, p90 1.000;
      outlay 60.46/56.83; xN 5,032/5,120 (xSh 30,192/30,720; x-px
      p10/50/90 0.31/0.58/0.80 and 0.37/0.60/0.82; xFee$ 453/462);
      conv 18,740/18,217; tFee$ 0.768/0.717; S 0.9813/0.9772; x/paired
      0.097/0.102.
    - c990 (696/691): EL −4.6639±0.1352 / −4.6054±0.1152; taker 46.5/
      45.4%; pairRate 0.702/0.674; imb p50 0.142/0.148, p90 1.000;
      outlay 66.12/60.79; xN 13,214/11,848 (xSh 79,284/71,088; x-px
      0.38/0.57/0.78 and 0.38/0.59/0.80; xFee$ 1,231/1,093); conv
      17,709/17,019; tFee$ 1.004/0.893; S 0.9846/0.9816; x/paired
      0.229/0.219.
    - cfree (694/695): **EL −3.4665±0.0797 / −3.3541±0.0682** (t −43.5/
      −49.2); taker 52.0/50.6%; **pairRate 0.860/0.848; imb p50
      0.098/0.111, p90 0.335 both (every other arm p90 = 1.000)**;
      outlay 58.26/54.42; xN 18,221/16,854 (xSh 109,326/101,124; x-px
      0.44/0.66/0.84 and 0.45/0.67/0.84; xFee$ 1,579/1,452); conv
      11,801/11,603; fills m/t 27,736/30,022 and 27,777/28,457; tFee$
      0.909/0.822; **S 1.0207/1.0188 (completed pairs locked ABOVE
      $1)**; x/paired 0.352/0.339. REB 0 in all 8 cells (raw ≤ 0.25).
    - Crosses ISSUED are not persisted for unfilled orders (no meta);
      issuance path verified by smoke 680 (39 filled / 60 issued).
  - **H6 spread (criterion 3):** h1 max−min EL = 1.1974 $/mkt on
    turnover 60.12 → **1.992%**; h2 = 1.2513 on 55.87 → **2.240%**.
    Both ≥ 0.3% ⇒ H6 SURVIVES at this cell: completion policy moves
    EL by ~2% of turnover on an identical maker stream — same order as
    the live b55f-vs-0xce25 2%/turnover gap it was drawn from.
  - **Adjacency (criterion 4, frozen order none<c970<c990<cfree):**
    none↔c970 indistinguishable (|ΔEL| 0.10/0.14 vs 2·se 0.42/0.38);
    c970↔c990 indistinguishable (0.20/0.25 vs 0.40/0.35); c990↔cfree
    **DISTINCT both halves** (1.1974 vs 0.3140; 1.2513 vs 0.2678).
  - **Advance rule: FAILS.** h1 top-2 {cfree, c970}, h2 top-2 {cfree,
    none} → set mismatch; sign(EL(c970)−EL(none)) flips (+ h1, − h2).
    Frozen consequence applied verbatim: axis unstable at this
    coverage; **candidate confirmations run maker-only, stated.** The
    instability is confined to the statistically tied middle (all
    none/c970/c990 pairwise |ΔEL| < 2·se_diff); the winner is distinct
    and direction-stable. Interpretation boundary recorded as D-008;
    rule-design lesson LS-8.
  - **Mechanism split (pre-registered; e004-decomp.ts, exact additive
    identity EL = pair + rem − cost − fee, asserted per-run vs
    canonical EL):**
    - cfree−none: h1 **Δpair +3.7899, Δrem −0.9839, Δcost +1.4301,
      Δfee +0.2768 → ΔEL +1.0991**; h2 +4.0527 / −1.0281 / +1.9190 /
      +0.2388 → +0.8668.
    - c990−none: h1 Δpair +9.9602 vs Δcost +9.2548, Δfee +0.3714 →
      −0.0983; h2 +8.6094 / +8.2545 / +0.3087 → −0.3845 (Δrem −0.43
      both). Caps buy pair volume at break-even-to-losing prices.
    - c970−none: ΔEL +0.1014/−0.1371 — noise.
    - **Neither pre-registered pattern matched.** EL(free) > EL(none)
      DISTINCT with HIGH cross counts and S > 1: free completion pays
      ~2c/pair over $1 plus fees, and still wins because of what it
      REMOVES — maker fills −26.6%/−23.6% (37,767→27,736;
      36,344→27,777), involuntary latency conversions −39%/−38%
      (19,385→11,801; 18,759→11,603), imbalance p90 1.000→0.335. In an
      adverse-selection-dominated book the marginal passive fill has
      negative EV (E002/E003), so completing the pair early both locks
      a bounded −2c and shuts down the bleeding channels. Caps are the
      same knob pointed backwards: they cross only when the projected
      pair is already cheap (situations that were fine — their maker
      stream stays ≈ control: 36,914/36,090 maker fills) and hold
      exactly the adverse inventory; hence caps ≈ none. Cap px
      distributions quoted above (criterion: either way).
    - **Winner-remainder giveaway (new, seeds backlog):** cfree
      forfeits Δrem ≈ −0.98/−1.03 $/mkt by pairing inventory whose
      unpaired remainder would have redeemed as winner. A completion
      policy that crosses only when the HELD leg lags fair value
      (binance spot is replayable NOW) keeps the removal benefit and
      the winning remainders — upper bound ≈ +1 $/mkt over cfree.
      Seeded as E-completion-selective in backlog.
  - **Fee basis (per freeze note):** all cells price the cold-start
    tier-0 era curve. cfree cross notional ≈ $25/mkt → incumbent
    completion economics are ~$0.38–0.88/mkt better still; orderings
    within this experiment are unaffected (identical basis), the true
    live gap of cfree narrows further.
  - **Where this leaves the ladder:** best measured cell is now cfree
    at EL −3.47/−3.35 (sel-width 4, axis-grade, half-windows) vs the
    E002 reference −4.39 — the gap to zero narrowed ~24% but the
    concept is still paying ~6%/market of outlay to trade. No gate
    vector was run (axis experiment; G2/G3/G9 only per spec).
  - **Lesson: LS-7 (completion value = removal, not pair cheapness)
    and LS-8 (advance rules must test the decision-relevant partition,
    not full-ranking stability among statistical ties). E005 proceeds
    maker-only as designed (axis isolation); completion returns via a
    frozen candidate spec only (D-008).**

## E005-ladder-depth — ladder shape × the deep-pair cell
- **Type:** axis
- **Status:** frozen (2026-07-17T07:45Z, session 12, at shape-arm
  launch; spec + both pre-freeze amendments below verbatim — nothing
  filled at freeze beyond what u29/u31 pre-registered. parityTolPct
  = 2 (E003 judgment u27) — floors to 12 shares at clip 6 in every
  arm, a constant BY DESIGN; completion = none in every arm, axis
  isolation per §E004 (judged u33: candidate confirmations
  maker-only — E005's isolation choice is now doubly grounded).
  Shape sub-axis = 6 new runs (amendment 2) + reference reuse of
  E003 runs 682/683; cap arms (ax4) gated behind the shape
  sub-judgment + bind-table decision.)
- **Mechanism:** placement depth is the pair engine (LS-2: shallow
  rungs end the median market fully one-sided; churn, not oscillation,
  "pairs" them). Deeper rungs fill on real oscillation only — fewer,
  better fills, larger locked discount per completed pair, and a
  standing-ladder character that reduces requote churn (LS-1). The
  deep-pair cell targets the region where the ONLY known
  trading-profitable parity wallets live: pair cost 0.95–0.976
  (A30 0x04b6d7e9 0.964–0.976; A33 vidarx 0.95–0.976; A32 ohio-house
  0.95@0.968 — n=3 independent existence proofs).
- **Knobs:** rungOffsets ∈ {[0.01,0.03] (E002 ref), [0.02,0.06],
  [0.02,0.13], [0.01,0.02,0.05,0.13] (touch+deep, A17 shape)};
  pairCostCap ∈ {0.99 (ref), 0.98, 0.97, 0.96} on the best rung shape
  — 4 shape arms + 3 deep-cap arms = 7 arms × 2 halves = 14 runs.
  Two-stage inside one experiment: shapes first (8 runs), then caps on
  the winning shape (6 runs) — cap arms are submitted only after the
  shape sub-judgment is written (prevents 14-way selection).
- **Coverage:** halves h1 = Apr, h2 = May (E31 rule; selection among
  >3 arms), lat140 primary; battery (0/500/1000) on the surviving
  region before any candidate promotion.
- **Execution:** BullMQ parallel via submit.ts, clip 6, jitter 0.
- **Success criteria (freeze-ready):** (1) all runs complete,
  validators green; (2) per-arm: EL±se, taker share, pairRate,
  imbalance p50/p90, avg outlay, fills; (3) shape sub-axis: adjacent
  arms distinguished or declared indistinguishable (axis-table.ts);
  (4) advance rule per sub-axis: direction agreement + top-2 set match
  across halves (as E003); (5) deep-cap sub-axis: the pairRate/EL
  trade-off curve measured — does forcing deeper pairs raise EL or
  just lower fill count? NOT gated on EL sign (axis).
- **Kill/stop:** axis closed when both sub-curves measured at planned
  resolution; dead cells recorded in LEADERBOARD dead-regions with
  numbers.
- **Pre-freeze amendment (2026-07-17T06:44Z, s11 u29 — LS-6
  effective-grid pass, done E004-blind during the ax2 drain; written
  BEFORE any E005 data exists):**
  - **Shape arms pass LS-6:** all four rung lists are distinct on the
    2-dp price grid at clip 6 / maxShares 120 — no two collapse (the
    E003 p001≡p020 failure mode is absent). Effective-behavior notes
    that the readout must carry: (a) band suppression is asymmetric —
    a 0.13-offset rung is quotable only when bid ≥ 0.24 (bandLo 0.11),
    a 0.06 rung needs bid ≥ 0.17, so deep arms have smaller effective
    quote windows on the cheap side and (via soloCap 0.65 on px, not
    bid) larger pre-pairing windows on the expensive side — played
    share and fills are first-class shape readouts, not just EL;
    (b) the 4-rung A17 arm rests 24 shares/side/cycle vs 12 for the
    2-rung arms — it tests the archetype ladder AS A PACKAGE (size ×
    depth), while the three 2-rung arms carry the pure-depth
    comparison; the sub-judgment must say which comparison it is
    reading; (c) the 12-share parity floor binds mid-sweep for the
    4-rung arm (one full one-sided sweep = 24 ≥ 12) — same floor,
    different duty cycle; quote suspension counts belong in the
    readout if the mechanism split needs them.
  - **Cap-grid finalization rule (pre-registered; executes AFTER the
    shape sub-judgment, BEFORE cap submission):** the prior grid
    {0.96, 0.97, 0.98} is anchored on live incumbents (A30/A33
    pair cost 0.95–0.976) but pairCostCap binds on the RUNNING
    AVERAGE pair-cost sum, so its bind-mass depends on the winning
    shape. From the shape winner's run pair (both halves, cap 0.99),
    compute per-market final S = avgUp + avgDown from intentMeta
    fills (both-sided played markets only; read-only DB). Define
    bind(c) = share of those markets with S > c. KEEP the prior grid
    iff bind(0.96) − bind(0.98) ≥ 0.15 AND bind(0.98) ≥ 0.05 (each
    arm both binds and passes materially). ELSE replace with
    {round2(P25(S)), round2(P50(S)), round2(P75(S))} restricted to
    S ≤ 0.99, de-collided by ±0.01 steps, clamped to [0.90, 0.99] —
    quartile caps have bind shares ≈ 75/50/25% by construction. The
    computed bind() table and the grid decision are recorded in this
    section before the cap arms are submitted.
  - **Participation caveat (pre-registered):** a cap arm whose played
    share falls below 20% (G2 level) is recorded as "cap chokes
    participation at this shape/sizing" — a measured cliff on the
    pairRate/EL trade-off curve, not a failed experiment; its EL is
    reported but flagged unmeasurable-at-coverage.
- **Pre-freeze amendment 2 (2026-07-17T06:49Z, s11 u31 — reference
  shape reuse + launch plan; still ax2-blind):** the reference shape
  arm ra = [0.01,0.03] at parityTolPct=2 / completion none / lat140 /
  clip 6 is EXACTLY E003 runs 682/683 (same file, same params, same
  windows) — it is NOT resubmitted; the shape table reuses those two
  runs (determinism basis: u17b 4-dp match, u30 to-the-digit
  reproduction; same logic as §E004's control reuse). Shape sub-axis
  therefore submits 6 NEW runs (not 8): suffix grammar
  `ax3h<half>-<code>` with codes rb = [0.02,0.06], rc = [0.02,0.13],
  rd = [0.01,0.02,0.05,0.13] (lowercase per submit.ts kebab rule).
  Launcher: `tools/launch-e005-shapes.sh` (LS-3 hardened: --dry-run
  only, refuses queued ax3 flows; tol/completion hardcoded to the
  judged values — no free knobs). Cap arms will use `ax4` suffixes,
  launched only after the shape sub-judgment + bind-table decision.
  Total new runs for E005: 6 shapes + 6 caps = 12 (was 14).
- **Shape runs (launched 2026-07-17T07:30Z, session 12, SHA 7355c21a
  = the freeze commit; 6 flows, h1 = 2,880 mkts, h2 = 2,976 each;
  ra reference = E003 runs 682/683, reused per amendment 2):**
  - ax3h1-rb: `…--ax3h1-rb--lat140--3d28aed9-7687-44f0-aefb-18b6afc8b0ef`
  - ax3h2-rb: `…--ax3h2-rb--lat140--91d28ace-a361-4b88-93ea-c108006c3210`
  - ax3h1-rc: `…--ax3h1-rc--lat140--51ff68fa-9d58-4007-a62a-63ba68e049c9`
  - ax3h2-rc: `…--ax3h2-rc--lat140--5ebc01d2-5182-4cc0-89ca-5011d20bebae`
  - ax3h1-rd: `…--ax3h1-rd--lat140--1c13e7da-95e2-453a-a8e0-942bc4cd3761`
  - ax3h2-rd: `…--ax3h2-rd--lat140--5acd12f1-a1ef-43a6-b2cd-fd3b354c69dd`
  (verified read-only via agg-inspect post-launch: 6 waiting-children
  flows, all at SHA 7355c21a; markets queue 17,446 waiting + 12
  active ≈ the expected 17,568 jobs; markets failed = 0; the 3
  failed aggregate jobs are the known stale foreign imbalance-hold
  duplicates. Drain watcher: nohup pid 87197 →
  logs/watch-drain-s12-e005-shapes.log.)
- **SHAPE SUB-JUDGMENT (2026-07-17T08:18Z, session 12, unit 36):
  ADVANCE RULE BOTH HOLD — the first passing axis in the lab. Depth
  is the strongest lever measured to date: the deep 2-rung arms beat
  the reference by +1.75/+1.86 $/mkt, DISTINCT in both halves, on
  HALF the outlay, with pairs bought at S ≈ 0.94 (below the
  incumbent 0.95–0.976 region). Winner: rc = [0.02, 0.13] (best EL
  in both halves; rb statistically tied — point-estimate choice per
  the frozen "caps on the best rung shape" rule). The A17 4-rung
  package (rd) buys nothing at 2× resting size.**
  - **Identity:** runs 697–702 submission uids match the frozen
    launch uids to the digit (DB query u36); ra = reused 682/683.
    All 6 new runs 0-failed.
  - **Validators green ×6:** settlement recheck OK all markets;
    fee-recon VALID (|recon−db| 0.10–0.36 vs tol ≥ 57.60), meta
    coverage 100%; segments cross-check OK (max drift 0.0022). Axis
    gates: G2 PASS (played 97.2–99.5% everywhere), G9 PASS, G3 n/a.
  - **Table (e005-table.ts, EL $/mkt era-corrected, both halves):**
    | arm | h1 EL±se | h2 EL±se | played% | taker% | pairRate | imb p50 | outlay | CVaR5 | S(pair) |
    |-----|----------|----------|---------|--------|----------|---------|--------|-------|---------|
    | ra [0.01,0.03] (682/683) | −4.5656±0.1487 | −4.2209±0.1371 | 99.5 | 33.9/34.0 | 0.657/0.632 | 0.175/0.199 | 56.82/52.49 | −21.46/−19.75 | 0.9767/0.9696 |
    | rb [0.02,0.06] (702/697) | −2.8167±0.1631 | −2.4749±0.1466 | 97.8/97.2 | 37.8/36.8 | 0.571/0.552 | 0.273/0.306 | 36.84/32.74 | −21.50/−19.13 | 0.9437/0.9385 |
    | rc [0.02,0.13] (698/699) | **−2.7093±0.1368** | **−2.3622±0.1247** | 97.8/97.2 | 37.4/36.5 | 0.576/0.558 | 0.270/0.273 | 35.14/31.13 | **−16.70/−15.30** | **0.9427/0.9374** |
    | rd [0.01,0.02,0.05,0.13] (700/701) | −4.9728±0.1722 | −4.5001±0.1611 | 99.5 | 33.6/33.5 | 0.651/0.630 | 0.180/0.199 | 59.97/54.82 | −26.92/−23.28 | 0.9802/0.9752 |
    (imb p90 = 1.000 in every arm/half — the fully-one-sided tail
    market survives depth; fills m/t: ra 37,767/19,385 + 36,344/18,759;
    rb 23,468/14,261 + 21,904/12,729; rc 22,611/13,480 + 20,940/12,018;
    rd 39,848/20,138 + 38,013/19,115.)
  - **Adjacency (pure-depth chain, criterion 3):** ra↔rb DISTINCT
    both halves (|ΔEL| 1.7489/1.7459 vs 2·se_diff 0.4415/0.4014);
    rb↔rc indistinguishable both halves (0.1074/0.1128 vs
    0.4259/0.3848; same sign both); endpoints ra↔rc DISTINCT both
    (1.8563/1.8587 vs 0.4042/0.3706). Package: rd↔ra
    indistinguishable both halves (0.4072/0.2792 vs 0.4550/0.4230,
    point estimates negative both).
  - **Advance rule (criterion 4, as E003): (a) endpoint depth
    direction + in both halves — HOLDS (adjacent signs +,+ in both);
    (b) top-2 by EL = {rb, rc} in both halves — HOLDS. BOTH HOLD →
    the winning shape advances to the cap sub-axis.** Winner = rc
    (best EL both halves; rb tied within noise — the choice between
    them is point-estimate, stated per max-of-N honesty; sel-width
    of the rc reading is 4).
  - **Which comparison was read (LS-6 obligation):** the pure-depth
    conclusion comes from the 2-rung chain only (ra→rb→rc, same
    12 sh/side/cycle). rd is the A17 archetype PACKAGE (24
    sh/side/cycle, 4 rungs incl. shallow) and was read ONLY against
    ra: adding back shallow rungs at 2× resting size cancels the
    depth benefit (its S 0.9802/0.9752 ≈ ra's, its fills and outlay
    are the LARGEST of all arms — it behaves like a bigger ra, not
    like a deeper ladder). The archetype's own shape is not the way
    in; its documented edge must come from elsewhere (fee tier,
    completion behavior, or timing — consistent with A32).
  - **Mechanism readout:** depth works exactly as LS-2 predicted in
    reverse: fewer, better fills — maker fills drop ~40%, outlay
    drops ~40% (56.82→35.14), yet EL improves +1.86 because (i)
    pairs complete at S ≈ 0.9427/0.9374 (locked ~6c/pair discount,
    vs ~2.5c at ra) — BELOW the incumbent 0.95–0.976 profitable
    region; (ii) the shed fills were the adverse ones (CVaR5
    improves 22–25% at rc while pairRate FALLS to 0.576/0.558 and
    imb p50 RISES to 0.270/0.273 — fewer forced "pairs" via churn,
    more honest one-sided exposure, and still better tails). Taker
    share rises ~3pp (deep rungs still convert under latency) but
    on far fewer fills. Participation cost of depth is mild at this
    grid: played share 97.8/97.2% vs 99.5% (no G2 choke; the LS-6
    asymmetric-band concern did not bind at 0.13 offsets).
  - **Best measured cell is now rc: EL −2.71/−2.36 maker-only** —
    beats E004-cfree (−3.47/−3.35) with no completion machinery.
    Still negative: the concept pays ~7–8% of outlay per market to
    trade at this cell. Open interaction (backlog): deep shape ×
    free completion (E004's lever was measured on the SHALLOW
    ladder; its Δ may not transfer to a book where S is already
    0.94 and imbalance is the residual risk).
  - **Cap sub-axis next per pre-registered rule:** bind table from
    the rc pair (698/699), grid decision recorded below BEFORE any
    ax4 submission.
- **CAP-GRID DECISION (2026-07-17T08:20Z, u36; pre-registered rule
  executed verbatim on the winner pair 698+699, e005-table.ts
  --bind):** n = 4,135 both-sided played markets; S quantiles p10
  0.8572, p25 0.9125, p50 0.9567, p75 0.9803, p90 0.9958; bind(0.96)
  = 0.4663, bind(0.97) = 0.3599, bind(0.98) = 0.2544. Rule:
  bind(0.96)−bind(0.98) = 0.2119 ≥ 0.15 AND bind(0.98) = 0.2544 ≥
  0.05 → **KEEP prior grid {0.96, 0.97, 0.98}**. Every cap arm both
  binds and passes materially at the winning shape; no quartile
  replacement. Cap reference (0.99) = the rc runs themselves
  (698/699, pairCostCap file default 0.99) — reused, not
  resubmitted, same basis as ra/control reuse. Cap sub-axis = 6 new
  runs: caps {0.96, 0.97, 0.98} × halves on rc, suffixes
  `ax4h<half>-c<code>` (c960/c970/c980), lat140, clip 6, tol 2,
  completion none.
- **Cap runs (launched 2026-07-17T08:21Z, session 12, SHA d8f5be2b =
  the launcher commit; strategy code unchanged since freeze SHA
  7355c21a; 6 flows, h1 = 2,880, h2 = 2,976 each; cap-0.99 reference
  = rc runs 698/699, reused):**
  - ax4h1-c960: `…--ax4h1-c960--lat140--341448af-df76-4a0e-9a24-61a61333d1fb`
  - ax4h2-c960: `…--ax4h2-c960--lat140--236c872e-aae6-4d89-8ca0-071fa93002a4`
  - ax4h1-c970: `…--ax4h1-c970--lat140--aa4657a2-a7b3-4272-92fe-a88d2a99c11e`
  - ax4h2-c970: `…--ax4h2-c970--lat140--edc1ed8c-0ffe-4040-a531-452e161a50b3`
  - ax4h1-c980: `…--ax4h1-c980--lat140--cfd1e969-78b1-464f-9997-578f3ecc0faa`
  - ax4h2-c980: `…--ax4h2-c980--lat140--1401f478-dfb3-4d87-9113-0dba940f84b4`
  (verified read-only via agg-inspect post-launch: 6 ax4
  waiting-children flows; markets queue 17,459 waiting + 12 active ≈
  the expected 17,568; markets failed = 0. Drain watcher: nohup pid
  44081 → logs/watch-drain-s12-e005-caps.log.)
- **CAP SUB-JUDGMENT (2026-07-17T09:07Z, session 12, unit 38):
  monotone tighter-is-better through the whole grid, ADVANCE RULE
  BOTH HOLD (second passing sub-axis). Forcing deeper pairs RAISES
  EL — it does not merely lower fill count. Best cell: c960 at
  EL −2.2884/−2.0229.**
  - **Identity:** runs 703–708 submission uids match the frozen
    launch uids to the digit (DB query u38); c990 ref = reused rc
    runs 698/699. All 6 new runs 0-failed.
  - **Validators green ×6:** settlement recheck OK; fee-recon VALID
    (|recon−db| 0.03–0.32 vs tol ≥ 57.60), meta coverage 100%;
    segments cross-check OK (max drift 0.0045). G2 PASS everywhere —
    played 97.8/97.2% CONSTANT across caps: the participation caveat
    never armed; pairCostCap binds pair ASSEMBLY, not quoting
    eligibility.
  - **Trade-off curve (criteria 5; e005-table.ts cap mode):**
    | cap | h1 EL | h2 EL | pairRate h1/h2 | S h1/h2 | outlay h1/h2 | CVaR5 h1/h2 |
    |-----|-------|-------|----------------|---------|--------------|-------------|
    | 0.96 | **−2.2884±0.1375** | **−2.0229±0.1252** | 0.527/0.514 | 0.9150/0.9110 | 29.12/26.54 | −15.49/−14.61 |
    | 0.97 | −2.3791 | −2.1354 | 0.545/0.527 | 0.9247/0.9200 | 31.08/28.00 | −15.39/−14.54 |
    | 0.98 | −2.5335 | −2.1810 | 0.559/0.544 | 0.9332/0.9282 | 33.17/29.73 | −16.24/−15.01 |
    | 0.99 ref | −2.7093 | −2.3622 | 0.576/0.558 | 0.9427/0.9374 | 35.14/31.13 | −16.70/−15.30 |
    (fills fall ~15% ref→c960: 22,611/13,480 → 19,247/11,516 h1;
    imb p50 rises 0.270→0.332/0.273→0.333; imb p90 1.000 everywhere;
    taker% flat ~37; answer to the pre-registered question: EL rises
    AND fill count falls — pair quality beats pair quantity on this
    book.)
  - **Adjacency:** every adjacent step indistinguishable (|ΔEL|
    0.05–0.18 vs 2·se_diff 0.35–0.39); endpoints c960↔c990 DISTINCT
    in h1 (0.4209 > 0.3880), just short in h2 (0.3392 < 0.3534) —
    u17b standard: measurable direction, insufficient in-between
    resolution.
  - **Advance rule: BOTH HOLD.** (a) endpoint direction − in both
    halves (adjacent signs −,−,− in both); (b) top-2 = {c960, c970}
    in both halves. Cap ordering is stable; the surviving region is
    the tight-cap end {0.96, 0.97} on shape rc.
  - **Grid-edge caveat (LS-6 spirit, stated):** the curve is still
    improving AT the grid's lower bound — the optimum is NOT
    bracketed; it lies at or below 0.96. bind(0.96) = 0.4663 says
    almost half of both-sided markets hit this cap, and S(c960) =
    0.9150/0.9110 sits BELOW the incumbent 0.95–0.976 region.
    Extension below 0.96 is NOT run here (not pre-registered; the
    axis closes at planned resolution per Kill/stop) — seeded as
    E005b in backlog.
- **JUDGMENT (2026-07-17T09:07Z, session 12, unit 38 — axis closed;
  both sub-curves measured at planned resolution):** placement depth
  and the placement-side pair-cost cap are BOTH real, stable,
  same-direction levers, and they compose: reference −4.5656/−4.2209
  → deep shape rc −2.7093/−2.3622 (DISTINCT) → rc+cap0.96
  −2.2884/−2.0229 (direction stable, endpoints DISTINCT h1). The
  combined best measured cell removes ~51% of the reference loss,
  maker-only, at 52% of the reference outlay, with the best tails
  measured (CVaR5 −15.49/−14.61 vs −21.46/−19.75). Fewer, better
  fills is the entire story: S(pair) walks from 0.9767 down to
  0.9150 while EL improves monotonically along BOTH knobs — the
  adverse-selection tax falls fastest where fills are hardest to
  get. The A17 archetype package is excluded as the incumbent's
  mechanism (dead region). Both sub-axes passed their advance rules
  (the lab's first and second) — this axis family is
  confirmation-grade input for candidate assembly, NOT a candidate:
  still −2.0 to −2.3 $/mkt at lat140, sel-width 4 per sub-axis,
  no latency battery yet (pre-registered as pre-candidate
  requirement), no holdout. Next per spec: battery (0/500/1000) on
  the surviving region before any promotion.
- **Lesson (LS-9, recorded in LESSONS.md):** the two "caps" sit on
  opposite sides of the pair lifecycle and have OPPOSITE value:
  capping the pair you BUILD (placement-side never-overpay,
  pairCostCap) filters bad assembly and improves EL monotonically;
  capping the pair you RESCUE (completion-side, E004) blocks exactly
  the completions that matter and is useless-to-harmful. Guard
  placement, free the rescue.
- **BATTERY ADDENDUM (pre-registered 2026-07-17T09:12Z, u39, BEFORE
  battery submission; discharges the frozen coverage clause
  "battery (0/500/1000) on the surviving region before any candidate
  promotion"):** cell = rc+cap0.96 (the surviving region's best
  cell; c970 statistically tied — battery on the single best cell,
  stated). Arms: lat {0, 500, 1000} × halves, jitter 0, all other
  params verbatim from runs 708/703 (which ARE the lat140 cells).
  6 runs, suffixes `bath<half>-c960`, launcher LS-3-hardened.
  Readout (pre-registered): EL±se, taker share, fills m/t, pairRate,
  S(pair), outlay per lat×half; degradation Δ per lat step and
  lat0→lat1000 total, compared against the E002 shallow-ladder
  battery (EL −0.4207/−4.3904/−5.0288/−5.3047 at 0/140/500/1000;
  taker conv 0→34→48→55% of fills; LS-1 hypothesis: the
  standing-deep-ladder character degrades LESS — quote both Δ$ and
  taker-share inflation). L-ratios (EVALUATION §4) are UNDEFINED at
  EL(140) < 0 — this battery is characterization for the family
  dossier + the LS-1 test, NOT a G6 gate evaluation; stated so no
  later reading upgrades it. G2/G9 validity checks per run as
  always.
- **Battery runs (launched 2026-07-17T09:11Z, session 12, SHA
  c19e1365; 6 flows; lat140 reference = runs 708/703, reused):**
  - bath1-c960 lat0: `…--bath1-c960--lat0--3ab5aa2f-444b-4997-8a25-f2208ea22ad3`
  - bath2-c960 lat0: `…--bath2-c960--lat0--8df15d9a-0865-4d61-a987-2635b186bcc7`
  - bath1-c960 lat500: `…--bath1-c960--lat500--a6efa857-8c47-4a4e-8ec9-53b97ffd0ffb`
  - bath2-c960 lat500: `…--bath2-c960--lat500--b62e86c6-54bd-440c-a4c5-94a97b2b5c67`
  - bath1-c960 lat1000: `…--bath1-c960--lat1000--19040c5e-9a48-4ae7-ad87-7f733d48a423`
  - bath2-c960 lat1000: `…--bath2-c960--lat1000--70f11d2a-ec56-4e60-baf6-8e0ce74eb890`
  (verified read-only via agg-inspect post-launch: 6 bath flows;
  markets queue 17,463 waiting + 12 active ≈ 17,568 expected;
  markets failed = 0. Drain watcher: nohup pid 1994 →
  logs/watch-drain-s12-battery.log. Run 714 landed partial — 1
  BullMQ stall — completed via windowed --extend, original
  submissionUid retained, all rows verified in-window; incident +
  near-miss in JOURNAL u41, LS-10.)
- **BATTERY JUDGMENT (2026-07-17T10:35Z, session 12, unit 42):
  depth's advantage is latency-ROBUST (+1.8 to +2.2 $/mkt better
  than the shallow reference at every arm), but the cell's residual
  loss at realistic latency is ~entirely the taker-conversion
  channel — the LS-1 standing-ladder hypothesis is REFUTED at this
  grid, and by the pre-registered u40 framework, candidate assembly
  on this family is BLOCKED pending a conversion-closing lever.**
  - **Identity:** uids 709–714 match the launch block to the digit
    (714 retained its original uid through the extension). All 6
    complete, 0 failures. Validators green ×6 (fee-recon |recon−db|
    ≤ 0.32; meta coverage 100%; settlement + segments OK).
  - **Curve (results.ts --battery; EL $/mkt; E002 fullwin shallow in
    parens):**
    | lat | h1 | h2 | taker% | played% | pairRate | S(pair) | outlay |
    |-----|----|----|--------|---------|----------|---------|--------|
    | 0 | −0.1175 | −0.0136 (−0.42) | 1.7/0.0 | 35.4/37.4 | 0.116/0.101 | 0.8197(134)/0.8042(131) | 3.61/3.41 |
    | 140 | −2.2884 | −2.0229 (−4.39) | 37.4/36.9 | 97.8/97.2 | 0.527/0.514 | 0.9150/0.9110 | 29.12/26.54 |
    | 500 | −3.1803 | −3.1313 (−5.03) | 50.1/50.1 | 99.3/99.0 | 0.590/0.566 | 0.9420/0.9370 | 43.41/40.67 |
    | 1000 | −3.4644 | −3.4688 (−5.30) | 56.4/56.5 | 99.4/99.3 | 0.614/0.593 | 0.9522/0.9480 | 50.73/48.19 |
    (fills m/t: lat0 1,522/26 + 1,535/0; lat140 19,247/11,516 +
    18,240/10,660; lat500 22,829/22,955 + 22,250/22,371; lat1000
    23,252/30,052 + 23,012/29,829. REB 0 in all cells.)
  - **Pre-registered reads:** Δ(140→1000) = −1.1760/−1.4459 (E002:
    −0.9143); Δ(0→1000) = −3.3469/−3.4552 (E002: −4.8840). Taker
    inflation 37→50→56% vs E002's 34→48→55% — IDENTICAL slope: deep
    rungs re-anchor (requoteDelta 0.02) and convert at the same
    rate; the standing-ladder benefit LS-1 hoped for does not
    materialize from depth alone. LS-1-hypothesis: REFUTED at this
    grid.
  - **The lat0 decomposition (the battery's real finding):** at
    zero latency the deep book plays 35–37% of markets, ~0.5
    fills/mkt, taker ≈ 0, pairRate ≈ 0.11, imb p50 = 1.000 (LS-2
    pattern: organic deep fills are rare and one-sided), and loses
    ≈ nothing (−0.12/−0.01; the sparse organic pairs are CHEAP:
    S 0.80–0.82). ~95% of lat140 fills exist only because of the
    latency window; the entire −2.16 avg at lat140 is
    conversion-channel loss. Depth improved the lat140 cell by
    making the latency-window fills FEWER and BETTER-priced, not by
    building an organic pairing engine.
  - **Framework applied (pre-registered blind, u40):** the MIRAGE
    branch fires numerically (Δ(140→1000) ≤ −1; taker → 56%) AND
    the in-between clause holds (the depth ORDERING survives every
    lat: −3.47 vs −5.30 at 1000). Verdict per framework: the family
    keeps its STRUCTURE claim — deep + tight placement cap is the
    right chassis at every latency — but its lat140 EL is
    execution-fragile and candidate assembly is BLOCKED until an
    axis closes the conversion channel (quote-stability / fair-value
    suppression / completion). No G6 evaluation (L-ratios undefined
    at EL < 0, per addendum).
  - **Program consequence (next axis):** the measured loss channel
    points at QUOTE-STABILITY first (requoteDelta has never been
    tested; LS-1 named it a design axis; the conversion share is
    the whole residual loss), then E008 fair-value suppression
    (same channel, information-based), then E005b/timing/completion
    composition. E006-quote-stability draft next.

## E006-quote-stability — requote discipline on the deep chassis
- **Type:** axis
- **Status:** frozen (2026-07-17T10:35Z, session 12, at launch, SHA
  35a6f5de = the launcher commit; spec verbatim from the u43 draft —
  nothing filled at freeze. Drafted AFTER the E005 battery judgment,
  BEFORE any E006 data existed.)
- **Runs (launched 2026-07-17T10:34Z, 8 flows, h1 = 2,880 / h2 =
  2,976 each; delta-0.02 reference = runs 708/703, reused):**
  - ax5h1-q05: `…--ax5h1-q05--lat140--4762a14d-575a-4bb0-8f3c-83d78499e203`
  - ax5h2-q05: `…--ax5h2-q05--lat140--2428068e-927c-48e8-a4ec-f80968ab7ba8`
  - ax5h1-q10: `…--ax5h1-q10--lat140--26da577b-5db5-4729-964b-76a7b28c62d4`
  - ax5h2-q10: `…--ax5h2-q10--lat140--4989ab76-1564-4025-aeb9-74ef56426f48`
  - ax5h1-q20: `…--ax5h1-q20--lat140--d1440f82-c2d4-4095-857c-cd730b942da9`
  - ax5h2-q20: `…--ax5h2-q20--lat140--cb22d12f-1a33-4693-99c9-e3f7f52096f3`
  - ax5h1-q45: `…--ax5h1-q45--lat140--d7a370e8-416e-4027-9a23-b5576269bc34`
  - ax5h2-q45: `…--ax5h2-q45--lat140--009f6334-2a5b-469c-8adb-5854cb4abc03`
  (verified read-only via agg-inspect post-launch: 8 ax5
  waiting-children flows at SHA 35a6f5de; markets queue 23,296
  waiting + 12 active ≈ the expected 23,424; markets failed = 0.
  Drain watcher: nohup pid 94585 → logs/watch-drain-s12-e006.log.)
- **Why this axis now (proposal policy: measured mechanism first):**
  the E005 battery decomposed the best cell's loss: at lat0 the deep
  book loses ≈ nothing (−0.12/−0.01, taker ≈ 0) while at lat140 it
  loses −2.29/−2.02 with 37% taker share → the residual loss is
  ~100% requote-conversion (cancel-in-flight + re-anchor churn,
  LS-1). requoteDelta has NEVER been tested (0.02 fixed since E002);
  LS-1 named quote-stability a design axis; this is the
  highest-information axis available. Time-weighting (old E006 seed)
  moves to backlog as E-timing.
- **Mechanism:** rungs re-anchor when |bid − basisBid| ≥
  requoteDelta (E003-pair-accumulator.ts:228). Every re-anchor
  under latency exposes the old rung in flight and can cross at
  arrival (LS-1). Raising the threshold trades participation for
  conversion-immunity: standing rungs fill only on organic sweeps
  (the lat0-like subset, which the battery showed is ≈ EV-neutral
  and CHEAP — S 0.80–0.82). Prediction: EL rises toward the lat0
  economics as delta grows; played share and fills/mkt fall; the
  EL-vs-participation trade-off curve is the deliverable. The knob
  is an absolute price distance — no sizing floor, no LS-6
  collapse; arms are distinct by construction (schema bound
  lt(0.5) makes 0.45 the effective "never within a window" arm;
  a true never-requote needs a code change — out of scope, stated).
- **Arms:** requoteDelta ∈ {0.02 (ref = runs 708/703, NOT
  resubmitted — parameter-identical cell, standing determinism
  basis), 0.05, 0.10, 0.20, 0.45} on the E005 chassis: rungOffsets
  [0.02,0.13], pairCostCap 0.96, parityTolPct 2, completionMode
  none, clip 6, lat140, jitter 0. Halves h1 Apr / h2 May. 8 new
  runs (~23.4k jobs). Suffixes `ax5h<half>-q<code>`, codes q05,
  q10, q20, q45. Launcher `tools/launch-e006.sh`, LS-3 hardened
  (--dry-run only; refuses queued ax5; all knobs hardcoded).
- **Success criteria (freeze-ready; freeze verbatim at submit):**
  (1) all 8 new runs complete, validators green (G9 fee-recon,
  settlement recheck, meta coverage 100%); participation is a
  MEASURED OUTPUT, not a validity gate — an arm with played < 20%
  (G2 level) is flagged "delta chokes participation at this
  chassis" and its EL reported but marked
  unmeasurable-at-coverage (E005 caveat language). (2) per-arm×half
  readout: EL±se, t, taker share, fills m/t (+ fills/mkt), played%,
  pairRate, imb p50/p90, S(pair), outlay, CVaR5. Cancel counts are
  not persisted — stated limitation; conversion is read from taker
  share × fills. (3) adjacency on the chain 0.02 < 0.05 < 0.10 <
  0.20 < 0.45 at |ΔEL| > 2·se_diff, plus endpoints. (4) advance
  rule (as E003/E005): (a) endpoint direction sign(EL(0.45) −
  EL(0.02)) agrees across halves; (b) top-2 by EL of the 5 arms is
  the same SET in both halves. Both hold → the winning delta joins
  the chassis for subsequent axes/candidate assembly; either fails
  → axis unstable at this coverage, chassis keeps 0.02, stated.
  (5) the EL-vs-participation trade-off curve quoted either way
  (NOT gated on EL sign — axis experiment).
- **Kill/stop:** axis closed when the curve is measured at planned
  resolution; dead cells to LEADERBOARD with numbers.
- **Runs (landed):** 715=ax5h2-q05, 716=ax5h1-q10, 717=ax5h2-q10,
  718=ax5h1-q20, 719=ax5h2-q20, 720=ax5h1-q45, 721=ax5h1-q05,
  722=ax5h2-q45. All 8 submission uids match the frozen launch block
  to the digit (verified on landing: u46/u47/u51 for 715–721, u52
  for 722). h1 = 2,880, h2 = 2,976 markets each, 0 failures.
  Validators green ×8: settlement recheck OK, fee-recon VALID
  (|recon−db| ≤ 0.32 vs tol ≥ 57.60), meta coverage 100%, segments
  cross-check OK. Peek-line incident: u46/u47 quoted TRADE_sim
  instead of headline EL for 716/717/718 — corrected u50 before
  judgment; all numbers below are canonical headline EL.
- **JUDGMENT (2026-07-17T14:06Z, session 16, unit 52 — AXIS-CLOSED;
  curve measured at planned resolution; pre-registered prediction
  REFUTED; chassis keeps requoteDelta 0.02):**
  - **Participation caveat never armed:** played 99.5% in every new
    arm (ref 97.8/97.2) — delta gates RE-anchoring only; the first
    anchor always quotes. The choke branch of criteria (1) is moot.
  - **Trade-off curve (criteria 5; e005-table.ts, canonical):**
    | delta | h1 EL | h2 EL | taker% h1/h2 | fills/mkt h1/h2 | CVaR5 h1/h2 |
    |-------|-------|-------|--------------|-----------------|-------------|
    | 0.02 ref | **−2.2884±0.1375** | **−2.0229±0.1252** | 37.4/36.9 | 10.9/10.0 | −15.49/−14.61 |
    | 0.05 | −2.5978 | −2.5887 | 12.3/11.0 | 12.2/11.2 | −9.84/−9.53 |
    | 0.10 | −2.3103 | −2.3715 | 9.4/7.4 | 10.8/9.5 | −8.93/−8.54 |
    | 0.20 | −2.2897 | −2.3681 | 7.4/4.8 | 10.5/9.2 | −8.69/−7.92 |
    | 0.45 | −2.3015 | −2.3428 | 7.1/4.6 | 10.4/9.1 | −8.70/−7.91 |
    Taker share collapses 37% → 5–7% exactly as designed — and EL
    does NOT recover: every cell at-or-below reference; the h1 chain
    is non-monotone (q05 worst, plateau AT ref), h2 is monotone
    recovering but stops −0.32 below ref. The frozen prediction
    ("EL rises toward the lat0 economics ≈ −0.1 as delta grows") is
    REFUTED: the plateau is at −2.29/−2.34, nowhere near the bound.
    One real gain: tails improve ~45% (CVaR5 −15.5 → −8.7) as taker
    churn disappears — a risk effect, not an EV effect.
  - **Adjacency (criteria 3):** h1 — only q05↔q10 DISTINCT (0.2875 >
    0.2568); endpoints indistinguishable (0.0132 < 0.3195). h2 —
    q02↔q05 DISTINCT (0.5658 > 0.3026) and endpoints DISTINCT
    (0.3199 > 0.2912, ref side better); middle indistinguishable.
    q05 is distinguishably the worst step in both halves.
  - **Advance rule (criteria 4): FAILS.** (a) endpoint direction −
    in both halves: HOLDS; (b) top-2 sets h1 {q02, q20} vs h2
    {q02, q45}: SET MATCH FAILS. Per the frozen consequence: axis
    unstable at this coverage, **chassis keeps requoteDelta 0.02**.
  - **Mechanism (e004-decomp.ts, exact settlement split, identity
    asserts green both chains; $/mkt):** raising delta collapses the
    winner-remainder term: h1 rem$ 2.17 → 1.09 (q05) → 0.95 (q45);
    h2 rem$ 2.37 → 1.11 → 0.84. Δrem −1.08 to −1.53 in every arm.
    Against that, fee savings are only +0.21 to +0.29 and net pair
    economics (Δpair−Δcost) improve at most +0.93 (q20/q45): the
    remainder loss outweighs both everywhere → no cell beats ref.
    Reading: at delta 0.02 the requote engine chases price, so the
    side being accumulated tracks the eventual winner — unpaired
    remainder is WORTH $2.2–2.4/mkt at settlement. Freeze the
    quotes and stale standing bids fill on the side price is
    leaving; the remainder payload shrinks to $0.85–1.1. The taker
    conversions the battery blamed were the PRICE of a correlated
    benefit, not a removable tax.
  - **Program consequence:** the battery's "residual loss is ~100%
    requote-conversion" read conflated the fee term with an
    information term — the settlement decomposition separates them:
    fees are ~$0.3 of the channel; winner-tracking is ~$1.3–1.5.
    A conversion-closing lever must preserve winner-tracking while
    avoiding the cross. Mechanical quote-freezing cannot do both
    (measured here); an information-based anchor might — quotes
    re-anchored on EXTERNAL fair value (binance spot, replayable
    now) instead of own-book chasing could keep tracking the mover
    without standing stale on the leaving side. E008-fair-value is
    the next axis; candidate assembly stays BLOCKED per the u40
    framework (no conversion-closing lever proven yet). E005b and
    completion composition (D-008) rank behind E008 — neither
    addresses the loss channel.
- **Dead cells:** requoteDelta ∈ {0.05, 0.10, 0.20, 0.45} on the
  rc+c960 chassis at lat140 → LEADERBOARD dead-regions with numbers.
- **Lesson (LS-11, recorded in LESSONS.md):** churn is not pure
  cost — decompose fee vs information terms before building an axis
  to remove a loss channel.

## E008-fv-gate — adverse-side suppression from external fair value
- **Type:** axis
- **Status:** frozen (2026-07-17T14:25Z, session 16, unit 57, at
  launch, SHA 800b34cf = the launcher commit; spec verbatim from
  the u54 draft + u55 calibration — nothing else filled at freeze.
  Drafted AFTER the E006 judgment/A-6 fold, calibrated u55,
  implemented + A/A-verified u56, all BEFORE any arm data existed.)
- **Runs (launched 2026-07-17T14:24Z, 8 flows, h1 = 2,880 / h2 =
  2,976 each; gate-off reference = runs 708/703, reused —
  A/A-verified on the launch SHA lineage, run 723 = 20/20 exact):**
  - ax6h1-g00: `…--ax6h1-g00--lat140--2a6cf667-75d1-49e9-ad77-73c57e00d6c8`
  - ax6h2-g00: `…--ax6h2-g00--lat140--4367ac01-317c-4c52-9235-d4720295cda8`
  - ax6h1-g05: `…--ax6h1-g05--lat140--c9682d1b-c67b-44d8-930d-a512d336f301`
  - ax6h2-g05: `…--ax6h2-g05--lat140--4b7d1627-5d36-47a4-9b0c-6fa1c2201c75`
  - ax6h1-g09: `…--ax6h1-g09--lat140--3effc218-2ffd-42fd-bf11-2dcfcc787557`
  - ax6h2-g09: `…--ax6h2-g09--lat140--600b237d-2f1e-4c67-890e-1db3351a7e70`
  - ax6h1-g15: `…--ax6h1-g15--lat140--eb3f70e8-f922-49ff-b8a6-4627e962c0d6`
  - ax6h2-g15: `…--ax6h2-g15--lat140--0eb38106-5fab-40c4-a103-2d852eb5d884`
  (verified read-only via agg-inspect post-launch: 8 ax6
  waiting-children flows at SHA 800b34cf; markets queue 23,255
  waiting + 12 active ≈ the expected 23,424; markets failed = 0.)
- **Why this axis now (proposal policy: measured mechanism first):**
  E006 closed with the loss channel decomposed: the winner-remainder
  payload ($2.2–2.4/mkt at ref) is what price-chasing requotes buy;
  freezing quotes forfeits it ($1.2–1.5) to save $0.3 of fees. The
  battery's conversion channel is therefore fee + INFORMATION, and
  the lever must cut the adverse-fill component without giving up
  winner-tracking. Independently, the KB measured the same object
  from fills (A-6): living winners' excess leg tracks the eventual
  winner (60–81% win), and post-fill drift — fill selection — is
  the class edge signature. The only unexplored information source
  on this branch is the EXTERNAL spot feed (binanceWsSpotPrice,
  replayable now; u48: 61/61 Apr+May day files on disk, hard-error
  on gaps, as-of lookup seeded pre-window). E008 gates the ADVERSE
  side with it and leaves the requote engine untouched.
- **Mechanism:** strike proxy = first spot value at or after window
  open (H4; the backtest feed is seeded with the last pre-window
  trade so a value exists at open; Chainlink-vs-binance basis is a
  stated limitation, A18 caveat near the boundary). Per tick,
  signed distance d = (spot − strike)/strike in bps. Side DOWN is
  ADVERSE when d > +θ (price has left it); side UP is adverse when
  d < −θ. Gate: place NO new rungs on the adverse side (existing
  resting rungs cancel via the normal requote/parity paths — the
  gate blocks placement, not standing orders; simplest honest v1,
  stated). The favorite side keeps quoting and keeps its fast
  (0.02) requote — winner-tracking preserved by construction.
  Prediction (to freeze): the gate removes a slice of
  leaving-side adverse fills inside the latency window → cost and
  imbalance fall, remainder term survives (unlike E006), EL
  improves at moderate θ; θ too small over-suppresses (gabagool
  needs the cheap side — pairs die), θ → ∞ = ref. The trade-off
  curve EL vs pairRate/played is the deliverable either way.
- **Chassis:** rc+c960 (rungOffsets [0.02,0.13], pairCostCap 0.96,
  parityTolPct 2, completionMode none, clip 6, requoteDelta 0.02),
  lat140, jitter 0, halves h1 Apr / h2 May. Ref = runs 708/703
  (gate off ≡ parameter-identical cell).
- **Implementation plan (same-file doctrine):** E003-pair-accumulator
  gains fvGateMode ('none' default | 'level') + fvGateBps; the
  ExternalFeedsRequestPlugin is registered ONLY when fvGateMode !=
  'none', so gate-none remains bit-identical to the ref runs BY
  CONSTRUCTION (no feed request, no wiring change on the default
  path). Cheap A/A insurance before launch: local sequential run of
  ~20 h1 markets at defaults on the new SHA must reproduce the same
  markets' per-market EL from run 708 exactly; mismatch = the reuse
  basis is broken → STOP, diagnose, resubmit refs if needed. If the
  feed's as-of lookup proves unavailable at some ticks (missing
  value), the gate treats the side as NOT adverse (fail-open,
  stated — fail-closed would silently turn the strategy off).
- **Pre-registered grid rule (execute BEFORE freeze, calibration
  unit):** measure pooled |d| in bps over the quoting window
  (elapsed 60–840s, sampled per aggTrade as-of each second) across
  ALL h1 (Apr) windows from the on-disk aggTrades — no backtest, no
  DB writes. Grid = {p40, p60, p80} of pooled |d|, rounded to the
  nearest 1 bps, deduplicated. Arms = ref (no gate) + θ0 = 0 bps
  (sign-only, max suppression endpoint) + the three quantile arms →
  5 arms × 2 halves, 8 new runs (refs reused). If p40 rounds to 0,
  take {p50, p70, p85} instead (stated fallback so θ0 stays a
  distinct endpoint). Calibration uses h1 only (h2 stays untouched
  by grid selection — same one-half convention as E005's bind
  table).
- **Success criteria (freeze-ready skeleton; freeze verbatim at
  submit with the calibrated grid filled in):** (1) all 8 new runs
  complete, validators green (G9 fee-recon, settlement recheck,
  meta 100%); played < 20% flags the arm unmeasurable-at-coverage
  (E005 caveat language) — plausible here at small θ, unlike E006.
  (2) per-arm×half readout: EL±se, t, taker share, fills m/t
  (+fills/mkt), played%, pairRate, imb p50/p90, S(pair), outlay,
  CVaR5, PLUS the settlement decomp (e004-decomp.ts) per arm — the
  remainder term is the load-bearing prediction this time and is
  judged, not just narrated. (3) adjacency on the θ chain at
  |ΔEL| > 2·se_diff, plus endpoints vs ref. (4) advance rule (as
  E003/E005/E006): (a) endpoint direction sign(EL(best θ) −
  EL(ref)) agrees across halves; (b) top-2 by EL of the 5 arms is
  the same SET in both halves. Both hold AND the winning arm beats
  ref DISTINCTLY in at least one half → the gate joins the chassis;
  else → axis closed with the curve, chassis unchanged, stated.
  (5) mechanism check (frozen prediction): the winning arm must
  show Δrem ≥ −0.3 vs ref (payload preserved) — an arm that "wins"
  by collapsing the remainder again is the E006 failure mode and
  does NOT advance regardless of EL (guards against winning the
  wrong way).
- **CALIBRATION (2026-07-17T14:17Z, u55; pre-registered rule
  executed verbatim, tools/e008-calibrate.ts --run 708, read-only):**
  2,880 h1 markets (run 708's exact universe), 2,249,280 pooled
  1-second samples over elapsed 60–840 s, strike = as-of spot at
  open from the day-parquet series (0 markets skipped). Pooled |d|
  bps quantiles: p25 2.81, p40 4.88, p50 6.52, p60 8.56, p75 12.81,
  p80 14.92, p90 22.11. p40 rounds to 5 ≠ 0 → PRIMARY rule:
  **grid = {5, 9, 15} bps**, arms = ref + θ0 (sign-only) +
  {5, 9, 15}. Bind fractions (share of market-seconds with one side
  suppressed): θ0 99.9%, θ5 59.2%, θ9 38.1%, θ15 19.9% — the grid
  spans the suppression range as intended. Profile for the record:
  |d| p50 grows 3.9 → 9.2 bps from t=120 s to t=840 s (drift
  accumulates through the window; the gate binds hardest late,
  where E006 said stale-side fills hurt most).
- **Kill/stop:** axis closed when the θ curve is measured at
  planned resolution; dead cells to LEADERBOARD with numbers.
- **Out of scope (stated):** favorite-side lean (asymmetric parity
  toward the spot favorite — A34/A36's informed excess leg) is
  sub-axis B, proposed separately only if sub-axis A shows the
  signal has value; per-rung requote speed stays E006b in backlog;
  E-completion-selective keeps its D-008 constraint.
- **Runs / Judgment / Lesson:** (pending — DRAFT, not frozen)

## Backlog (one line each; propose formally when reached)
- E-timing time-weighting axis (was the E006 seed; re-ranked behind
  quote-stability u43 per the battery's mechanism finding):
  {uniform, minutes 8–13 heavy, open-avoid (start 120s), late-only
  (start 480s)} (A17/A20; E24 warns open).
- E007 endgame policy: stop-quote time × band-exit behavior (A20 flip
  table; minute-14 cut always on elsewhere).
- E006b per-rung requote speed (seeded by A-6/A37: fast helps at
  touch, hurts at depth; my chassis shares one delta across
  [0.02,0.13]): fast touch rung / patient deep rung; needs a schema
  addition; propose after E008.
- E009 cheap-side-accumulator (seed 2 / H2): separate mechanism file;
  entry band 0.02–0.15, loose parity, hold. After the E003 family
  program has verdicts.
- E-completion-selective (seeded by §E004 judgment, u33): cross the
  lagging leg ONLY when the held leg lags fair value (binance spot
  proxy, replayable now) — keep cfree's removal benefit (+3.8–4.1
  Δpair, −26% maker fills, −39% conversions) without forfeiting
  winner remainders (cfree gives up Δrem ≈ −0.98/−1.03 $/mkt; upper
  bound ≈ +1 $/mkt over cfree, i.e. best case ≈ −2.4 EL — still
  negative, so this is a lever for a paying cell, not a cell itself).
  Natural pairing: E008's fair-value machinery. Requires D-008 path
  (frozen candidate spec) or a new frozen axis on search-window data.
- E005b deep-cap extension (seeded by §E005 cap sub-judgment, u38):
  the tighter-is-better curve was still improving at the frozen
  grid's edge (c960 best in both halves; optimum unbracketed). Grid
  {0.92, 0.94} on shape rc, halves, lat140 — 4 runs. Bracket before
  candidate assembly freezes a cap value.
- E-deep×completion interaction (seeded u36): E004's free-completion
  lever (+1.10/+0.87 on the SHALLOW ladder, via inventory removal +
  imb p90 1.000→0.335) is unmeasured on the deep book, where imb p90
  is STILL 1.000 and one-sided endings are the residual loss channel
  (imb p50 0.33 at rc+c960). If it composes, best case approaches
  −1.0 territory. D-008 constraint: completion enters via a frozen
  candidate spec (or a new frozen axis).
