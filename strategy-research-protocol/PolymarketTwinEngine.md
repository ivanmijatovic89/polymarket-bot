# PolymarketTwinEngine

PolymarketTwinEngine is the trading and replay engine underneath Strategy
Research Protocol.

The research protocol uses this engine to run strategy ideas against Polymarket
BTC 15 minute up/down markets. The engine owns market data, replay, execution
simulation, live trading plumbing, and backtest result production. The protocol
owns research state: strategy families, experiments, evaluation decisions, and
research memory.

This document is a contract for agents. It explains what the protocol can rely
on from the engine and which engine actions should be wrapped as protocol tools.

## Scope

Current research scope is only:

```text
Polymarket BTC 15 minute up/down binary markets
```

One market is one fixed 15 minute episode. There are normally 96 such BTC
episodes per day.

The engine may support other symbols, timeframes, or data sources, but Strategy
Research Protocol should not use them unless `RESEARCH_SCOPE.md` is explicitly
updated.

## Engine Responsibilities

PolymarketTwinEngine is responsible for:

- Recording live Polymarket market events.
- Loading recorded or converted market data for replay.
- Decoding market channel messages.
- Maintaining order book state.
- Emitting strategy ticks on meaningful market events.
- Running strategy code in live and backtest modes.
- Simulating or handling order lifecycle events.
- Tracking fills, positions, balances, and redeem behavior.
- Producing backtest run results that the research protocol can reference.
- Running backtest jobs locally or through distributed workers.

The engine is not responsible for:

- Proposing strategy families.
- Deciding whether a strategy is good.
- Preserving research memory.
- Updating `FAMILY.md`, `FAMILY.json`, or `INDEX.json`.
- Promoting or killing strategy families.

Those decisions belong to Strategy Research Protocol.

## Core Parity Contract

The most important engine contract is live/backtest parity:

```text
Live trading and backtests must run the same strategy logic on the same tick
stream semantics.
```

For research, this means:

- A strategy result is only meaningful if the same strategy code can run live.
- A backtest must not depend on fields or timing that live trading cannot see.
- Live trading must not depend on unrecorded fields that replay cannot reproduce.
- Market rotation and 15 minute window handling must mean the same thing in live
  and backtest.
- Order, fill, position, and portfolio events must remain deterministic enough
  for replay analysis.

If a protocol change weakens this contract, treat it as a bug.

## Strategy Tick Semantics

Strategies should reason from engine ticks, not raw transport details.

The shared `MarketEngine` decodes raw market messages, updates the order book,
and emits strategy-friendly ticks only for meaningful market events:

- `book`
- `price_change`

This tick cadence is central. Research modules and tools should assume that
strategy decisions are driven by these meaningful ticks plus shared account,
order, fill, and market metadata events.

Do not introduce research ideas that require live-only WebSocket fields or
unrecorded transport behavior.

## Dataset And Replay

The default research dataset is Telonex converted to delta-typed parquet.

Expected dataset shape:

- `symbol=btc`
- `timeframe=15m`
- one parquet file per market
- one market equals one 15 minute BTC up/down episode
- replay emits the same meaningful event semantics used by strategy ticks

The protocol should treat dataset selection as part of an experiment's
definition. A backtest result without enough dataset context is not a complete
research result.

Minimum dataset context to preserve in research memory:

- input mode
- read source
- symbol
- timeframe
- market selection method
- market count
- date/time range when available
- run id or batch uid
- command/tool used to produce the result

## Backtest Concepts

The engine supports several backtest concepts that the protocol should name
consistently.

### Backtest Run

A backtest run is one submitted execution of a strategy over a selected market
set.

A run should answer:

- Which strategy code was tested?
- Which params or sweep were tested?
- Which dataset and market selection were used?
- Was it run sequentially, queued, or detached?
- What run id or batch uid identifies the result?

### Backtest Market Result

A market result is the strategy outcome for one 15 minute market episode.

Market-level results matter because a positive aggregate can hide concentration
in a few outlier markets. Evaluators should inspect market count, skipped
markets, failed markets, outliers, and open/close behavior before trusting a
result.

### Backtest Segment

A segment is a grouped result slice, usually by params, market subset, time
window, or another analysis dimension.

Segments are useful for parameter sweeps and robustness checks. A segment should
not be promoted just because it is the best cell in a noisy grid. The evaluator
must check sample size, concentration, stability, and execution plausibility.

## Run Backtest

Running a backtest creates a new result from a strategy and a market selection.

For this protocol, the default run should target BTC 15m Telonex delta-typed
data.

The current command family is:

```bash
npm run backtest:telonex:btc:15m -- --strategy <strategy-id>
```

Equivalent explicit command:

```bash
npm run backtest -- --input-mode telonex-delta --read-from local --symbol btc --timeframe 15m --strategy <strategy-id>
```

Important flags used by the engine include:

- `--strategy <id>` - strategy to run.
- `--param <key=value>` - strategy parameter override.
- `--limit <n>` - limit selected markets.
- `--latest` - select latest eligible markets.
- `--random` - select random eligible markets.
- `--from-ms <epoch-ms>` / `--to-ms <epoch-ms>` - restrict market start range.
- `--sequential` - run locally in process, useful for smoke tests.
- `--detach` - enqueue work and return a batch identifier.

The research protocol should not spread these commands across worker modules.
Instead, define a protocol tool named `runBacktest` that owns the command shape,
required metadata, and expected output capture.

## Extend Backtest

Extending a backtest means taking an existing run and adding more eligible
markets while inheriting the parent run's strategy, params, symbol, timeframe,
input mode, and read source.

The engine supports this through `--extend <run-id>`.

Example command shape:

```bash
npm run backtest -- --extend <run-id> --limit <n>
```

or:

```bash
npm run backtest -- --extend <run-id> --from-ms <epoch-ms> --to-ms <epoch-ms>
```

Extension semantics are intentionally strict. When `--extend` is used, strategy,
params, symbol, timeframe, input mode, read source, explicit slug selection, and
file paths are inherited from the parent run and must not be supplied again.

The research protocol should expose this as a separate protocol tool named
`extendBacktest`. That keeps the agent decision clear:

- use `runBacktest` to create a new run
- use `extendBacktest` to increase coverage for an existing run

## Get Backtest Results

The protocol needs a reliable way to retrieve run, market, and segment results
after a backtest finishes.

This should be a protocol tool named `getBacktestResults`.

The tool should accept one of:

- run id
- batch uid
- experiment id, if the protocol later maps experiments to runs

The tool should return a compact result summary suitable for an evaluator:

- run id and batch uid
- strategy id and code reference
- params or sweep cell
- dataset identity
- market count
- skipped/failed count
- net pnl / EV metrics after costs
- trade count and fill count
- worst and best markets
- outlier concentration
- market-level result link or reference
- segment summaries

Agents should not evaluate from terminal output alone when a structured result
store is available. Evaluation should reference persisted result identifiers in
`FAMILY.json`.

## Distributed Workers

The engine can run queued backtests through workers.

Useful commands:

```bash
npm run backtest:worker
```

Self-updating worker launcher:

```bash
./scripts/run-worker.sh --queues markets --market-concurrency 5
```

Worker behavior matters for research because long parameter sweeps and larger
coverage runs may not finish in a single local process.

Protocol assumptions for workers:

- Workers execute the same strategy code and replay semantics as local
  backtests.
- Workers must not change strategy behavior.
- A worker should not silently run stale strategy code for a submitted job.
- Result ids or batch uids must be preserved so experiments can reference them.

The protocol should treat workers as an execution backend for `runBacktest` and
`extendBacktest`, not as a separate research concept.

## Tool Design For Agents

Raw CLI commands are implementation details. Agents should primarily use
protocol tools because tools can define inputs, outputs, invariants, and memory
updates.

Recommended tool contracts:

- `runBacktest` - create a new backtest run for one experiment.
- `extendBacktest` - add market coverage to an existing run.
- `getBacktestResults` - retrieve structured result summaries for evaluation.
- `buildStrategyIndex` - regenerate global research memory after family
  metadata changes.

Each tool should have a file in `strategy-research-protocol/tools/` that
documents:

- purpose
- when to use it
- when not to use it
- command or API used underneath
- required inputs
- expected outputs
- files or database rows it reads
- files or database rows it writes
- result identifiers agents must preserve
- expected AI behavior after success or failure

Worker modules should call tools by name. They should not duplicate raw command
syntax.

## How Research Artifacts Should Reference Engine Results

`FAMILY.json` should store structured references to engine results, not copied
terminal output.

For each experiment result, preserve enough information for a future agent to
retrieve and verify the result:

- result status
- run id or batch uid
- strategy code filename
- selected params or sweep cell
- dataset selection
- market count
- summary metrics
- path, URL, or database reference for detailed results

`FAMILY.md` should summarize the lesson learned in human-readable form:

- what was tested
- what happened
- why it matters
- what weakness or follow-up was discovered

The same research conclusion should be recoverable from files without reading
chat history.

## Agent Navigation

When an agent needs to work with the engine from this protocol folder, use this
order:

1. Read `README.md` to understand the protocol.
2. Read `RESEARCH_SCOPE.md` to confirm market/data/cost assumptions.
3. Read this file to understand engine capabilities and result concepts.
4. Read the relevant module in `modules/`.
5. Read the relevant tool contract in `tools/`.
6. Run the tool command only after the tool contract is clear.
7. Update `FAMILY.md`, `FAMILY.json`, and `INDEX.json` when research state
   changes.

Do not skip directly from a research idea to a raw backtest command unless the
tool contract does not exist yet and the user explicitly wants an exploratory
manual run.

## Open Protocol Work

The engine capabilities exist before the protocol wrappers are complete.

To make this easy for future agents, define these next:

- `tools/runBacktest.md`
- `tools/extendBacktest.md`
- `tools/getBacktestResults.md`
- `modules/EvaluateExperiment.md`
- `modules/ResearchFamily.md`

After those exist, research workers can say "run baseline experiment", "extend
coverage", and "evaluate result" without inventing command syntax or result
handling.
