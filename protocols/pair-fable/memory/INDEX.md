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
  P-009/P-010 remain open but are NOT blockers. Sibling workspaces hold no
  additional research memory (`siblings.md`, 2026-07-31).
