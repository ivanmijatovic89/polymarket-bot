# PolymarketTwinEngine

PolymarketTwinEngine is the trading and replay engine underneath Strategy
Research Protocol.

## Mental Model

PolymarketTwinEngine is the executable system that can run the same strategy
logic in two modes:

- live mode, against real Polymarket market, account, and order events
- backtest mode, against recorded or converted market events

The engine owns market data, replay, execution simulation, live trading
plumbing, and backtest result production.

Strategy Research Protocol does not replace the engine. It organizes research
around the engine: strategy families, experiments, results, decisions, and
memory.

This file defines only the engine contract that research agents can rely on.
Detailed implementation docs live in the parent repo docs.

## Scope

Current protocol scope is:

```text
Polymarket BTC 15 minute up/down binary markets
```

One market is one fixed 15 minute episode. There are normally 96 BTC 15 minute
episodes per day.

The engine may support more than this, but Strategy Research Protocol should not
use other symbols, timeframes, venues, or cross-exchange signals unless
[`strategy-research-protocol/RESEARCH_SCOPE.md`](./RESEARCH_SCOPE.md) is
explicitly updated.

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
- Producing persisted backtest results.
- Running backtest jobs locally or through workers.

The engine is not responsible for proposing families, evaluating strategy
quality, preserving research memory, or promoting/killing families.

## Parity Contract

Live trading and backtests must run the same strategy logic on the same tick
stream semantics.

For research, this means:

- Backtests must not depend on fields or timing unavailable live.
- Live strategies must not depend on unrecorded behavior that replay cannot
  reproduce.
- Market rotation and 15 minute window handling must mean the same thing live
  and in replay.
- Order, fill, position, and portfolio events must remain deterministic enough
  for replay analysis.

If a protocol change weakens this contract, treat it as a bug.

## Strategy Tick Semantics

Strategies should reason from engine ticks, not raw transport details.

The shared `MarketEngine` decodes raw market messages, updates the order book,
and emits strategy-friendly ticks only for meaningful market events:

- `book`
- `price_change`

Research ideas that require live-only WebSocket fields or unrecorded transport
behavior are out of scope.

## Dataset And Replay

The default research dataset is Telonex converted to delta-typed parquet.

Expected dataset shape:

- `symbol=btc`
- `timeframe=15m`
- one parquet file per market
- one market equals one 15 minute BTC up/down episode
- replay emits the same meaningful event semantics used by strategy ticks

Backtest results should preserve enough dataset context to be reproducible:
input mode, read source, symbol, timeframe, market selection, market count, and
run id or batch uid.

## Backtest Concepts

The protocol should use these engine terms consistently:

- Backtest run - one submitted execution of a strategy over a selected market
  set.
- Market result - one strategy outcome for one 15 minute market.
- Segment - a grouped result slice, usually by params, market subset, or time
  window.
- Batch uid - identifier used for queued or detached backtest tracking.

Aggregate results are not enough. Evaluation should also inspect market count,
failed/skipped markets, outlier concentration, costs, fills, and segment
stability.

## Distributed Backtesting

Backtesting is not only a local CLI loop. The engine can distribute one backtest
batch across multiple worker machines.

Expected protocol mental model:

- The producer submits one batch.
- Redis/BullMQ holds market jobs.
- Worker machines consume independent market jobs.
- One aggregate worker finalizes the batch into persisted result tables.
- Sibling machines can run `markets` only; they do not need database credentials
  or Polymarket trading keys.
- Long-running workers should use the self-updating launcher so they run the
  commit required by each job.

This matters for research because large sweeps and coverage extensions may run
on several MacBooks or other worker machines at once. Agents should treat worker
execution as the normal path for meaningful runs, not as a separate research
concept.

## Backtest Speed And Sizing

Backtest speed depends on market count, active worker slots, replay data access,
and strategy cost per tick.

Use these as rough planning anchors, not promises:

- Measured replay profile: average market replay is about 1.5 seconds.
- Most BTC 15m markets are in the 1-2 second replay band.
- Rough wall time estimate:

```text
markets * 1.5s / active worker slots
```

Examples:

- 500 markets on 10 active worker slots: about 75 seconds.
- 6,000 markets on 20 active worker slots: about 7.5 minutes.
- 18,000 markets on 30 active worker slots: about 15 minutes.

Always verify actual speed from persisted execution metadata and the dashboard.
Per-market rows store worker identity, duration, event counts, and commit SHA
when timing metadata is available.

## Existing Engine Documentation

Use these docs when more detail is needed:

- Market and tick engine:
  [`docs/engine/market-engine.md`](../docs/engine/market-engine.md)
- Order book engine:
  [`docs/engine/orderbook-engine.md`](../docs/engine/orderbook-engine.md)
- Strategy runner:
  [`docs/engine/strategy-runner.md`](../docs/engine/strategy-runner.md)
- Live execution:
  [`docs/engine/live-execution.md`](../docs/engine/live-execution.md)
- Backtest execution:
  [`docs/engine/backtest-execution.md`](../docs/engine/backtest-execution.md)
- Distributed workers:
  [`docs/backtest/distributed-future.md`](../docs/backtest/distributed-future.md)
- Backtest parallelization:
  [`docs/backtest/parallelization.md`](../docs/backtest/parallelization.md)
- Worker self-update:
  [`docs/backtest/worker-self-update.md`](../docs/backtest/worker-self-update.md)
- Worker install:
  [`docs/backtest/worker-install-instructions.md`](../docs/backtest/worker-install-instructions.md)
- Order manager:
  [`docs/engine/order-manager.md`](../docs/engine/order-manager.md)
- Portfolio:
  [`docs/engine/portfolio.md`](../docs/engine/portfolio.md)
- Backtest result storage:
  [`docs/backtest/statistics/result-storage.md`](../docs/backtest/statistics/result-storage.md)
- Telonex datasets:
  [`docs/datasets/telonex/overview.md`](../docs/datasets/telonex/overview.md)
- Polymarket background:
  [`docs/polymarket/index.md`](../docs/polymarket/index.md)

## Engine Tools

Use tool docs for executable details:

- [`strategy-research-protocol/tools/runBacktest.md`](./tools/runBacktest.md) -
  create a new backtest run.
- [`strategy-research-protocol/tools/extendBacktest.md`](./tools/extendBacktest.md) -
  add coverage to an existing Telonex run.
- [`strategy-research-protocol/tools/getBacktestResults.md`](./tools/getBacktestResults.md) -
  retrieve persisted result summaries.
- [`strategy-research-protocol/tools/buildStrategyIndex.md`](./tools/buildStrategyIndex.md) -
  regenerate research family index memory.

Worker modules should call these tools by name instead of repeating command or
API syntax.

## Research Memory Contract

Engine results must be referenced from research artifacts:

- `src/strategies/research/<family>/FAMILY.json` stores structured result
  references such as run id or batch uid.
- `src/strategies/research/<family>/FAMILY.md` stores the human-readable lesson
  from the result.
- [`src/strategies/research/INDEX.json`](../src/strategies/research/INDEX.json)
  is regenerated from family metadata; do not hand-edit it.

The same research conclusion should be recoverable from files without reading
chat history.
