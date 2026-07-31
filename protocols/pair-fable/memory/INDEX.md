# pair-fable memory — INDEX

Entry point for every session. Read this file first, then follow pointers.
Memory is the ONLY continuity between sessions — conversation history does
not survive. Written for AI consumption: dense, factual, evidence-tagged.

## Layout

| Path | Contents |
| --- | --- |
| `INDEX.md` | This file: conventions + map + current-knowledge digest. |
| `capabilities/` | Engine knowledge, one file per subsystem. What the engine can do, verified. |
| `experiments/` | Mission-02 land: `LEDGER.md` (one line per experiment) + one file per variant family. |
| `process/` | How-we-work: evaluator spec, capability-refresh procedure, team workflow. |
| `siblings.md` | Sibling-workspace (`protocols/pair-*`) review log: what exists elsewhere, when last checked. |
| `market-context.md` | Human-reported facts about the live market we cannot observe (e.g. the ~700-trades/window profitable operator, tilted finishes). Strong priors, not measurements. |
| `replan-2026-07-31.md` | Session-15 self-check + strategic replan: identity coverage map (measured vs free terms), ranked decision. Read when choosing the next research direction. |

## Conventions (binding)

1. **Every claim carries an evidence tag**:
   - `[code <path>:<lines> @ <short-sha>]` — verified by reading code at that commit.
   - `[run <backtestRunId> | <date>]` — verified by executing (the strongest tag).
   - `[db <query summary> | <date>]` — verified by querying the database.
   - `[doc <path> | UNVERIFIED]` — from docs only; must be upgraded or removed
     before anything depends on it.
2. **Negative results are time-scoped.** Never write "X does not work". Write
   "X was not profitable on <universe / date-range> with <run evidence>". The
   market changes; a wrong "does not work" note buries a profitable idea
   forever. Re-testing an old negative on new data is legitimate; re-testing a
   *verified engine fact* is waste.
3. **Capability notes carry a `verified:` header** (date + repo SHA) **and a
   `watches:` header** (comma-separated engine paths the note's claims depend
   on). `tools/refresh-capabilities.ts` enforces both and diffs each note's
   SHA against origin/main over its watched paths; fold-back procedure in
   `process/capability-refresh.md`.
4. **Update memory after every step, not at session end.** A session can die
   at any moment; files must always be continuable.
5. **Shared future**: parallel agent loops (other models) will read this
   memory. Write so a stranger can act on it: no session-local shorthand, no
   pointers into conversation context.

## Current-knowledge digest

(One paragraph per area, updated whenever the underlying files change.
Pointers, not content.)

- **Engine capabilities**: seeded from the initializer's code survey —
  `capabilities/backtest-cli.md`, `capabilities/metrics-storage.md`,
  `capabilities/strategy-system.md`, `capabilities/simulator.md`,
  `capabilities/fleet.md`. Status: local sequential path RUN-VERIFIED
  (runs 852/853, 2026-07-30) AND fleet path RUN-VERIFIED (runs 854/855,
  2026-07-30 — submission mechanics, SHA self-update observed live,
  machine attribution, sustained speed ~870 markets/min over 27 slots).
  Tools: `tools/sql.ts` (read-only DB queries), `tools/fleet.ts`
  (queue/worker/batch status), `tools/run-backtest.ts` (THE canonical
  launcher — RULES pins injected, unknown flags fatal, `--extend` refused
  per P-001, unique-batchUid run recovery per P-003, HEAD∈origin/main
  pre-check for queue runs, `--sweep-latency` fan-out; run-verified runs
  857/858/859 — the sweep path live-verified 2026-07-30),
  `tools/smoke.ts` (mandatory pre-fleet gate: protocol:check +
  sequential run + PASS/FAIL verdict; run-verified runs 857/860),
  `tools/results.ts` (run/batch summary: 'all'-segment headline + capital
  units + profitPer100 distribution + failures; verified against direct SQL
  on run 857), `tools/compare.ts` (fair multi-run compare on the slug
  intersection: Δ vs baseline, movers, daily pnl + Pearson correlation,
  latency-sweep auto-detect; verified on 856v857 identical-universe,
  854v855 partial-overlap vs SQL join, 858v859 real latency sweep), all
  reading through shared `tools/lib/runQueries.ts` (one code path for
  numbers; camelCase units keys). Protocol runs NEVER call
  `npm run backtest` directly — always via these tools.
- **Parity boundary**: mapped in `capabilities/parity.md` (2026-07-30 @
  e96b246) — shared core (MarketEngine/StrategyRunner/OrderManager/Portfolio,
  identical risk walls), the simulated boundary per intent/event, resolved
  survey questions (place_batch cap live-only → P-005; FOK = visible depth,
  exchange internals parked), 8 binding strategy conventions (cancel with both
  ids, batches ≤15, no MINED gates, fill-chunking indifference, on-grid
  prices, meta stamping), and the 8-point live-trust evidence bar. Proposals
  P-005/P-006/P-007 filed from this work.
- **Evaluator**: COMPLETE in `process/evaluator.md` (2026-07-30) —
  capital-aware units RUN-VERIFIED (run 856: cost==invested for
  no-sell/no-split/no-merge strategies incl. winning side; 6 unit formulas +
  SQL; binding intent_meta convention; capital levels only via
  strategy-param sweeps — no cash model), stage pipeline S0 smoke → S1
  screen (noise floor 0.0008 measured, runs 865v868) → S2 full+weekly
  walk-forward → S3 upward latency sweep → S4 future-as-holdout OOS
  (design-ts split), independence r<0.6/≥14d (verified r=0.9989 on 863v868),
  overfitting guards. Executable form: `tools/evaluate.ts`, executed
  end-to-end on runs 863–870 with correct verdicts at every stage.
- **Team workflow**: `process/team-workflow.md` (PROPOSED, awaiting READY
  review) — how parallel agent loops in sibling `protocols/pair-*/`
  workspaces cooperate: shared MySQL as coordination medium (provenance
  columns), cross-protocol read / own-protocol write, import-by-citation for
  engine facts, LEDGER scan before opening a family, no duplicate FULL runs,
  cross-model portfolio admission via the independence rule.
- **Capability refresh**: `process/capability-refresh.md` +
  `tools/refresh-capabilities.ts` (run-verified 2026-07-30: clean pass at
  c219ad3, simulated drift correctly flags only notes watching the changed
  paths, uncovered sweep catches surveyed-area files no note watches, header
  contract enforced as ERROR). Human trigger is one command; sessions run it
  before relying on capability notes for new work.
- **Experiments**: `experiments/LEDGER.md` (one line per experiment) +
  family files pair-v0..v9. E-001..E-018 recorded (runs 861–887; E-015..18
  are run-free book scans). All FAMILY kills stand, every one
  pre-registered and evidence-tagged: v0 defaults (E-005 FULL, stationary
  −2.2/mkt), gate curve = volume knob (E-004/10/11), repair persistence
  EV-neutral (E-008/9 → v2 kill), start-state selection uninformative
  (E-012), cadence fill-limited (E-013), both-sides quoting co-inflates
  dooms (E-014), taker pair-arb sub-ms (E-015), maker→instant-completion
  pre-repriced (E-016), taker-lead pair adverse entry (E-017), deep-book
  maker δ-grid negative at every δ (E-018; scan archive
  `experiments/data/bookscan-2026-07-31-s6-latest800.json`). The −0.06
  per-start invariant (pair-v4.md) is decomposed in pair-v6.md.
  **CLASS-level claims WITHDRAWN on human ruling 2026-07-31 (inbox
  8758567d, LEDGER E-018b)**: the invariant bounds UNPAIRED shares only —
  per-market identity `EV = completions·g − stranded·L_s`, and L_s (loss
  per stranded share, ≈$0.44 measured, a policy choice) was never
  attacked. Binding kill standard now in evaluator.md §Kill standards
  (identity argument required for class kills; N failures kill a family
  only). Research resumed on the ruling's six axes — priority: absolute
  entry-price ceiling (pair-v9, E-019), then opportunistic cheap-side
  completion + above-$1 loss-mitigating completion (shared machinery).
  E-019 verdict (runs 889–895): one-rest ceiling KILLED at every X, but
  the kill extends to persistent-rest only for X ≥ 0.20 — X=0.15 sits
  inside noise (ev −0.03, capture× 1.06) on the grid's lower boundary ⇒
  X<0.15 and duty-cycle-100% stay open (E-021), taker-completion module
  (axes 2+3) is pair-v10 (E-020); details pair-v9.md §Result.
  E-021 (runs 904–909): KILL, ruling axis 1 CLOSED — low-X all ≤ 0,
  doom-vs-d* gap never crosses zero (ev→0 only because activity
  vanishes), duty-cycle gain measured ZERO (cd0 ≡ cd25 at X=0.12 and
  0.15) — pair-v9.md §Result E-021. E-020 (runs 897–903):
  PARTIAL-INVALID — FOK-burst bug (tick cooldown < fill latency; cap
  breach; fixed eaf8038, CAP-BREACH check now in results.ts); clean
  finding: C ≤ 0.95 trigger-dead on v1 base (repair pre-empts
  profit-lock). E-020b (runs 910–913, fixed code): KILL module on v1
  base, ruling axes 2+3 ANSWERED — doom salvage cuts stranding 341→29
  residue markets but dollars transfer to pairsPnl (save ≈ 1¢/share at
  doom-certainty; E-012 blocks acting earlier); C=0.99 fees eat the
  ≤1¢ locked margin — pair-v10.md §Result E-020b. E-022 (session 11,
  run-872 reanalysis via new `tools/mktselect.ts`): KILL axis 6 — no
  early-book feature trend reproduces across frozen split-halves, zero
  selection rules reach ev ≥ 0 even on exploration, doom rate flat
  43–56% in every bucket; F1 spread + F3 book-sum are DEGENERATE at
  window start (book is tick-constrained ~always) — pair-v11.md §Result
  E-022, archive `experiments/data/mktselect-2026-07-31-latest800.json`.
  E-023 (run 914): v1-b FULL reference — ev −1.0700 ≡ screen (−1.0669),
  monthly −0.96..−1.12, 0/16 positive weeks ⇒ loss stationary in time
  AND scale; the S2 baseline for any future v1-family overlay
  (pair-v1.md §FULL run 914). Ruling axes 1/2/3/6 all answered-negative
  on the v1 family; remaining levers: axis 4 (size laddering), axis 5
  (time-varying policy), and the HF regime. E-024 (session 12,
  `tools/fillprobe.ts` on the pinned 800): **FILL MODEL MATERIALLY
  BINDING** — optimistic front-of-queue capture is 235× worst-queue at
  0 ms and 29× at 140 ms (frozen bar 3×, all 9 days above); raw
  top-of-book bid decrease flow ~225k shares/mkt puts the
  700-trades/window operator inside observed activity; maker-family
  kills STAND (guard-6 direction) but every "fill-limited" claim
  (E-013) is now model-scoped; NO HF maker strategy code against the
  current simulator (P-011). Secondary: W-latency INVERSION (W140 =
  3.8× W0) — worst-queue fills are pure adverse-selection events —
  hf-fill-probe.md §Result E-024, archive
  `experiments/data/fillprobe-2026-07-31-latest800.json`. E-025
  (session 13, `tools/tradeprobe.ts` on the 36 recorded live-WS
  markets): **E-024 DOWNGRADED** — T140/W140 = 0.65 (trade-confirmed
  ceiling BELOW worst-queue), cancel share of ToB decreases 99.1% ⇒ the
  O bound was cancels; fill model is an acceptable capacity bound,
  maker kills stand WITHOUT the optimism caveat, E-013 fill-limited
  restored to ~market fact (T ceiling ≈610 sh/mkt), 700-trades figure ≈
  ALL prints/mkt (704–1,189) ⇒ likely placements; HF ToB gross ceiling
  ≈$8.5/mkt ⇒ HF axis deprioritized on economics; P-011 resolved;
  recorded-vs-telonex parity 0.995 (24 slugs) — hf-fill-probe.md
  §Result E-025, archive `experiments/data/tradeprobe-2026-07-31.json`.
  Axis 4a (size as f(price)) answered from E-019/E-021 band
  monotonicity: convex reweighting of nowhere-positive bands —
  deprioritized with a reopen condition (pair-v12.md §Axis 4a).
  E-026 (session 14, runs 916–920): KILL pair-v12 averaging-down family
  — regression gate PASS (916 ≡ 872, Δ 0.0019); all live configs Δev ≤
  −0.54; the mechanism WORKS (pairsPnl and residue-wins monotone in
  A-exposure) but the trigger self-selects adverse drift — every
  A-dollar loses −0.18..−0.27 (δ- and imb-invariant), Δresidue ≈
  −2×Δpairs; axis 4b answered-negative — pair-v12.md §Result E-026.
  E-027 (session 14, `tools/minuteev.ts` on runs 872+873): KILL axis-5
  start-timing + size-vs-time — no minute bucket or contiguous region
  ≥ 2 SE above 0 in either run; cumulative "forbid starts before m"
  never positive; doom-by-minute structureless (3rd unpredictability
  space after E-012/E-022); completion-vs-time bounded by E-020b —
  pair-v13.md §Result E-027. **ALL SIX ruling axes (inbox 8758567d) now
  answered-negative on the v1 family** — all family-scoped kills, no
  class kill claimed. Cross-universe fact: only btc-15m has converted
  telonex data (22,335 eligible); eth/sol/xrp 15m + all 5m are cataloged
  but UNCONVERTED (P-012, re-verified s15). Session 15 delivered the
  self-check + strategic replan (`memory/replan-2026-07-31.md`: identity
  coverage map — the one unmeasured term was unconditional residue
  VALUE) and executed it: E-028 (pair-v14, `tools/calib.ts`, pinned-800
  book replay) — **first POSITIVE-SIGNAL in lab history** per frozen
  bars (minutes 0–9 × ask ≥ 0.90, +2.2¢/sh both halves) AND the market
  fact that longshots (≤0.55) are overpriced −3..−4¢/sh at 2–5 SE (the
  unconditional explanation of every family's per-dollar loss); E-028b
  first-touch policy readout: KILL naive exploitation (z ≤ 1.24,
  dwell-weighting explained most of the raw signal) — favorite-side
  edge UNRESOLVED at n=800 ⇒ E-029 (FULL-universe replication of the
  frozen regions, true OOS, local chunked scan) is the proposed next
  increment — pair-v14.md, archives
  `experiments/data/calib{,-ft}-2026-07-31-latest800.json`.
  P-009/P-010 remain open but are NOT blockers. **Session 16: human
  strategic redirect (inbox 90d94c56)** — E-029 PARKED; the lab's
  primary objective is now a continuous two-sided inventory
  accumulation controller (maximize matched min(Q_UP,Q_DOWN), pair
  VWAP < 0.98, small imbalance, trending-loss control; 500–1,000
  matched aspirational). Design checkpoint delivered in
  `experiments/pair-v15.md` (family comparison + no-equivalence
  statement, control math, metrics, neutral-first + directional-tilt
  designs, proposed E-030 geometry scan → E-031 strategy grid) —
  AWAITING HUMAN REVIEW; nothing frozen or coded yet. Sibling
  workspaces hold no additional research memory (`siblings.md`,
  2026-07-31).
