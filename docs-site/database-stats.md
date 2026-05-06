# Database and Stats Pipeline

## Database Layer

Main files:

- `src/db/schema.ts`
- `src/db/config.ts`
- `src/db/index.ts`
- `src/db/helpers.ts`

## Tables

### `markets`

Stores market metadata and linkage to local dataset/parquet path.

Key fields include:

- polymarket/gamma IDs and slug
- symbol
- `dataset` path
- outcomes, prices, resolved outcome
- status flags (`active`, `closed`)
- raw gamma JSON snapshot

### `backtests`

Stores backtest runs and derived stats.

Key fields include:

- strategy + params
- selection metadata (`symbol`, `slugs`, `limit`, etc.)
- `batch_stats`
- `market_stats`
- `chunked_batch_stats`

## Stats Computation

`src/backtest/stats/*`:

- `marketStats.ts`: market-level pnl/fees/trade counts + intent-meta extraction
- `batchStats.ts`: aggregate metrics across market list
- `chunkedBatchStats.ts`: rolling windows and stability analysis
- `walkForwardRank.ts`: walk-forward metrics
- `marketResolution.ts`: resolution lookup + DB sync

## Maintenance Jobs

- `src/cli/rebuild-chunked-batch-stats.ts`
- `src/db/insert-local-parquet-files-to-database.ts`
- research export and gating scripts under `src/cli/research/*`

## Migration

- migration SQL under `drizzle/`
- generate/apply with package scripts (`db:generate`, `db:migrate`, `db:push`)
