# Backtest Runs Schema Plan

## Decision

Use a normalized run/market/failure schema. Keep flexible JSON only where the data is genuinely nested or experimental.

The original brainstorm was directionally correct, but retaining both typed columns and a top-level `batch_stats` JSON snapshot created duplicate sources of truth. The safer V1 is normalized:

- Query/sort/filter fields are first-class columns.
- Per-market rows are normalized so dashboard/research code no longer loads a giant `market_stats` blob.
- Strategy params, `intentMeta`, execution event counts, and `chunked_batch_stats` stay JSON at the smallest useful scope.
- `BatchStats` is a domain object in TypeScript, but its run-level fields are persisted as typed scalar columns on `backtest_runs`.
- No legacy backtest data migration. The old `backtests` table can be dropped/truncated because the data is disposable.

## Tables

### `backtest_runs`

One row per terminal backtest run.

Key columns:

- `id bigint PK autoincrement`
- `batch_uid varchar(255) not null unique`
- `status enum('completed','partial','failed') not null`
- CLI/repro metadata: `strategy`, `params`, `symbol`, `slugs`, `limit`, `random`, `latest`, `baseline_id`, `cmd`, `comment`
- cardinality: `input_markets_total`, `markets_persisted`, `failures_count`
- dashboard/ranking metrics: `pnl_total`, `capital_initial`, `capital_final`, `total_fees_paid`, `quality_system`, `quality_trade`, EV, market counts, win rate, trade counts, P&L distribution, streak metrics
- nested analysis artifact: `chunked_batch_stats json null`
- timestamps: `created_at`, `updated_at`

Indexes:

- unique `batch_uid`
- `created_at`
- `(strategy, created_at)`
- `pnl_total`
- `(symbol, created_at)`

### `backtest_run_markets`

One row per persisted `MarketStats` result. `idx` preserves deterministic input/run order and is the canonical ordering for streak and chunk semantics.

Key columns:

- `id bigint PK autoincrement`
- `run_id bigint not null FK -> backtest_runs.id ON DELETE CASCADE`
- `idx int not null`
- identity/outcome: `market_id`, `slug`, `final_outcome`, `skip_reason`
- stable per-market stats: PnL, trade counts, fees, average entry prices, share/cost fields
- scoped flexible payload: `intent_meta json not null`
- execution metadata: worker, timing, event counts, commit

Indexes:

- unique `(run_id, idx)`
- `(run_id, slug)`
- `(run_id, pnl)`
- `slug`
- `(run_id, duration_ms)`

### `backtest_run_failures`

One row per child market job that exhausted retries.

Key columns:

- `id bigint PK autoincrement`
- `run_id bigint not null FK -> backtest_runs.id ON DELETE CASCADE`
- `job_id`, `idx`, `slug`, `reason`, `created_at`

Indexes:

- `(run_id, idx)`
- `(run_id, slug)`

## Why This Shape

- It removes the main bottleneck: every dashboard/research query no longer needs to read one large `market_stats` JSON value.
- It preserves replay parity because the insert path still receives the exact shared `MarketStats[]` produced by live/backtest-shared strategy execution. Persistence is post-run only.
- It keeps deterministic ordering explicit through `backtest_run_markets.idx`.
- It avoids schema churn for experimental research metadata by keeping `intentMeta` JSON per market.
- It keeps current dashboard and diff tooling cheap by using typed run summary columns and retaining only the nested `chunked_batch_stats` snapshot.

## Implementation Touch Points

- `src/db/schema.ts`: replace `backtests` with `backtest_runs`, `backtest_run_markets`, `backtest_run_failures`.
- `src/db/backtests.ts`: insert a run transactionally and hydrate old-compatible run detail objects for consumers.
- `src/cli/backtest.ts`: call site unchanged; still passes `MarketStats[]` and `BatchStats`.
- `src/backtest/aggregateProcessor.ts`: call site unchanged; still sorts by `idx` before insert.
- `src/cli/verify-backtest-diff.ts`: read hydrated runs by `batchUid`.
- `src/cli/rebuild-chunked-batch-stats.ts`: rebuild from normalized market rows.
- `src/cli/research/export-trade-features.ts`: read hydrated runs by ID.
- `src/cli/research/insert-in-db-backtest-feature-tests.ts`: read hydrated source runs, insert derived runs through the same insert helper.
- `dashboard/src/lib/schema.ts`: mirror the normalized tables.
- `dashboard/src/lib/queries/batches.ts`: list runs from `backtest_runs`, hydrate detail from market/failure rows.
- `drizzle/0014_normalize_backtest_runs.sql`: destructive migration that drops old `backtests` and creates the new tables.

## Safety Assessment

This is safe for strategy parity because no strategy, tick stream, execution adapter, order manager, or portfolio behavior changes. The change is persistence-only after per-market results are already computed.

Main risks:

- MySQL migration is destructive for old backtest rows by design.
- External ad hoc SQL/scripts that still query `backtests.market_stats` will break and need to use the hydrated helper or new tables.
- `batch_uid` is now unique. Research scripts that intentionally insert several derived rows under the same batch UID must generate distinct child UIDs.

## Deferred

- Dedicated `backtest_run_market_intent_meta` table. Add only if per-intent querying becomes common.
- Persisted chunk segment tables. Current chunk snapshots are small enough and already exist as run-level JSON.
- A `running` status row written before queue completion. Active runs currently remain Redis/BullMQ-backed in the dashboard.
