# Docs Inventory

Review this file and edit before bulk writing begins.

**Instructions:**
- Delete rows you don't want documented
- Change `Type` if needed (how-to | reference | explanation)
- Change `Section` if needed
- Add notes in the Notes column

**Types:**
- `how-to` — task-oriented, explains how to do something
- `reference` — precise technical description (flags, fields, types)
- `explanation` — explains why/how something works (architecture, design decisions)

---

## Record Live Events

| File | Doc Title | Type | Notes |
|---|---|---|---|
| src/cli/record-live.ts | Recording Live Market Events | how-to | How to start the recorder, what it writes, 15m rotation |
| src/parquet/cli/scan-disconnect-events.ts | Scan Disconnect Events | how-to | ✅ already written |
| src/parquet/cli/verify-parquet.ts | Verify Parquet File | how-to | CLI to validate parquet file integrity and count events by type |
| src/parquet/cli/list-backtest-files.ts | List Backtest Files | how-to | CLI to list available parquet files with metadata |
| src/db/insert-local-parquet-files-to-database.ts | Seed Database from Parquet | how-to | ✅ already written |

---

## Backtest

| File | Doc Title | Type | Notes |
|---|---|---|---|
| src/cli/backtest.ts | Running Backtests | how-to | Main backtest CLI — file/symbol/slug/dir modes, all flags |
| src/backtest/generate-jobs.ts | Generate Backtest Jobs | how-to | Generates parameterized job configs for batch execution |
| src/db/schema.ts | Backtest Result Storage | reference | Normalized backtest result tables: runs, markets, failures |
| src/backtest/stats/batchStats.ts | Backtest Run Statistics | reference | Scalar run performance columns derived from BatchStats |
| src/backtest/stats/marketStats.ts | Backtest Run Markets | reference | Per-market result rows stored in backtest_run_markets |
| src/backtest/stats/chunkedBatchStats.ts | Chunked Batch Statistics | reference | Time-windowed stats for learning curve analysis |
| src/backtest/stats/walkForwardRank.ts | Walk-Forward Ranking | reference | Ranks strategies using walk-forward analysis |

---

## Live Trading

| File | Doc Title | Type | Notes |
|---|---|---|---|
| src/cli/trading-bot.ts | Running the Live Trading Bot | how-to | Main entry point: flags, dry-run, strategy selection, web UI |
| src/polymarket/resolveUpDown15mAssets.ts | Resolve UP/DOWN 15m Assets | reference | How the bot finds current UP/DOWN token IDs for 15m markets |

---

## Web UI

| File | Doc Title | Type | Notes |
|---|---|---|---|
| src/cli/webui/createTradingBotWebUiServer.ts | Trading Bot Web UI | how-to | How to enable and use the real-time dashboard |
| webui/src/App.tsx | Web UI Overview | explanation | What panels exist, what data each shows |

---

## Research

| File | Doc Title | Type | Notes |
|---|---|---|---|
| src/cli/pnl-report.ts | PnL Report | how-to | CLI to fetch and aggregate PnL from portfolio activity |
| src/cli/redeem-watcher.ts | Redeem Watcher | how-to | Daemon that periodically redeems resolved positions |
| src/cli/research/export-trade-features.ts | Export Trade Features | how-to | Extracts trade-level features for ML research |
| src/cli/research/research-gate-on-backtests.ts | Research Gate Analysis | how-to | Evaluates gate effectiveness on past backtest results |

---

## Blockchain

| File | Doc Title | Type | Notes |
|---|---|---|---|
| src/cli/check-balances.ts | Check Balances & Approvals | how-to | CLI to verify USDC balance and token approvals on EOA and SAFE |
| src/cli/create-clob-api-key.ts | Create CLOB API Key | how-to | Derives or creates API credentials from private key |
| src/cli/relayer.ts | Using the SAFE Relayer | how-to | CLI for SAFE: deploy, approve, deposit, withdraw |
| src/blockchain/conditionalTokens.ts | Conditional Tokens | reference | Binary split/merge/redeem on-chain operations |
| src/polymarket/relayerClient.ts | Relayer Client | reference | SAFE-based transactions via relayer |

---

## Strategy

| File | Doc Title | Type | Notes |
|---|---|---|---|
| src/strategy/Strategy.ts | Strategy Interface | reference | Core contract: Intent types, onMarketTick, onAccountEvent |
| src/strategy/StrategyContext.ts | Strategy Context | reference | Full API available inside onMarketTick and onAccountEvent |
| src/strategy/strategyDefinition.ts | Strategy Definition | reference | How to register a strategy: id, Zod schema, factory |
| src/strategy/strategyRegistry.ts | Strategy Registry | reference | How strategies are looked up by --strategy id |
| src/strategy/strategyToolkit.ts | Strategy Toolkit | reference | Helper functions available to strategy authors |
| src/strategies/templates/Template.v1.ts | Template Strategy | reference | Minimal starter template for writing a new strategy |
| src/strategies/templates/TemplateTimeWindowGate.ts | Template: Time Window Gate | reference | Example strategy using TimeWindowGatePlugin |
| src/strategies/templates/TemplateDwellGate.ts | Template: Dwell Gate | reference | Example strategy using DwellGatePlugin |
| src/strategies/split/SplitSellRedeem.v1.ts | Strategy: Split-Sell-Redeem | explanation | How the main strategy family works (covers v1 as the canonical example) |

---

## Plugins

| File | Doc Title | Type | Notes |
|---|---|---|---|
| src/strategy/plugins/TechnicalIndicatorsPlugin.ts | Technical Indicators Plugin | reference | ATR, ADX, Bollinger Bands, realized volatility, wick ratios |
| src/strategy/plugins/DeribitVolatilityIndexPlugin.ts | Deribit Volatility Index Plugin | reference | Real-time BTC volatility at 5m/15m/1h from Deribit |
| src/strategy/plugins/TimeWindowVolatility.ts | Time Window Volatility Plugin | reference | Rolling volatility over configurable time windows |
| src/strategy/plugins/DwellGatePlugin.ts | Dwell Gate Plugin | reference | Gates trading based on price dwell time in a range |
| src/strategy/plugins/TimeWindowGatePlugin.ts | Time Window Gate Plugin | reference | Gates trading by time-of-day (hour/minute ranges) |
| src/strategy/plugins/ExternalFeedsPlugin.ts | External Feeds Plugin | reference | Snapshot of external feeds: RTDS, Binance WS, price-to-beat |

---

## Engine

| File | Doc Title | Type | Notes |
|---|---|---|---|
| src/market/MarketEngine.ts | Market Engine | explanation | How WS events are decoded and orderbooks reconstructed |
| src/market/orderbook/MarketOrderBookEngine.ts | Orderbook Engine | explanation | How per-asset orderbook state is maintained and updated |
| src/trading/StrategyRunner.ts | Strategy Runner | explanation | How the engine calls strategies on ticks and cascades account events |
| src/trading/OrderManager.ts | Order Manager | explanation | How intents are validated, queued, deduplicated, and sent to execution |
| src/trading/Portfolio.ts | Portfolio | explanation | How positions and fills are tracked; idempotency across WS/REST |
| src/trading/execution/BacktestExecution.ts | Backtest Execution | reference | Fill simulation model: latency, maker/taker, worst-queue |
| src/trading/execution/LiveExecution.ts | Live Execution | reference | How orders are submitted to CLOB API; warmup, fills, account state |
| src/parquet/io/eventWriter.ts | Parquet Event Writer | reference | Rotating writer: temp→final transitions, SIGINT handling |
| src/parquet/io/eventSchema.ts | Parquet Event Schema | reference | Parquet columns, types, GZIP encoding |

---

## Parallel Backtest Queue

| File | Doc Title | Type | Notes |
|---|---|---|---|
| queue/run-queue.sh | Parallel Backtest Queue | how-to | Folder-watched GNU parallel runner: approve→pending→running→done |

---

## Reference

| File | Doc Title | Type | Notes |
|---|---|---|---|
| src/config/env.ts | Environment Variables | reference | All env vars, defaults, BOT_ENV override |
| src/db/schema.ts | Database Schema | reference | Drizzle ORM schema: markets and backtest_runs tables |
| src/trading/riskLimits.ts | Risk Limits | reference | Position size and notional limits enforced before execution |
| src/trading/fees.ts | Fee Computation | reference | Maker/taker fees and rebates by VIP tier |
| src/trading/orderbookMetrics.ts | Orderbook Metrics | reference | Spread, depth, imbalance, weighted midpoint |
| src/polymarket/gamma.ts | Gamma API Client | reference | Market metadata fetch, outcome resolution, DB mapping |
| src/polymarket/clobClient.ts | CLOB Client | reference | Order placement and account queries via clob-client |
