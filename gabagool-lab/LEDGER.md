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
    (explicit limit). Plan: let the 1,000-market chunks land (uniform
    across arms → valid as a first look), then `--extend` each run to
    the full window with the same pinned latency env. Coverage claim in
    the judgment will quote the FINAL per-run market counts.
- **Judgment:** (pending)
- **Lesson:** (pending)
