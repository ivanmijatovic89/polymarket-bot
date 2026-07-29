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

## Tables: `backtest_runs`, `backtest_run_markets`, `backtest_run_failures`, `backtest_run_segments`

Backtest results are normalized across four tables. The old monolithic `backtests.market_stats` JSON blob and top-level `backtests.batch_stats` JSON snapshot are intentionally gone, as is the previous `backtest_runs.chunked_batch_stats` JSON column.

`backtest_runs` stores one terminal run row with CLI metadata, lifecycle state, audit counts, and `capital_initial` as run configuration. Run-level `BatchStats` values are stored in `backtest_run_segments` as the `segment_kind = 'all'` / `segment_key = 'all'` row.

`backtest_run_markets` stores one row per persisted `MarketStats` result. The `(run_id, idx)` pair preserves deterministic run order. Stable fields such as PnL, trade counts, fees, positions, and execution timing are columns; flexible research payloads live in the per-market `intent_meta` JSON column. `market_start_ms` is denormalized from the slug at insert time and feeds the per-segment stats builder.

`backtest_run_failures` stores market jobs that exhausted retries in the parallel runner.

`backtest_run_segments` stores per-segment stats — one row per `(run_id, segment_kind, segment_key)`. Kinds are `all`, `last_n`, `daily`, `weekly`, `monthly`. See [Backtest Segments](/backtest/statistics/backtest-segments) for the semantics and query patterns.

Important indexes:

| Table                    | Index/Constraint                 | Purpose                                  |
| ------------------------ | -------------------------------- | ---------------------------------------- |
| `backtest_runs`          | index `batch_uid`, unique `submission_uid` | Group lookup by label; unique per-submission identity |
| `backtest_runs`          | `created_at`, `(strategy, created_at)`, `(symbol, created_at)` | Dashboard history and filter queries     |
| `backtest_runs`          | `(protocol, model, created_at)` | Protocol/model provenance analysis and chronological lookup |
| `backtest_run_markets`   | unique `(run_id, idx)`           | Deterministic per-run order              |
| `backtest_run_markets`   | `(run_id, slug)`, `(run_id, pnl)`, `slug`, `(run_id, duration_ms)`, `(run_id, market_start_ms)` | Detail, search, slow-market and chronological views |
| `backtest_run_failures`  | `(run_id, idx)`, `(run_id, slug)` | Failure detail views                     |
| `backtest_run_segments`  | unique `(run_id, segment_kind, segment_key)`, `(segment_kind, segment_key)`, `(run_id, segment_kind, segment_ord)` | Per-run segment list and cross-run bucket compare |

See [Backtest Result Storage](/backtest/statistics/result-storage),
[Backtest Run Statistics](/backtest/statistics/run-statistics), and
[Backtest Run Markets](/backtest/statistics/run-markets) for the backtest-specific
field references.

---

## Tables: `runtime_runs`, `runtime_sessions`

The domain-neutral [Global Runtime](/global-runtime/overview) uses exactly two tables. `runtime_runs` stores loop configuration and current lifecycle state. `runtime_sessions` stores one row per Claude Code or Codex CLI invocation, including the structured action, summary, exit status, token usage, heartbeat, and raw-log path. Human messages and progress documents remain in the configured workspace and are not duplicated into MySQL.

Migration: `drizzle/0030_global_runtime.sql`.

---

## Query Helpers

Helpers are split into three modules, each exporting its own functions (no wildcard re-export from `src/db/index.ts` to avoid name collisions between the recorded and telonex families):

| Module                      | Purpose                                                                    |
| --------------------------- | -------------------------------------------------------------------------- |
| `src/db/markets.ts`         | Helpers for the `markets` table (recorded flow).                           |
| `src/db/telonexMarkets.ts`  | Helpers for `telonex_markets` ⋈ `telonex_market_conversions` (telonex flow). Exports the same function names as `markets.ts` — alias on import when both are needed. |
| `src/db/backtests.ts`       | `insertBacktestRun` — shared across both flows.                            |

`src/db/index.ts` continues to export `getDb` / `closeDb` and all Drizzle schema tables.

### Markets (`src/db/markets.ts`)

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

### Telonex Markets (`src/db/telonexMarkets.ts`)

Helpers for the telonex backtest flow. All query functions take an `opts` object specifying which converter and which storage to read from, and return the normalised `Market` type defined in `telonexMarkets.ts` (NOT the same as the `Market` type in `markets.ts`).

```typescript
type ReadFrom = 'local' | 'r2' | 'local-or-download-from-r2-to-local'
type Converter = 'delta-typed' | 'paired'

type Market = {
  marketId: string
  slug: string
  symbol: string
  timeframe: string
  marketStartMs: number
  dataset: string | null // local_path or r2_url, picked by readFrom
  outcome0: string | null
  outcome1: string | null
  assetId0: string | null
  assetId1: string | null
  resultId: string | null
  telonexStatus: string | null
  question: string | null
  startDateMs: number | null // deprecated — NOT the window start; use marketStartMs
  endDateMs: number | null
}
```

All helpers perform an inner join against `telonex_market_conversions` filtered by `converter` + `status='done'`, so only markets that have a successfully converted parquet for the requested converter are returned.

#### `getMarketBySlug(slug, opts)`

```typescript
getMarketBySlug(
  slug: string,
  opts: { converter: Converter; readFrom: ReadFrom },
): Promise<Market | null>
```

Returns the single telonex market row matching `slug` that has a `status='done'` conversion for the requested converter, or `null` if not found.

---

#### `getMarketsBySlugs(slugs, opts)`

```typescript
getMarketsBySlugs(
  slugs: string[],
  opts: { converter: Converter; readFrom: ReadFrom },
): Promise<Market[]>
```

Returns all matching telonex market rows. Empty input returns `[]`. Order is not guaranteed.

---

#### `listEligibleTelonexMarkets(opts)`

```typescript
listEligibleTelonexMarkets(
  opts: EligibleMarketsQuery, // converter, readFrom, symbol/timeframe or slugs, limit?, random?, latest?, fromMs?, resolvedOnly?
): Promise<Market[]>
```

Returns eligible telonex markets for the filter, ordered `market_start_ms ASC` (or `RAND()` when `random=true`). `random` and `latest` are mutually exclusive. Companion helpers: `listEligibleTelonexSlugs(opts)` (slugs only) and `countEligibleTelonexMarkets(opts)`.

| Option     | Behaviour                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------- |
| `limit`    | Cap the result set size. Default: `1000`.                                                          |
| `random`   | When `true`, rows are returned in `RAND()` order.                                                  |
| `latest`   | When `true` and `limit` is set, returns the `limit` most recent rows by `market_start_ms`.         |

---

### Backtest Runs (`src/db/backtests.ts`)

#### `insertBacktestRun(row)`

```typescript
insertBacktestRun(row: {
  batchUid: string
  submissionUid: string
  baselineId: string | null
  cmd: string
  comment: string | null
  protocol: string | null
  model: string | null
  strategy: string
  params: Record<string, unknown>
  symbol: string | null
  timeframe: string | null
  inputMode: string | null
  converter: string | null
  readFrom: string | null
  slugs: string[] | null
  limit: number | null
  inputMarketsTotal?: number | null
  random: boolean
  latest: boolean
  batchStats: BatchStats
  marketStats: unknown[]
  segments: SegmentRow[]
  failedMarkets?: Array<{
    jobId?: string
    idx: number | null
    slug: string | null
    reason: string
  }> | null
}): Promise<void>
```

Inserts a terminal backtest run transactionally into `backtest_runs`, `backtest_run_markets`, `backtest_run_failures`, and `backtest_run_segments`. Called automatically by the backtest CLI and aggregate worker at the end of each run. `protocol` and `model` are nullable immutable launch provenance populated by protocol launchers (or direct CLI flags). `batchStats` supplies run configuration such as `capital_initial`; `segments` is produced by `computeBacktestSegments` and one row is inserted into `backtest_run_segments` for each `(segment_kind, segment_key)` pair. The `all` segment is the persisted run-level summary.

#### `getBacktestRunById(id)` / `getBacktestRunByBatchUid(batchUid)`

Hydrates a normalized run for research and diff tooling: run metadata from `backtest_runs`, run-level stats from the `all` segment, ordered `marketStats`, and `failedMarkets`. Other per-segment stats are loaded separately via `listSegmentsForRun(runId)`.

`batch_uid` is a non-unique group label — `getBacktestRunByBatchUid` throws when the label matches more than one run (use the run id instead). To enumerate a label's runs use `listBacktestRunSummariesByBatchUid(batchUid)`; unique identity lookups use `getBacktestRunSummaryBySubmissionUid(submissionUid)`.

---

## TypeScript Types

```typescript
import type { Market, MarketInsert } from './src/db/markets.js'
// For the telonex variant (different shape):
import type { Market as TelonexMarket } from './src/db/telonexMarkets.js'
```

| Type           | Description                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `Market`       | Inferred select type for a `markets` row — all columns present, nullable columns typed as `T \| null`.           |
| `MarketInsert` | Inferred insert type for a `markets` row — required fields are non-optional, columns with defaults are optional. |
