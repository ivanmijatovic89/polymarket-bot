# Glossary

This file defines common terms used by Strategy Research Protocol.

## Strategy Research Protocol

The research layer in `strategy-research-protocol/`. It manages strategy
families, experiments, result references, evaluation decisions, and research
memory. It does not execute live trading or replay itself.

## PolymarketTwinEngine

The executable engine in the parent `polymarket-bot` repository. It owns market
data, live execution, replay, order management, portfolio handling, and
persisted backtest results.

## BTC 15m Up/Down Market

A Polymarket binary market for one fixed 15 minute Bitcoin episode. `UP` wins if
BTC closes above the window reference price; `DOWN` wins if BTC closes below it.

## Strategy Family

A group of strategy variants that share the same primary decision driver.
Parameter changes and filters are experiments inside a family. A different
primary decision driver is a different family.

## Experiment

One proposed test inside a strategy family. An experiment should define what is
being tested, which strategy code and params are used, and which backtest result
references prove what happened.

## Baseline Sweep

The first experiment for a new family. It tests whether the family has any
parameter region that can plausibly beat execution costs.

## Research Memory

The file-based record that lets another agent continue without chat history.
Research memory lives mainly in `src/strategies/research/<family>/FAMILY.md`,
`src/strategies/research/<family>/FAMILY.json`, and
[`src/strategies/research/INDEX.json`](../src/strategies/research/INDEX.json).
Rules are defined in [`strategy-research-protocol/MEMORY.md`](./MEMORY.md).

## FAMILY.md

`src/strategies/research/<family>/FAMILY.md` is the human-readable memory for
one strategy family: hypothesis, decision driver, experiment menu, lessons,
weaknesses, and duplicate notes.

## FAMILY.json

`src/strategies/research/<family>/FAMILY.json` is the structured state for one
strategy family: status, experiment queue, result references, decisions,
selected params, champion, retry conditions, and duplicate keys.

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

An identifier used to track queued or detached backtest execution, especially
while workers are still running.

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
