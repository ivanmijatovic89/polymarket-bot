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
- **Status:** proposed (draft — freezes at first evidence submission;
  parityTolPct = 2, set from E003's judgment u27 — floors to 12
  shares at clip 6 in every arm, a constant BY DESIGN; completion =
  none in every arm, axis isolation per §E004)
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
- **Runs / Judgment / Lesson:** (pending)

## Backlog (one line each; propose formally when reached)
- E006 time-weighting axis: {uniform, minutes 8–13 heavy, open-avoid
  (start 120s), late-only (start 480s)} (A17/A20; E24 warns open).
- E007 endgame policy: stop-quote time × band-exit behavior (A20 flip
  table; minute-14 cut always on elsewhere).
- E008 fair-value gate (seed 3, unblocked on this branch): Binance
  window-open-strike proxy, suppression threshold 1–5c (H4; basis
  caveat A18 near boundary).
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
