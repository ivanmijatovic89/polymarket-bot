# Research Memory

Research memory is the file-based record that lets the next human or agent
continue without reading chat history.

## Authority

This file is authoritative for research memory rules in Strategy Research
Protocol:

- which files store memory
- what belongs in each memory file
- when memory must be updated
- how to record results, lessons, duplicates, champions, and retry conditions

It is not authoritative for research scope, engine behavior, naming, versioning,
or evaluation thresholds. Those rules live in their dedicated protocol files.

## Memory Files

Research memory lives in three files:

```text
src/strategies/research/<family>/FAMILY.md
src/strategies/research/<family>/FAMILY.json
src/strategies/research/INDEX.json
```

Strategy source files such as `000-baseline.ts` and `<experiment-id>.ts` are
executable artifacts, not memory files, but experiments must reference the
strategy file they run.

## FAMILY.md

`src/strategies/research/<family>/FAMILY.md` is the human-readable memory for
one strategy family.

Use it for:

- the family hypothesis and core idea
- the primary decision driver
- experiment ideas that are not yet queued
- experiment log entries
- plain-English lessons from results
- known weaknesses and failure modes
- duplicate notes and near-duplicate reasoning

`FAMILY.md` should explain why the family exists and what has been learned. It
should be readable without inspecting raw backtest output.

Its YAML frontmatter is intentionally minimal:

```yaml
---
artifactType: strategy-family
family: <family>
---
```

Do not duplicate structured state such as `status`, `champion`, or `tags` in
`FAMILY.md`. Those fields live in `FAMILY.json`.

## FAMILY.json

`src/strategies/research/<family>/FAMILY.json` is the structured state for one
strategy family.

Use it for:

- family status
- duplicate keys
- retry condition
- champion experiment id
- exact experiment queue
- experiment status
- evaluator decision
- result references
- selected params
- strategy code file per experiment

`FAMILY.json` is the machine-readable source for tools and index generation. Do
not put unqueued future ideas here; keep those in `FAMILY.md` until they become
real experiments.

`FAMILY.json` is authoritative for `status`, `champion`, `tags`,
`duplicateKeys`, `retryOnlyIf`, and the experiment queue.

## INDEX.json

[`src/strategies/research/INDEX.json`](../src/strategies/research/INDEX.json) is
the generated global memory used for discovery and deduplication.

Do not hand-edit it. Rebuild it with the `buildStrategyIndex` tool after adding,
renaming, removing, or changing family metadata.

## Update Triggers

Update research memory after any meaningful research step:

- a new family is proposed
- a backtest is submitted
- a backtest result becomes available
- result coverage is extended
- an experiment is evaluated
- selected params are chosen
- an experiment is added, killed, or superseded
- a family is promoted, killed, or blocked
- a duplicate or near-duplicate is discovered
- a retry condition changes

The next agent must be able to continue from files alone.

## Result References

Backtest results must be recorded with enough information to retrieve the
numeric truth later.

At minimum, `FAMILY.json` should store the run id or batch uid in the relevant
experiment result reference. `FAMILY.md` should summarize what was run, what was
learned, and where to retrieve the persisted result.

Do not rely on terminal output or chat messages as the only record of a result.

## Duplicate Memory

Duplicate memory has two forms:

- `duplicateKeys` in `FAMILY.json` stores normalized machine-readable synonyms.
- `Duplicate notes` in `FAMILY.md` explains the human reasoning.

When a family is killed or blocked as duplicate, record the family it overlaps
with and the condition, if any, that would make revisiting it worthwhile.

## Retry Conditions

Killed or blocked families should set `retryOnlyIf` to a concrete condition.

Good retry conditions are specific:

```text
Replay includes top-of-book queue position with live-equivalent semantics.
```

Bad retry conditions are vague:

```text
Maybe try later.
```

## Consistency Rules

- Research conclusions must not live only in chat history.
- `FAMILY.md` and `FAMILY.json` must not contradict each other.
- Do not hand-edit `INDEX.json`.
- Do not seed speculative future ideas into `FAMILY.json`.
- Result references must be retrievable later.
- Duplicate notes should match `duplicateKeys`.
- A champion must be an experiment recorded in the family.
- A killed or blocked family needs a concrete `retryOnlyIf`.

## Final Memory Check

Before finishing a research step, verify:

- `FAMILY.md` records the human-readable lesson or decision.
- `FAMILY.json` records the structured state change.
- `INDEX.json` was rebuilt or checked if family metadata changed.
- Result references are enough to retrieve persisted results.
- The next agent can continue without chat history.
