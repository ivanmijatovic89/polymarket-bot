# Team workflow — parallel agent loops

Status: BINDING for this loop. Rule 1 (cross-protocol read) was explicitly
accepted by human ruling [inbox 2026-07-30T22:20:52.239Z-c68ea4ce], and the
whole document became binding when READY was accepted
[inbox 2026-07-30T23:20:47.483Z-0e6fde8b]. Other loops adopt it via their
own protocols' process docs. The review-mandated amendment to rule 4 below
(engine-SHA condition, per MISSION01-REVIEW M4) was implemented 2026-07-31
(commit 4809a8e, together with gate items M1–M3/M5).

Context: later, parallel agent loops (other models) run the same research
mission in sibling workspaces (`protocols/pair-<model>/`), sharing the engine,
the fleet, and the backtest MySQL. Mission rule: they cooperate, complement,
and verify each other when paths cross naturally — they do not compete and do
not deliberately re-test what another agent verified.

## What is already shared (no design needed)

- **The database is the common ground truth.** Every run carries
  `protocol='pair-<model>'` and `model=<model-id>` (RULES provenance pins), so
  any loop can read any other loop's results by run id. `compare.ts` works
  across protocols unchanged — it only needs run ids.
- **The fleet is a shared FIFO** — batches from different loops interleave
  safely (verified mechanics in `capabilities/fleet.md`).

## Conventions (the proposal)

1. **Cross-protocol READ, own-protocol WRITE.** A loop may read any
   `protocols/pair-*/memory/**` and `state/PROPOSALS.md`; it writes only its
   own workspace (the pre-commit hook enforces the write side already).
   CONFIRMED by human ruling [inbox 2026-07-30T22:20:52.239Z-c68ea4ce]: the
   CLAUDE.md "do not read protocol internals" rule is about normal dev
   sessions; pair-* loops may read each other's `memory/**` and
   `state/PROPOSALS.md`; writes remain own-protocol (hook-enforced).
2. **Import by citation, not by re-verification.** A verified engine fact
   from another loop's capability notes is adopted by citing it —
   `[per pair-<model> capabilities/<file>.md @ <sha>, run <id>]` — when the
   evidence is a run id (checkable in the shared DB) or code refs at a SHA.
   Re-verifying a *verified engine fact* is waste (memory convention 2).
   STRATEGY results are different: a surprising or load-bearing claim (e.g. a
   champion's OOS ev) may be verified from the DB rows directly — that is
   reading evidence, not re-running.
3. **Scan before starting a family.** Before opening a new variant family /
   idea axis, grep the other loops' `experiments/LEDGER.md` for the same axis.
   If found: read their family file and either (a) build on it from a
   different param region or design angle (complement), or (b) drop the axis
   if their time-scoped KILL is recent and the reasoning transfers. A KILL
   older than 60 days may be re-tested per the evaluator's re-test rule —
   note the cross-reference in both directions (theirs stays untouched; cite
   it in ours).
4. **No duplicate heavy runs.** Before a FULL-universe run, check
   `backtest_runs` for an existing completed run with the same strategy id +
   params + latency (any protocol): `results.ts`/`sql.ts` query, ~seconds.
   Reuse the run id instead of re-running 10.7k markets — PROVIDED the run
   is engine-compatible (MISSION01-REVIEW M4, implemented 2026-07-31): check
   the run's `commit_sha` (evaluate.ts/compare.ts surface it and warn on
   mismatch) against current origin/main; if engine commits landed in
   between, verify none is semantic drift (fill model, fees, tick
   semantics — `refresh-capabilities.ts` classifies the watched paths)
   before reusing. Never reuse across semantic engine drift.
5. **Fleet courtesy.** Check `fleet.ts` before submitting a FULL run; if
   another loop's large batch is active, either wait or submit anyway and
   accept queueing — never stop/drain workers or touch another loop's jobs.
6. **Portfolio is cross-model.** Independence (daily-pnl Pearson r < 0.6 over
   ≥14 common days, evaluator.md) is measured between variants regardless of
   which loop authored them; the portfolio admits the best independent set
   across all loops. Champion comparisons across loops use the slug
   intersection of their OOS windows (same rule as intra-loop dethroning).
7. **Disagreements are data.** If loop B's evidence contradicts loop A's
   note, B records the contradiction in its own memory with both run ids and
   files a PROPOSALS entry if an engine fact is at stake — B never edits A's
   files. The human arbitrates only if the loops cannot resolve it by
   evidence.

## What this buys

- Verification "when paths cross naturally": DB-mediated, zero coordination
  overhead — no locks, no shared mutable files, no messaging protocol.
- Complementarity: the LEDGER scan (rule 3) plus pre-registration
  (evaluator.md guard 1) makes each loop's search legible to the others
  before results exist.
- The only new human decision needed: confirm cross-protocol read (rule 1).
