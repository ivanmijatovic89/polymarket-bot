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
- **Judgment / Lesson:** (pending)

## E004-completion-policy — H6 axis (the margin knob)
- **Type:** axis
- **Status:** proposed (draft)
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
- **Runs / Judgment / Lesson:** (pending)

## Backlog (one line each; propose formally when reached)
- E005 ladder-shape axis: {[1,3]c, [2,6]c, [2,13]c, touch+deep} below
  bid (archetype vs A17 current-winner shape). PLUS deep-pair cell
  (A30): pairCostCap ∈ {0.96, 0.97, 0.98} × patient completion — the
  only trading-profitable parity wallet today pairs at 0.964–0.976.
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
