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
- **Status:** frozen
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
- **Judgment:** (pending)
- **Lesson:** (pending)

## E003-pair-accumulator — the L2 workhorse strategy + parity axis
- **Type:** axis
- **Status:** proposed (draft — freezes at first evidence submission)
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
  region later. Advance rule: sign/ranking agreement across halves.
- **Success criteria (draft, freeze at submit):** the parity response
  curve measured with arms distinguished (|ΔEL| between adjacent arms
  > 2·se or arms declared indistinguishable); conversion-rate and
  pairing-health curves reported alongside EL.
- **Runs / Judgment / Lesson:** (pending)

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
- **Runs / Judgment / Lesson:** (pending)

## Backlog (one line each; propose formally when reached)
- E005 ladder-shape axis: {[1,3]c, [2,6]c, [2,13]c, touch+deep} below
  bid (archetype vs A17 current-winner shape).
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
