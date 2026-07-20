# PolymarketTwinEngine

PolymarketTwinEngine is the trading and replay engine underneath Strategy
Research Protocol. The protocol relies on one invariant:

```text
live trading and backtests run the same strategy logic on the same market tick semantics
```

This file is the concrete engine contract that research agents can rely on.
Implementation detail lives in the parent repo docs linked at the end.

## Research Scope

The research scope — venue, instrument, symbol, timeframe, allowed inputs —
is defined in [`strategy-research-protocol/SCOPE.md`](./SCOPE.md). The
engine supports more modes than the scope allows; do not use them for
research unless SCOPE.md is updated first. One BTC 15m market is one fixed
15 minute episode; there are normally 96 episodes per day.

## Live/Backtest Parity

Both live and backtest modes pass market data through the same shared
`MarketEngine`, `MarketOrderBookEngine`, `StrategyRunner`, `OrderManager`, and
`Portfolio` contracts.

For research, parity means:

- Strategy decisions must depend on fields available in both live and replay.
- Market rotation and 15 minute window handling must mean the same thing live
  and in replay.
- Order, fill, position, and portfolio events must remain deterministic enough
  for replay analysis.
- External feeds and plugin data must be optional. A strategy must tolerate
  missing live-only feed data in backtests.

Any protocol change that makes a profitable backtest impossible to reproduce
live is a bug.

## Market Tick Semantics

Strategies do not receive raw WebSocket transport events. The shared
`MarketEngine`:

1. decodes one raw market message,
2. applies it to `MarketOrderBookEngine`,
3. emits a strategy tick only for meaningful book-changing events.

Tick-producing event types:

- `book` - full orderbook snapshot replacement for one asset.
- `price_change` - level updates where `size` is the new aggregate size at the
  price level, not a delta.

Non-tick event types:

- `tick_size_change` - updates tick-size metadata but does not emit a strategy
  tick.
- `last_trade_price` - records recent trade data but does not mutate the book
  and does not emit a strategy tick.
- synthetic recorder events such as `disconnect`, `window_end`, and
  `writer_lag_disconnect` are dropped before the strategy layer.

For `price_change`, size `0` removes the level. Non-zero size upserts the level.
Bids are kept in descending price order, asks in ascending price order.

Each snapshot exposes top-of-book fields and depth arrays:

- `bestBid`, `bestAsk`, `mid`, `spread`
- `bids`, `asks`
- `bidsDepthByLevel`, `asksDepthByLevel`
- `depthLevels = 10`

Strategies should reason from these tick snapshots, not from raw transport
messages or recorder artifacts.

## Dataset And Replay Shape

Default research replay uses Telonex converted parquet:

```text
--input-mode telonex-delta
--converter delta-typed
--symbol btc
--timeframe 15m
```

Read source: the research protocol ALWAYS uses
`--read-from local-or-download-from-r2-to-local` (see
[`strategy-research-protocol/tools/runBacktest.md`](./tools/runBacktest.md)).
The engine's full menu, for reference:

- `--read-from local` when all workers already have local parquet files.
- `--read-from local-or-download-from-r2-to-local` when workers may need to
  lazily fetch missing files from R2.
- `--read-from r2` for cloud or disposable workers with no local cache.

Dataset expectations:

- one parquet file per market
- one market equals one BTC 15m up/down episode
- Telonex DB rows provide `asset_id_0` (Up), `asset_id_1` (Down),
  `telonex_status`, and `result_id`
- only resolved Telonex markets count toward statistics
- `telonex-delta` replays typed `book` / `price_change` rows in deterministic
  order

`telonex-paired` is a different replay shape: both Up and Down books are
applied before one strategy tick. Do not mix paired and delta results in one
research conclusion unless the experiment explicitly compares input semantics.

## Episode Boundaries

A 15m market rotation is an episode boundary.

On rotation:

- `MarketEngine.reset()` discards old orderbook state.
- `StrategyRunner` resets plugin state and cached plugin snapshots for the new
  market key.
- Strategy state that is specific to a market should be keyed by market id or
  reset explicitly.

Research ideas that depend on stale levels, plugin windows, or account state
leaking across BTC 15m markets violate the protocol unless they model that
carryover explicitly and safely.

## Strategy Runner Semantics

One strategy tick corresponds to one `book` or `price_change` event after the
orderbook has already been updated.

Within a tick, the runner sequence is:

1. execute queued intents and backtest fills due at the start of the tick,
2. apply resulting account events to `Portfolio`,
3. call strategy `onAccountEvent` for those events,
4. build `StrategyContext`,
5. call strategy `onMarketTick`,
6. route emitted intents through `OrderManager`,
7. drain any cascaded account events until the queue is empty or the safety cap
   is reached.

Important defaults:

- Backtests use queued intent execution: intents emitted on tick N are flushed
  at the start of tick N+1.
- Live trading uses immediate intent execution for lower latency.
- Account-event cascade safety cap: 100 events per drain.
- Plugin snapshots are cached per market tick and reused for cascaded
  `onAccountEvent` calls inside that tick.
- Backtests that use the TechnicalIndicators plugin must run with
  `BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS=1`, or indicator values are not
  warmed before strategy ticks — results would be silently degenerate.
- Backtests omit live-only `ctx.warmup`; strategy helpers treat warmup as true
  in backtest mode.

Strategies must build deterministic `clientOrderId` values. Deduplication is by
`clientOrderId`, not by equivalent price, side, or size.

## Order And Intent Semantics

All strategy intents go through `OrderManager` before execution. The manager
validates and deduplicates intents, applies risk limits, and emits deterministic
account events.

Supported order behavior:

- `place_limit` and `place_batch`
- `cancel_order` and `cancel_all`
- `split_positions` and `merge_positions`
- order types `FOK`, `GTC`, and `GTD`
- GTD expiry must be at least 60 seconds in the future
- live batch placement rejects batches larger than 15 orders

Core account event kinds:

- `order_submitted`
- `order_accepted`
- `order_open`
- `order_rejected`
- `fill`
- `order_done`
- `positions_split`
- `positions_merged`

Live execution emits `order_accepted` from REST order submission, while
`order_open`, fills, and terminal lifecycle updates usually arrive through the
user WebSocket channel. Backtest execution simulates lifecycle events from the
replayed orderbook.

## Backtest Execution Model

`BacktestExecution` simulates orders without contacting Polymarket or Polygon.

Default execution assumptions:

- maker fill mode: `worst_queue`
- maker BUY fills only when `bestAsk < restingPrice`
- maker SELL fills only when `bestBid > restingPrice`
- maker fills execute at the resting limit price
- current maker model fills the full remaining quantity, not partial maker
  queue fills
- taker fills consume opposite book levels until the limit price or size is
  exhausted
- default backtest taker fee: `BACKTEST_TAKER_FEE_BPS=156`
- split and merge are simulated immediately

`FOK` orders are killed when currently fillable size is insufficient. `GTC` and
`GTD` orders first try an immediate taker fill; any remainder rests and is
checked on later ticks. Resting `GTD` orders expire when replay exchange time
reaches `expireAtMs`.

Backtests emit `MATCHED` status for resting and partially filled orders.
`MINED` and `CONFIRMED` are not simulated. Strategies that require on-chain
status before selling or merging must account for that explicitly or they will
not exercise those paths in backtests.

## Latency And Fees

The default research run should use zero explicit latency unless the experiment
is testing latency sensitivity.

Backtest latency is controlled by:

```text
BACKTEST_LATENCY_DELAY=<milliseconds>
BACKTEST_LATENCY_JITTER=<milliseconds>
```

Effective operation time is:

```text
executeAtMs = max(nowMs, nowMs + delay + uniform(-jitter, +jitter))
```

Latency can apply to:

- `placeLimit`
- `placeBatch`
- `cancelOrder`
- `cancelAll`

Split and merge are immediate in backtests. With non-zero latency, a cancel can
arrive after a fill and become a no-op.

For bit-identical verification across sequential and worker execution, set
`BACKTEST_LATENCY_JITTER=0` and avoid strategy-level randomness.

Taker fee model:

- default `BACKTEST_TAKER_FEE_BPS=156`
- invalid or negative fee values fall back to `156`
- maker fills do not carry a taker fee
- live mode uses the CLOB fee rate returned by the exchange

## Portfolio Semantics

`Portfolio` is the shared in-memory account state machine.

Concrete behavior agents must preserve:

- positions are keyed by CLOB token id
- BUY fills update average cost and quantity
- SELL fills reduce cost basis proportionally and update realized PnL
- duplicate fills are ignored through a `seenFillIds` cache capped at 50,000
- out-of-order fill and trade-status events are buffered until
  `orderId -> clientOrderId` is known
- order snapshots are retained up to 10,000 entries
- persistent `orderId -> clientOrderId` snapshot index is retained up to 50,000
  entries

Polymarket trade status rank:

| Status      | Rank | Meaning                                |
| ----------- | ---- | -------------------------------------- |
| `MATCHED`   | 1    | CLOB matched, not necessarily on-chain |
| `MINED`     | 2    | transaction included on Polygon        |
| `CONFIRMED` | 3    | block finalized                        |

Live strategies must not sell or merge shares that require on-chain settlement
until the relevant order has reached `MINED`. Backtests do not simulate that
status progression.

## Distributed Backtesting

Backtesting normally uses BullMQ workers:

- producer submits one batch
- Redis/BullMQ holds market jobs
- worker machines process independent market jobs
- aggregate worker finalizes persisted result rows
- dashboard and DB use `batchUid` and run id for lookup

Meaningful research runs should use workers. Use `--sequential` only for smoke
tests, local debugging, or bit-identical parity checks.

Rough speed anchor:

```text
wall time ~= markets * 1.5s / active worker slots
```

Examples:

- 500 markets on 10 active worker slots: about 75 seconds.
- 6,000 markets on 20 active worker slots: about 7.5 minutes.
- 18,000 markets on 30 active worker slots: about 15 minutes.

Always verify actual speed from persisted execution metadata and the dashboard.
Per-market rows can include worker identity, duration, event counts, and commit
SHA.

## Workers Run Committed Code Only

Every backtest job carries the commit SHA of the code that submitted it.
Workers gate on that SHA: a worker that is behind pulls and relaunches itself
automatically. Uncommitted code never reaches a worker because the CLI refuses
to enqueue a backtest when the working tree is dirty.

Daily loop:

```text
write strategy -> commit -> push main -> sync worker fleet -> run backtest
```

- On a single machine, committing is enough.
- With workers on other machines, the commit must be pushed to `main`, then
  remote worker checkouts must be synced with
  [`strategy-research-protocol/tools/syncWorkerFleet.md`](./tools/syncWorkerFleet.md).
- Extending an existing run enqueues jobs on the current commit while the
  parent's markets may have run on an older commit. Merging those results into
  one run is valid only because experiment strategy files are frozen after they
  have results. See
  [`strategy-research-protocol/rules/NAMING.md`](./rules/NAMING.md).

Full mechanism:
[`docs/backtest/fleet/self-update.md`](../docs/backtest/fleet/self-update.md).

## Result Semantics

Research evaluation must inspect more than aggregate PnL.

Minimum result context to preserve:

- strategy id
- params
- run id
- batch UID
- input mode
- read source
- converter
- symbol
- timeframe
- market selection
- market count
- failed/skipped markets
- commit SHA when available

How to judge results — metrics, advisories, depth — lives in the Judging
results section of
[`strategy-research-protocol/modules/Researcher.md`](./modules/Researcher.md).

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
  [`docs/backtest/fleet/overview.md`](../docs/backtest/fleet/overview.md)
- Backtest parallelization:
  [`docs/backtest/parallelization.md`](../docs/backtest/parallelization.md)
- Worker self-update:
  [`docs/backtest/fleet/self-update.md`](../docs/backtest/fleet/self-update.md)
- Worker install:
  [`docs/backtest/fleet/install.md`](../docs/backtest/fleet/install.md)
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
