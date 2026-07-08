# Glossary

This file defines common terms used by Strategy Research Protocol —
one-or-two-sentence definitions with a link to each term's home. Rules live
in the home files, never here (AGENTS.md, One Home Per Concept).

## Strategy Research Protocol

The research layer in `strategy-research-protocol/`. It manages strategy
families, experiments, result references, evaluation decisions, and research
memory. It does not execute live trading or replay itself.

## PolymarketTwinEngine

The executable engine in the parent `polymarket-bot` repository. It owns market
data, live execution, replay, order management, portfolio handling, and
persisted backtest results. Contract:
[`strategy-research-protocol/ENGINE.md`](./ENGINE.md).

## BTC 15m Up/Down Market

A Polymarket binary market for one fixed 15 minute Bitcoin episode. `UP` wins if
BTC closes above the window reference price; `DOWN` wins if BTC closes below it.

## Strategy Family

A group of strategy variants that share the same primary decision driver.
Parameter changes and filters are experiments inside a family. A different
primary decision driver is a different family.

## Experiment

One pre-declared test inside a strategy family: a `hypothesis` and
`successCriteria` written before running, the strategy code and params (or
coordinate search) used, run references, and the judged `outcome`. Fields
and lifecycle: [`strategy-research-protocol/MEMORY.md`](./MEMORY.md).

## Coordinate Search

The default parameter-search mode: one pass sweeps ONE param while the others
stay at declared defaults / previous winners, then the next param. Fewer runs
and less multiple-testing noise than a full Cartesian grid.

## Pass

One step of a coordinate search: the sweep of a single param, with its own
batchUid and submissionUids. Fields:
[`strategy-research-protocol/MEMORY.md`](./MEMORY.md).

## Baseline

`000-baseline` — the reserved first experiment of every family: a coordinate
search over the baseline code, testing whether any parameter region can
plausibly beat execution costs at stage-1 coverage.

## Verdict

The judgment on an evaluated experiment against its pre-declared
`successCriteria`: `success`, `fail`, or `inconclusive`. Lives inside
`outcome`, never a status.

## Stage / Gate

A stage is a coverage level of increasing data investment; a gate is the
pre-declared pass/fail criterion between stages. Home:
[`strategy-research-protocol/STAGE-GATES.md`](./STAGE-GATES.md).

## Cross-Family Lessons

[`strategy-research-protocol/LESSONS.md`](./LESSONS.md) — append-only
protocol-level memory of lessons that generalize beyond one family.

## Smoke Run

A tiny pre-submission sanity run (batchUid suffix `--smoke`). Catches crashes
and param bugs. Never evidence, never freezes code, never judged.

## Submission UID

The auto-generated unique handle of one backtest submission, identical in
Redis and `backtest_runs.submission_uid`. Recorded in FAMILY.json at submit
time.

## Baseline ID

`--baselineId <runId>` — the comparison-anchor run recorded on every evidence
submission, so dashboard and judgment comparisons have an explicit anchor.

## Researcher

The LLM worker that drives one family: specs, runs, judges, and logs
experiments, and decides continue-or-kill. Contract:
[`strategy-research-protocol/modules/Researcher.md`](./modules/Researcher.md).

## Champion

The family's current best experiment, stored as a pointer (`champion`) in
FAMILY.json. Pointer rules:
[`strategy-research-protocol/rules/NAMING.md`](./rules/NAMING.md).

## Research Memory

The file-based record that lets another agent continue without chat history.
Home: [`strategy-research-protocol/MEMORY.md`](./MEMORY.md).

## FAMILY.md

`src/strategies/research/<family>/FAMILY.md` — the reasoning memory for one
family: write-once proposal sections plus the append-only Research log.
Sections: [`strategy-research-protocol/MEMORY.md`](./MEMORY.md).

## FAMILY.json

`src/strategies/research/<family>/FAMILY.json` — the exact facts for one
family: statuses, experiment records, run references, outcomes. Fields:
[`strategy-research-protocol/MEMORY.md`](./MEMORY.md).

## INDEX.json

[`src/strategies/research/INDEX.json`](../src/strategies/research/INDEX.json) is
the generated global research index used for discovery and deduplication. Do not
hand-edit it.

## Live/Backtest Parity

The invariant that live trading and backtests must run the same strategy logic
on the same tick stream semantics. A live/backtest divergence is a bug.

## Strategy Tick

A strategy-facing market event emitted by the shared market engine. The current
meaningful tick types are `book` and `price_change`.

## Telonex Delta

The default research dataset mode: Telonex market data converted to delta-typed
parquet for BTC 15 minute up/down markets.

## Backtest Run

One submitted execution of a strategy over a selected market set. A run produces
persisted result rows and should be referenced by run id or batch uid.

## Batch UID

The human-chosen grouping label of a backtest submission. Format and rules:
[`strategy-research-protocol/rules/NAMING.md`](./rules/NAMING.md).

## Market Result

The backtest outcome for one 15 minute market episode.

## Segment

A grouped result slice, usually by params, market subset, or time window.
Segments are used for robustness and stability checks.

## Distributed Worker

A worker process or machine that consumes backtest jobs from Redis/BullMQ.
Distributed workers let one batch run across multiple machines.

## Market Worker

A worker that consumes independent per-market replay jobs. Sibling machines can
run market workers without database credentials or Polymarket trading keys.

## Aggregate Worker

The worker that finalizes a batch after market jobs finish. It writes persisted
result tables and must run on a machine with database access.
