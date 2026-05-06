# Backtest Runtime

Entry point: `src/cli/backtest.ts`

## Input Selection Modes

- explicit parquet files as positional args
- `--dir` one or more directories
- database query by `--symbol` (`--limit`, `--random`, `--latest`)
- database query by `--slug` list

## Replay Model

- reads parquet rows (`raw_json`, timestamps, `ingest_seq`)
- heap-merges multiple files (stable ordering)
- feeds same `MarketEngine` path as live
- strategy ticks run on same event class (`book`, `price_change`)

## Shared Runtime Components

Backtest still uses:

- `StrategyRunner`
- `OrderManager`
- `Portfolio`
- strategy registry + schemas

Only execution adapter changes to `BacktestExecution`.

## Execution Simulation Highlights

- maker/taker fill simulation against reconstructed books
- optional latency and jitter simulation via env (`BACKTEST_LATENCY_DELAY`, `BACKTEST_LATENCY_JITTER`)
- optional technical indicators wait gates (`BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS`)

## Outputs

- per-market stats (`computeMarketStats`)
- batch stats (`computeBatchStats`)
- chunked batch stats (`computeChunkedBatchStats`)
- optional DB insert into `backtests` table via helper path

## Determinism Notes

- preserve ordering semantics and avoid introducing time-source randomness unless explicitly controlled.
- if adding simulation behavior, gate it with explicit config/env and document defaults.
