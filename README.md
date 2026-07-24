# polymarket-bot

Canonical documentation lives in [`docs/`](docs/). The published docs site is
[`ivanmijatovic89.github.io/polymarket-bot`](https://ivanmijatovic89.github.io/polymarket-bot/).

This README is only an entry point for humans and AI agents. Do not treat it as
operational documentation.

Core invariant: live trading and backtests must run the same strategy logic on
the same tick stream semantics. Any live/backtest divergence is a bug.

## Start Here

- New setup or first run: [Quickstart](docs/quickstart-new.md)
- System overview: [How It Works](docs/how-it-works.md)
- Domain vocabulary: [Key Concepts](docs/key-concepts.md)
- Full docs inventory: [Docs Inventory](docs/docs-inventory.md)

## Task Routing

| Task                                               | Read First                                                                                                                                                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Run or debug backtests                             | [Running Backtests](docs/backtest/running-backtests.md)                                                                                                                                                                                    |
| Work on BullMQ batch execution                     | [Backtest Parallelization](docs/backtest/parallelization.md)                                                                                                                                                                               |
| Work on worker deployment or self-update           | [Worker Self-Update](docs/backtest/fleet/self-update.md)                                                                                                                                                                                   |
| Run workers across machines                        | [Distributed Workers](docs/backtest/fleet/overview.md)                                                                                                                                                                                     |
| Extend an existing backtest run                    | [Extending a Run](docs/backtest/extending-a-run.md)                                                                                                                                                                                        |
| Generate backtest command lists                    | [Generate Backtest Jobs](docs/backtest/generate-backtest-jobs.md)                                                                                                                                                                          |
| Understand persisted backtest results              | [Result Storage](docs/backtest/statistics/result-storage.md)                                                                                                                                                                               |
| Work on run, market, or segment stats              | [Run Statistics](docs/backtest/statistics/run-statistics.md), [Run Markets](docs/backtest/statistics/run-markets.md), [Backtest Segments](docs/backtest/statistics/backtest-segments.md)                                                   |
| Run or debug live trading                          | [Live Trading Bot](docs/live-trading/live-trading-bot.md)                                                                                                                                                                                  |
| Change market-window or token discovery            | [Resolve UP/DOWN 15m Assets](docs/live-trading/resolve-updown-15m-assets.md)                                                                                                                                                               |
| Record market data                                 | [Recording Live Events](docs/datasets/recording/recording-live-events.md)                                                                                                                                                                  |
| Inspect, verify, or list Parquet files             | [Verify Parquet File](docs/datasets/tools/verify-parquet.md), [List Backtest Files](docs/datasets/recording/list-backtest-files.md)                                                                                                        |
| Seed DB rows from local recordings                 | [Seed Database from Parquet](docs/datasets/recording/insert-parquet-to-db.md)                                                                                                                                                              |
| Work with Telonex datasets                         | [Telonex Overview](docs/datasets/telonex/overview.md)                                                                                                                                                                                      |
| Change Telonex sync or conversion                  | [Telonex Sync Design](docs/datasets/telonex/sync-design.md), [Convert](docs/datasets/telonex/convert.md)                                                                                                                                   |
| Verify Telonex replay/data parity                  | [Telonex Verification ADR](docs/adr/telonex-verification-replay-parity.md), [Verify Telonex Conversions](docs/datasets/telonex/verify.md)                                                                                                  |
| Backtest from Telonex data                         | [Run a Backtest with Telonex Data](docs/datasets/telonex/backtest.md)                                                                                                                                                                      |
| Work with PMXT datasets                            | [PMXT Overview](docs/datasets/pmxt/overview.md)                                                                                                                                                                                            |
| Add or change a strategy                           | [Strategy Tutorial](docs/strategy/tutorial-first-strategy.md), [Strategy Definition](docs/strategy/strategy-definition.md), [Strategy Interface](docs/strategy/strategy-interface.md)                                                      |
| Use strategy context or helpers                    | [Strategy Context](docs/strategy/strategy-context.md), [Strategy Toolkit](docs/strategy/strategy-toolkit.md)                                                                                                                               |
| Work on strategy plugins                           | [Technical Indicators](docs/plugins/plugin-technical-indicators.md), [External Feeds](docs/plugins/plugin-external-feeds.md), [Dwell Gate](docs/plugins/plugin-dwell-gate.md), [Time Window Gate](docs/plugins/plugin-time-window-gate.md) |
| Work on market decoding or orderbooks              | [Market Engine](docs/engine/market-engine.md), [Orderbook Engine](docs/engine/orderbook-engine.md)                                                                                                                                         |
| Change tick/intent/account-event orchestration     | [Strategy Runner](docs/engine/strategy-runner.md), [Order Manager](docs/engine/order-manager.md)                                                                                                                                           |
| Change fills, positions, or idempotency            | [Portfolio](docs/engine/portfolio.md), [Backtest Execution](docs/engine/backtest-execution.md), [Live Execution](docs/engine/live-execution.md)                                                                                            |
| Change Parquet schema or writer behavior           | [Parquet Event Schema](docs/engine/parquet-event-schema.md), [Parquet Event Writer](docs/engine/parquet-event-writer.md)                                                                                                                   |
| Work on EOA, SAFE, relayer, balances, or approvals | [EOA vs Relayer](docs/blockchain/eoa-vs-relayer.md), [SAFE Relayer CLI](docs/blockchain/relayer-cli.md), [Check Balances](docs/blockchain/check-balances.md)                                                                               |
| Create or debug CLOB credentials                   | [Create CLOB API Key](docs/blockchain/create-clob-api-key.md), [CLOB Client](docs/reference/clob-client.md)                                                                                                                                |
| Change database schema or query helpers            | [Database Schema](docs/reference/database-schema.md)                                                                                                                                                                                       |
| Design MySQL access for AI research agents         | [MySQL Local vs Worker1 Benchmark](docs/other/mysql-local-vs-worker1-ai-agent-benchmark.md)                                                                                                                                                |
| Check environment variables                        | [Environment Variables](docs/reference/environment-variables.md)                                                                                                                                                                           |
| Change fees, risk, or orderbook metrics            | [Fee Computation](docs/reference/fee-computation.md), [Risk Limits](docs/reference/risk-limits.md), [Orderbook Metrics](docs/reference/orderbook-metrics.md)                                                                               |
| Run PnL, redeem, or trade-feature research tools   | [PnL Report](docs/research/pnl-report.md), [Redeem Watcher](docs/research/redeem-watcher.md), [Export Trade Features](docs/research/export-trade-features.md)                                                                              |
| Organize strategy research                         | [Strategy Research](docs/strategy-research/index.md), [Champion/Challenger Versioning](docs/strategy-research/champion-challenger-versioning.md)                                                                                           |
| Run quality checks or CI-like validation           | [Code Quality Workflow](docs/contribution/code-quality-workflow.md)                                                                                                                                                                        |
| Build or edit the docs site                        | [Build the Documentation Site](docs/contribution/build-docs-site.md)                                                                                                                                                                       |

## Agent Notes

- Read [`AGENTS.md`](AGENTS.md) before making code changes.
- Prefer the linked docs over README when planning or editing.
- Preserve deterministic replay and live/backtest parity.
- Keep strategy params validated with Zod; strategies are auto-discovered from
  `src/strategies/` (export `const definition`) — no registry to edit.
- Generated backtest job lists belong under `generated/backtest-jobs/`; that
  folder is ignored by git.
