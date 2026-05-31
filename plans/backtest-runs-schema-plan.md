# Backtest Runs Schema Plan

## Goal

- Replace monolithic `backtests.market_stats` / `backtests.batch_stats` JSON storage with normalized run + market tables.
- Preserve deterministic ordering and replay parity.
- Keep the initial version lean: no chunk tables persisted, chunk stats computed on demand.

## Naming

- `backtest_runs`
- `backtest_run_markets`
- `backtest_run_failures`

## Table: `backtest_runs`

| Column                          | Type                                               | Notes                   |
| ------------------------------- | -------------------------------------------------- | ----------------------- |
| `id`                            | `bigint PK autoincrement`                          | Internal run ID         |
| `batch_uid`                     | `varchar(255) unique`                              | External run identifier |
| `status`                        | `enum('running','completed','failed','partial')`   | Lifecycle               |
| `strategy`                      | `varchar(255) not null`                            | Strategy ID             |
| `params`                        | `json not null`                                    | Strategy params         |
| `symbol`                        | `varchar(10) null`                                 | Input symbol            |
| `slugs`                         | `json null`                                        | Input slugs array       |
| `limit`                         | `int null`                                         | CLI flag                |
| `random`                        | `boolean not null default false`                   | CLI flag                |
| `latest`                        | `boolean not null default false`                   | CLI flag                |
| `baseline_id`                   | `varchar(255) null`                                | Compare baseline        |
| `cmd`                           | `longtext null`                                    | Repro command           |
| `comment`                       | `text null`                                        | User note               |
| `capital_initial`               | `double not null`                                  | Batch stat              |
| `capital_final`                 | `double not null`                                  | Batch stat              |
| `pnl_total`                     | `double not null`                                  | Batch stat              |
| `total_fees_paid`               | `double not null`                                  | Batch stat              |
| `quality_system`                | `double null`                                      | Batch stat              |
| `quality_trade`                 | `double null`                                      | Batch stat              |
| `ev_per_market_played`          | `double not null`                                  | Batch stat              |
| `ev_per_market_total`           | `double not null`                                  | Batch stat              |
| `markets_total`                 | `int not null`                                     | Batch stat              |
| `markets_skipped`               | `int not null`                                     | Batch stat              |
| `markets_no_in_window_activity` | `int not null`                                     | Batch stat              |
| `markets_flat_with_trades`      | `int not null`                                     | Batch stat              |
| `markets_played`                | `int not null`                                     | Batch stat              |
| `markets_won`                   | `int not null`                                     | Batch stat              |
| `markets_lost`                  | `int not null`                                     | Batch stat              |
| `win_rate`                      | `double not null`                                  | Batch stat              |
| `win_rate_pct`                  | `double not null`                                  | Batch stat              |
| `win_rate_pct_str`              | `varchar(16) not null`                             | Batch stat              |
| `trades_total`                  | `int not null`                                     | Batch stat              |
| `trades_maker`                  | `int not null`                                     | Batch stat              |
| `trades_taker`                  | `int not null`                                     | Batch stat              |
| `pnl_avg_win`                   | `double not null`                                  | Batch stat              |
| `pnl_avg_lose`                  | `double not null`                                  | Batch stat              |
| `pnl_max_win`                   | `double not null`                                  | Batch stat              |
| `pnl_max_lose`                  | `double not null`                                  | Batch stat              |
| `streak_max_win`                | `int not null`                                     | Batch stat              |
| `streak_max_lose`               | `int not null`                                     | Batch stat              |
| `streak_max_win_pnl`            | `double not null`                                  | Batch stat              |
| `streak_max_lose_pnl`           | `double not null`                                  | Batch stat              |
| `streak_max_skipped`            | `int not null`                                     | Batch stat              |
| `created_at`                    | `timestamp not null default now()`                 | Insert time             |
| `updated_at`                    | `timestamp not null default now() on update now()` | Last update             |

### Indexes (`backtest_runs`)

- `unique(batch_uid)`
- `index(created_at)`
- `index(strategy, created_at)`
- `index(symbol, created_at)`

## Table: `backtest_run_markets`

| Column                 | Type                                     | Notes                      |
| ---------------------- | ---------------------------------------- | -------------------------- |
| `id`                   | `bigint PK autoincrement`                | Internal row ID            |
| `run_id`               | `bigint not null FK -> backtest_runs.id` | Parent run                 |
| `idx`                  | `int not null`                           | Deterministic order in run |
| `market_id`            | `varchar(255) not null`                  | Market identifier          |
| `slug`                 | `varchar(255) not null`                  | Market slug                |
| `final_outcome`        | `enum('UP','DOWN') not null`             | Outcome                    |
| `skip_reason`          | `enum('no_in_window_activity') null`     | Optional skip reason       |
| `pnl`                  | `double not null`                        | Per-market PnL             |
| `trade_count`          | `int not null`                           | Per-market trades          |
| `trade_as_maker`       | `int not null`                           | Maker trades               |
| `trade_as_taker`       | `int not null`                           | Taker trades               |
| `fees_paid`            | `double not null`                        | Fees                       |
| `avg_entry_price_up`   | `double null`                            | Avg UP entry               |
| `avg_entry_price_down` | `double null`                            | Avg DOWN entry             |
| `up_shares`            | `double not null`                        | Position snapshot          |
| `down_shares`          | `double not null`                        | Position snapshot          |
| `mergable_shares`      | `double not null`                        | Position snapshot          |
| `cost`                 | `double not null`                        | Cost basis                 |
| `split_cost`           | `double not null`                        | Split cost                 |
| `worker_name`          | `varchar(255) null`                      | Execution metadata         |
| `started_at_ms`        | `bigint null`                            | Execution metadata         |
| `finished_at_ms`       | `bigint null`                            | Execution metadata         |
| `duration_ms`          | `int null`                               | Execution metadata         |
| `events_processed`     | `int null`                               | Execution metadata         |
| `events_by_type`       | `json null`                              | Execution metadata         |
| `commit_sha`           | `varchar(64) null`                       | Execution metadata         |

### Indexes (`backtest_run_markets`)

- `unique(run_id, idx)`
- `index(run_id, slug)`
- `index(run_id, pnl)`
- `index(slug)`

## Table: `backtest_run_failures`

| Column       | Type                                     | Notes               |
| ------------ | ---------------------------------------- | ------------------- |
| `id`         | `bigint PK autoincrement`                | Internal row ID     |
| `run_id`     | `bigint not null FK -> backtest_runs.id` | Parent run          |
| `job_id`     | `varchar(255) null`                      | BullMQ child job id |
| `idx`        | `int null`                               | Market index        |
| `slug`       | `varchar(255) null`                      | Market slug         |
| `reason`     | `text not null`                          | Failure reason      |
| `created_at` | `timestamp not null default now()`       | Insert time         |

### Indexes (`backtest_run_failures`)

- `index(run_id)`
- `index(run_id, idx)`

## Deferred (Not in V1)

- `backtest_run_market_intent_meta` (explicitly out for now)
- Persisted chunk tables (`backtest_run_chunk_*`) — compute on demand in dashboard/service
