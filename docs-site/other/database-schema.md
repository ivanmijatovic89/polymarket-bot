---
title: Database Schema
description: Reference for all MySQL tables, columns, and query helper functions used by the Polymarket Bot.
---

# Database Schema

The bot uses MySQL via [Drizzle ORM](https://orm.drizzle.team). The schema is defined in `src/db/schema.ts`. Migrations are generated with `npm run db:generate` and applied with `npm run db:migrate`.

The database client is a singleton pool managed by `getDb()` in `src/db/index.ts`. The pool is initialised on first call and reused for the lifetime of the process. Call `closeDb()` during graceful shutdown.

---

## Connection

```typescript
import { getDb, closeDb } from './src/db/index.js'

const db = getDb() // connects lazily; reads DATABASE_* env vars
await closeDb() // drains the connection pool
```

Required environment variables: `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USERNAME`, `DATABASE_NAME`. `DATABASE_PASSWORD` is optional.

---

## Table: `markets`

Stores one row per 15-minute Polymarket market window. Populated either by `npm run db:insert-parquet` (from existing Parquet filenames) or automatically during recording when `RECORD_LIVE_INSERT_DB=true`.

| Column                  | MySQL Type     | Nullable | Default        | Description                                                                                                                                                                |
| ----------------------- | -------------- | -------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | `INT`          | No       | auto-increment | Surrogate primary key.                                                                                                                                                     |
| `polymarket_id`         | `VARCHAR(255)` | No       | —              | Polymarket market ID string (e.g. `"996575"`). Unique constraint.                                                                                                          |
| `slug`                  | `VARCHAR(255)` | No       | —              | Market slug (e.g. `btc-updown-15m-1766524500`). Unique constraint. Used as the primary human-readable key throughout the codebase.                                         |
| `symbol`                | `VARCHAR(10)`  | No       | —              | Lowercase asset symbol extracted from the Parquet folder path: `btc`, `eth`, `sol`, or `xrp`.                                                                              |
| `dataset`               | `TEXT`         | Yes      | `NULL`         | Relative path to the Parquet file for this market (e.g. `data/events/btc/btc-updown-15m-1766524500.parquet`). `NULL` if no recording exists yet.                           |
| `condition_id`          | `TEXT`         | Yes      | `NULL`         | On-chain conditional token condition ID. Used for redemptions.                                                                                                             |
| `outcomes`              | `JSON`         | No       | —              | Array of outcome label strings (e.g. `["Up", "Down"]`).                                                                                                                    |
| `outcome_prices`        | `JSON`         | Yes      | `NULL`         | Array of settlement prices for each outcome, parallel to `outcomes`. Values are `0` or `1` after resolution; intermediate prices while trading. May be strings or numbers. |
| `resolved_outcome`      | `TEXT`         | Yes      | `NULL`         | Winning outcome label (e.g. `"Up"`). `NULL` while the market is unresolved. Derived from `outcome_prices` by finding the entry whose price equals `1`.                     |
| `end_date`              | `TIMESTAMP`    | Yes      | `NULL`         | Market resolution timestamp parsed from the Gamma API.                                                                                                                     |
| `start_date`            | `TIMESTAMP`    | Yes      | `NULL`         | Market open timestamp parsed from the Gamma API.                                                                                                                           |
| `start_date_iso`        | `TEXT`         | Yes      | `NULL`         | Raw ISO 8601 date string from the Gamma API `startDate` field, preserved verbatim.                                                                                         |
| `uma_resolution_status` | `TEXT`         | Yes      | `NULL`         | UMA oracle resolution status string (e.g. `"resolved"`, `"pending"`).                                                                                                      |
| `clob_token_ids`        | `JSON`         | Yes      | `NULL`         | Array of CLOB token IDs corresponding to each outcome, in the same order as `outcomes`.                                                                                    |
| `active`                | `BOOLEAN`      | No       | `false`        | Whether the market is currently accepting orders on the CLOB.                                                                                                              |
| `closed`                | `BOOLEAN`      | No       | `false`        | Whether the market has been closed (no longer active and trading has ended).                                                                                               |
| `volume`                | `DECIMAL`      | Yes      | `NULL`         | Total trading volume in USDC as reported by the Gamma API.                                                                                                                 |
| `question`              | `TEXT`         | No       | —              | Full market question text (e.g. `"Will BTC be up or down in the next 15 minutes?"`).                                                                                       |
| `raw_json`              | `JSON`         | Yes      | `NULL`         | Complete Gamma API response object stored verbatim. Used to rebuild `GammaMarketMeta` without re-fetching.                                                                 |
| `created_at`            | `TIMESTAMP`    | No       | `NOW()`        | Row creation time.                                                                                                                                                         |
| `updated_at`            | `TIMESTAMP`    | No       | `NOW()`        | Last update time. Set automatically by update helpers.                                                                                                                     |

---

## Table: `backtests`

One row per completed backtest run. Written by the backtest CLI at the end of each run when a database is configured.

| Column                | MySQL Type     | Nullable | Default        | Description                                                                                                                                      |
| --------------------- | -------------- | -------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                  | `BIGINT`       | No       | auto-increment | Surrogate primary key.                                                                                                                           |
| `status`              | `VARCHAR(50)`  | Yes      | `NULL`         | Run completion status string (e.g. `"done"`, `"failed"`).                                                                                        |
| `strategy`            | `VARCHAR(255)` | No       | —              | Strategy ID string passed via `--strategy`.                                                                                                      |
| `params`              | `JSON`         | No       | —              | Validated strategy parameter map (key/value pairs) as passed via `--param`.                                                                      |
| `symbol`              | `VARCHAR(10)`  | Yes      | `NULL`         | Asset symbol filter used for this run (`btc`, `eth`, etc.). `NULL` when slugs were specified directly.                                           |
| `slugs`               | `JSON`         | Yes      | `NULL`         | Explicit slug list when the run targeted specific markets. `NULL` when a symbol filter was used.                                                 |
| `limit`               | `INT`          | Yes      | `NULL`         | Maximum number of markets included in the run. `NULL` means unlimited.                                                                           |
| `random`              | `BOOLEAN`      | No       | `false`        | Whether markets were selected in random order.                                                                                                   |
| `latest`              | `BOOLEAN`      | No       | `false`        | Whether the `--latest` flag was used (select only the most recent N markets).                                                                    |
| `batch_uid`           | `VARCHAR(255)` | Yes      | `NULL`         | Unique identifier grouping runs that belong to the same parallel batch job.                                                                      |
| `baseline_id`         | `VARCHAR(255)` | Yes      | `NULL`         | Identifier of the baseline run used for relative comparison in the web UI and reporting tools.                                                   |
| `cmd`                 | `TEXT`         | Yes      | `NULL`         | Full CLI command string that produced this run, for reproducibility.                                                                             |
| `comment`             | `TEXT`         | Yes      | `NULL`         | Free-text annotation.                                                                                                                            |
| `batch_stats`         | `JSON`         | No       | —              | Aggregate statistics across all markets in the run (win rate, total PnL, Sharpe, etc.). See [Batch Stats](/other/batch-stats).                   |
| `market_stats`        | `JSON`         | No       | —              | Array of per-market statistics objects. See [Market Stats](/other/market-stats).                                                                 |
| `chunked_batch_stats` | `JSON`         | Yes      | `NULL`         | Time-windowed batch statistics for performance-over-time analysis. See [Chunked Batch Stats](/other/chunked-batch-stats). `NULL` until computed. |
| `created_at`          | `TIMESTAMP`    | No       | `NOW()`        | Row creation time.                                                                                                                               |

---

## Query Helpers

All helpers are exported from `src/db/helpers.ts` and re-exported from `src/db/index.ts`.

### Markets

#### `getMarketBySlug(slug)`

```typescript
getMarketBySlug(slug: string): Promise<Market | null>
```

Returns the single market row matching `slug`, or `null` if not found.

---

#### `getMarketsBySlugs(slugs)`

```typescript
getMarketsBySlugs(slugs: string[]): Promise<Market[]>
```

Returns all market rows whose `slug` is in the provided array. Returns an empty array when the input is empty. Order is not guaranteed.

---

#### `getMarketByPolymarketId(polymarketId)`

```typescript
getMarketByPolymarketId(polymarketId: string): Promise<Market | null>
```

Returns the single market row matching `polymarket_id`, or `null` if not found.

---

#### `marketExistsBySlug(slug)`

```typescript
marketExistsBySlug(slug: string): Promise<boolean>
```

Returns `true` if a row exists for the given slug. On database error, returns `false` (safe default — the caller will attempt to insert).

---

#### `getMarketsBySymbol(symbol, options?)`

```typescript
getMarketsBySymbol(
  symbol: string,
  options?: {
    limit?: number
    onlyWithDataset?: boolean
    random?: boolean
    latest?: boolean
  }
): Promise<Market[]>
```

Returns markets for the given symbol, with optional filtering and ordering:

| Option            | Behaviour                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `limit`           | Cap the result set size. Default: `1000`.                                                                        |
| `onlyWithDataset` | When `true`, excludes rows where `dataset` is `NULL` or empty.                                                   |
| `random`          | When `true`, rows are returned in `RAND()` order.                                                                |
| `latest`          | When `true` and `limit` is set, returns the last `limit` rows by slug (i.e. the most recently recorded markets). |

---

#### `insertMarket(marketData)`

```typescript
insertMarket(marketData: MarketDataForTable): Promise<void>
```

Inserts a new market row. Throws on duplicate `slug` or `polymarket_id` (unique constraint violation).

---

#### `updateMarketBySlug(slug, updates)`

```typescript
updateMarketBySlug(
  slug: string,
  updates: Partial<Pick<Market,
    'resolvedOutcome' | 'outcomePrices' | 'umaResolutionStatus' |
    'active' | 'closed' | 'volume' | 'rawJson'
  >>
): Promise<void>
```

Updates the specified fields on the row matching `slug`. Automatically sets `updated_at` to the current time.

---

#### `getAllMarkets()`

```typescript
getAllMarkets(): Promise<Market[]>
```

Returns all market rows ordered by `symbol` ascending, then `slug` ascending.

---

#### `deleteMarketBySlug(slug)`

```typescript
deleteMarketBySlug(slug: string): Promise<void>
```

Deletes the market row matching `slug`. No-op if the row does not exist.

---

### Backtest Runs

#### `insertBacktestRun(row)`

```typescript
insertBacktestRun(row: {
  batchUid: string
  baselineId: string | null
  cmd: string
  comment: string | null
  strategy: string
  params: Record<string, unknown>
  symbol: string | null
  slugs: string[] | null
  limit: number | null
  random: boolean
  latest: boolean
  batchStats: Record<string, unknown>
  marketStats: unknown[]
  chunkedBatchStats?: Record<string, unknown> | null
}): Promise<void>
```

Inserts a completed backtest result row. Called automatically by the backtest CLI at the end of each run.

---

## TypeScript Types

```typescript
import type { Market, MarketInsert } from './src/db/helpers.js'
```

| Type           | Description                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `Market`       | Inferred select type for a `markets` row — all columns present, nullable columns typed as `T \| null`.           |
| `MarketInsert` | Inferred insert type for a `markets` row — required fields are non-optional, columns with defaults are optional. |
