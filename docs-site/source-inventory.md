# Full Source Inventory

This page lists all tracked source-oriented files used by the project runtime, tooling, and UI.

## Root Project Files
- `.env.example`
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `ToDo.md`
- `drizzle.config.ts`
- `env.example`
- `eslint.config.cjs`
- `package-lock.json`
- `package.json`
- `tsconfig.json`

## Source Tree (src/)

### src/backtest
- `src/backtest/generate-jobs.ts`
- `src/backtest/stats/batchStats.ts`
- `src/backtest/stats/chunkedBatchStats.ts`
- `src/backtest/stats/marketResolution.ts`
- `src/backtest/stats/marketStats.ts`
- `src/backtest/stats/walkForwardRank.ts`

### src/blockchain
- `src/blockchain/balanceTracker.ts`
- `src/blockchain/checkBalanceAndApproval.ts`
- `src/blockchain/conditionalTokens.ts`

### src/cli
- `src/cli/backtest.ts`
- `src/cli/check-balances.ts`
- `src/cli/create-clob-api-key.ts`
- `src/cli/helpers/backtestArgs.test.ts`
- `src/cli/helpers/backtestArgs.ts`
- `src/cli/helpers/backtestCmd.ts`
- `src/cli/helpers/openParquetReader.test.ts`
- `src/cli/helpers/openParquetReader.ts`
- `src/cli/helpers/resolveParquetFilesFromDirs.test.ts`
- `src/cli/helpers/resolveParquetFilesFromDirs.ts`
- `src/cli/helpers/strategyArgs.ts`
- `src/cli/pnl-report.ts`
- `src/cli/rebuild-chunked-batch-stats.ts`
- `src/cli/record-live.ts`
- `src/cli/redeem-watcher.ts`
- `src/cli/relayer.ts`
- `src/cli/research/export-trade-features.ts`
- `src/cli/research/insert-in-db-backtest-feature-tests.ts`
- `src/cli/research/research-gate-on-backtests.ts`
- `src/cli/trading-bot.ts`
- `src/cli/webui/botUiState.ts`
- `src/cli/webui/createTradingBotWebUiServer.ts`

### src/config
- `src/config/env.ts`

### src/db
- `src/db/config.ts`
- `src/db/helpers.ts`
- `src/db/index.ts`
- `src/db/insert-local-parquet-files-to-database.ts`
- `src/db/schema.ts`

### src/market
- `src/market/MarketEngine.ts`
- `src/market/marketChannelDecoder.ts`
- `src/market/orderbook/MarketOrderBookEngine.ts`
- `src/market/orderbook/OrderBookEngine.ts`
- `src/market/orderbook/index.ts`
- `src/market/orderbook/types.ts`
- `src/market/orderbook/utils.ts`
- `src/market/polymarketEventIndex.ts`

### src/parquet
- `src/parquet/cli/list-backtest-files.ts`
- `src/parquet/cli/scan-disconnect-events.ts`
- `src/parquet/cli/verify-parquet.ts`
- `src/parquet/indexer/rawEventIndexer.ts`
- `src/parquet/io/eventSchema.ts`
- `src/parquet/io/eventWriter.ts`

### src/polymarket
- `src/polymarket/clobClient.ts`
- `src/polymarket/config.ts`
- `src/polymarket/contractAddresses.ts`
- `src/polymarket/dataApi.ts`
- `src/polymarket/gamma.ts`
- `src/polymarket/gammaMarketMeta.ts`
- `src/polymarket/liveMarketEventSource.ts`
- `src/polymarket/relayerClient.ts`
- `src/polymarket/resolveUpDown15mAssets.ts`
- `src/polymarket/restPollAccountSource.ts`
- `src/polymarket/symbols.ts`
- `src/polymarket/upDown15m.ts`
- `src/polymarket/upDown15mWindowGuard.ts`
- `src/polymarket/ws/marketWs.ts`
- `src/polymarket/ws/userWsAccountSource.ts`
- `src/polymarket/ws/wsConnection.ts`

### src/strategies
- `src/strategies/BuyBatchLimitGTC.v1.ts`
- `src/strategies/BuyBoth.v1.ts`
- `src/strategies/MeasureLatency.v1.ts`
- `src/strategies/basicFak.v1.ts`
- `src/strategies/buyBothSidesAndMerge.v1.ts`
- `src/strategies/placeLimitOrderAndCancelAfterFewSec.ts`
- `src/strategies/readExternalFeedsExample.v1.ts`
- `src/strategies/readVolatilityIndicator.v1.ts`
- `src/strategies/scalp/Scalp.v1.ts`
- `src/strategies/signals/Orderbook.v1.ts`
- `src/strategies/signals/OrderbookGridSearch.v1.json`
- `src/strategies/split/SplitSellRedeem.v1.ts`
- `src/strategies/split/SplitSellRedeem.v2.ts`
- `src/strategies/split/SplitSellRedeem.v3.ts`
- `src/strategies/split/SplitSellRedeem.v4.ts`
- `src/strategies/split/SplitSellRedeem.v5.1-research-metrics.ts`
- `src/strategies/split/SplitSellRedeem.v5.2-netChange.ts`
- `src/strategies/split/SplitSellRedeem.v5.3-technical-indicators.ts`
- `src/strategies/split/SplitSellRedeem.v5.4-research-metrics-and-technical-indicators.ts`
- `src/strategies/split/SplitSellRedeem.v5.gate-highLowRange.ts`
- `src/strategies/split/SplitSellRedeem.v5.gate-netChange-and-ta-tf15mWickRatio.ts`
- `src/strategies/split/SplitSellRedeem.v5.gate-netChange.ts`
- `src/strategies/split/SplitSellRedeem.v5.gate-orderbookImbalance.ts`
- `src/strategies/split/SplitSellRedeem.v5.gate-ta-tf15mWickRatio.ts`
- `src/strategies/split/SplitSellRedeem.v5.gate-ta-tf1hWickRatio.ts`
- `src/strategies/split/SplitSellRedeem.v5.ts`
- `src/strategies/split/SplitSellRedeem.v5.unwind.ts`
- `src/strategies/split/SplitSellRedeem.v6.ts`
- `src/strategies/split/jobs/v5/v5-dwell-ranges.json`
- `src/strategies/split/jobs/v5/v5-eth-baseline-search-for-latter.json`
- `src/strategies/split/jobs/v5/v5-eth-baseline-search.json`
- `src/strategies/split/jobs/v5/v5-retest-best.json`
- `src/strategies/split/jobs/v5/v5-search-for-baseline.json`
- `src/strategies/split/jobs/v5/v5-timeFilterDisableTradingAfterSeconds.json`
- `src/strategies/split/jobs/v6/v6-tick-price-offset.json`
- `src/strategies/split/research/PROMPT-netChange-highLow.md`
- `src/strategies/split/research/PROMPT.md`
- `src/strategies/split/research/enrichTradesIndicators.ts`
- `src/strategies/split/research/gate_search.py`
- `src/strategies/split/research/highLowRange.csv`
- `src/strategies/split/research/highLowRange.json`
- `src/strategies/split/research/makeCsv.ts`
- `src/strategies/split/research/netChange.csv`
- `src/strategies/split/research/netChange.json`
- `src/strategies/split/research/results-SplitSellRedeem.v5.1-research-metrics.ts`
- `src/strategies/split/research/shadow_report_top.txt`
- `src/strategies/split/research/success/ Screenshot 2026-01-25 at 04.22.28.png`
- `src/strategies/split/research/success/Screenshot 2026-01-25 at 03.29.00.png`
- `src/strategies/split/research/success/Screenshot 2026-01-25 at 03.29.08.png`
- `src/strategies/split/research/success/Screenshot 2026-01-25 at 03.29.29.png`
- `src/strategies/split/research/success/Screenshot 2026-01-25 at 03.29.36.png`
- `src/strategies/split/research/success/Screenshot 2026-01-25 at 03.31.14.png`
- `src/strategies/split/research/success/Screenshot 2026-01-25 at 03.31.43.png`
- `src/strategies/split/research/success/Screenshot 2026-01-25 at 04.25.28.png`
- `src/strategies/split/research/success/Screenshot 2026-01-25 at 04.43.16.png`
- `src/strategies/split/research/success/Screenshot 2026-01-28 at 04.10.24.png`
- `src/strategies/split/research/success/Screenshot 2026-01-28 at 04.20.33.png`
- `src/strategies/split/research/success/ta_tf1h_rv20.png`
- `src/strategies/split/research/success/tf1h_bbWidth.png`
- `src/strategies/split/research/top_gates.csv`
- `src/strategies/split/research/top_gates.txt`
- `src/strategies/split/research/top_singles.csv`
- `src/strategies/split/research/top_singles.txt`
- `src/strategies/split/research/trades.csv`
- `src/strategies/split/research/trades.json`
- `src/strategies/split/research/trades_with_features.csv`
- `src/strategies/split/research/trades_with_features.json`
- `src/strategies/templates/Template.v1.ts`
- `src/strategies/templates/TemplateDwellGate.ts`
- `src/strategies/templates/TemplateResearchIntentMetrics.ts`
- `src/strategies/templates/TemplateTimeWindowGate.ts`
- `src/strategies/winnerLimit.md`
- `src/strategies/winnerLimit.v1.ts`

### src/strategy
- `src/strategy/Strategy.ts`
- `src/strategy/StrategyContext.ts`
- `src/strategy/plugins/DeribitVolatilityIndexPlugin.ts`
- `src/strategy/plugins/DwellGatePlugin.ts`
- `src/strategy/plugins/ExternalFeedsPlugin.ts`
- `src/strategy/plugins/ExternalFeedsRequestPlugin.ts`
- `src/strategy/plugins/PluginSet.ts`
- `src/strategy/plugins/TechnicalIndicatorsPlugin.ts`
- `src/strategy/plugins/TimeWindowGatePlugin.ts`
- `src/strategy/plugins/TimeWindowVolatility.md`
- `src/strategy/plugins/TimeWindowVolatility.ts`
- `src/strategy/strategyDefinition.ts`
- `src/strategy/strategyRegistry.ts`
- `src/strategy/strategyToolkit.ts`

### src/trading
- `src/trading/OrderManager.ts`
- `src/trading/Portfolio.ts`
- `src/trading/StrategyRunner.ts`
- `src/trading/execution/BacktestExecution.ts`
- `src/trading/execution/LiveExecution.ts`
- `src/trading/feeds/README.md`
- `src/trading/feeds/binanceKlines.ts`
- `src/trading/feeds/binanceWsSpotPriceClient.ts`
- `src/trading/feeds/deribitVolatilityIndex.ts`
- `src/trading/feeds/externalFeeds.ts`
- `src/trading/feeds/polymarketPriceToBeatClient.ts`
- `src/trading/feeds/rtdsCryptoPricesClient.ts`
- `src/trading/fees.ts`
- `src/trading/orderbookMetrics.ts`
- `src/trading/positionMetrics.ts`
- `src/trading/riskLimits.ts`
- `src/trading/utils/rounding.ts`

### src/types
- `src/types/marketEventSource.ts`
- `src/types/rawEvent.ts`

### src/utils
- `src/utils/logger.ts`
- `src/utils/minHeap.ts`
- `src/utils/runtime.ts`
- `src/utils/sleep.ts`
- `src/utils/timeWindows.ts`
- `src/utils/timer.ts`
- `src/utils/toBigInt.ts`
- `src/utils/windowBoundary.ts`

## Web UI (webui/)
- `webui/README.md`
- `webui/index.html`
- `webui/package.json`
- `webui/src/App.tsx`
- `webui/src/components/ConnectionBadge.tsx`
- `webui/src/components/DwellGateStatus.tsx`
- `webui/src/components/ExternalFeedsPanel.tsx`
- `webui/src/components/LogsPanel.tsx`
- `webui/src/components/OrderbookDepthsPanel.tsx`
- `webui/src/components/OrderbookMetricsPanel.tsx`
- `webui/src/components/OrderbookPanel.tsx`
- `webui/src/components/OrderbooksPanel.tsx`
- `webui/src/components/OrderbooksWithDepthsAndMetricsPanel.tsx`
- `webui/src/components/PortfolioPanels.tsx`
- `webui/src/components/StatusBar.tsx`
- `webui/src/components/VolatilityPanel.tsx`
- `webui/src/hooks/useBotWs.ts`
- `webui/src/index.css`
- `webui/src/main.tsx`
- `webui/src/types.ts`
- `webui/src/utils/format.ts`
- `webui/tsconfig.json`
- `webui/vite.config.ts`

## Queue + Docs + SQL Migrations
- `docs/ARCHITECTURE.md`
- `docs/ARCHITECTURE_DIAGRAMS.md`
- `docs/AddNewBot.md`
- `docs/Commands.md`
- `docs/DepositApproveWithdrawCheckBalance.md`
- `docs/GenerateJobsFromGridStrategyParams.md`
- `docs/MeasureLatency.md`
- `docs/MultipleBots.md`
- `docs/ParallelBacktestRunner.md`
- `docs/chunked-batch-stats.md`
- `docs/rebuild-chunked-batch-stats.md`
- `docs/research-gate-on-backtests.md`
- `docs/save-intent-metrics.md`
- `docs/scan-disconnect-events.md`
- `docs/trade-features-export.md`
- `drizzle/0000_steady_lady_bullseye.sql`
- `drizzle/0001_spotty_blackheart.sql`
- `drizzle/0002_chemical_spitfire.sql`
- `drizzle/0003_amused_masked_marvel.sql`
- `drizzle/0004_spooky_sabretooth.sql`
- `drizzle/0005_serious_major_mapleleaf.sql`
- `drizzle/0006_mellow_chunked_batch_stats.sql`
- `drizzle/0007_overconfident_krista_starr.sql`
- `drizzle/0008_add_backtest_slugs.sql`
- `drizzle/meta/0000_snapshot.json`
- `drizzle/meta/0001_snapshot.json`
- `drizzle/meta/0002_snapshot.json`
- `drizzle/meta/0003_snapshot.json`
- `drizzle/meta/0004_snapshot.json`
- `drizzle/meta/0005_snapshot.json`
- `drizzle/meta/0006_snapshot.json`
- `drizzle/meta/0007_snapshot.json`
- `drizzle/meta/0008_snapshot.json`
- `drizzle/meta/_journal.json`
- `queue/README.md`
- `queue/approve/.gitignore`
- `queue/done/.gitignore`
- `queue/failed/.gitignore`
- `queue/pending/.gitignore`
- `queue/run-queue.sh`
- `queue/running/.gitignore`

## Non-Core Historical/Research Artifacts (tracked)

- `src/strategies/split/research/**` contains research outputs and analysis artifacts.
- `screenshots/**` and `src/strategies/split/research/success/**` are visual artifacts.
- These are documented for completeness, but they are not on the live/backtest critical path.
