---
title: Backtest Segments
description: Per-segment backtest stats — last_n tails, daily/weekly/monthly calendar buckets, and the run-level `all` row — stored in the normalized `backtest_run_segments` table.
---

# Backtest Segments

`backtest_run_segments` holds per-segment statistics for each backtest run. It replaces the previous `backtest_runs.chunked_batch_stats` JSON column with a normalized table so the dashboard (and ad-hoc SQL) can slice runs by tail size or calendar bucket without `JSON_EXTRACT` gymnastics.

The computation lives in `src/backtest/stats/backtestSegments.ts` (`computeBacktestSegments`). One row per `(run_id, segment_kind, segment_key)`.

## Segment kinds

| Kind      | Meaning                                                                                 | Rows produced per run                   |
| --------- | --------------------------------------------------------------------------------------- | --------------------------------------- |
| `all`     | The whole run as a single segment. Mirrors the run-level columns on `backtest_runs`.    | Always 1 (when the run has markets).    |
| `last_n`  | The most recent **N** markets (sorted by `market_start_ms` descending, then sliced).    | One row per N where `markets.length ≥ N`. |
| `daily`   | UTC calendar-day buckets.                                                               | One row per non-empty day.              |
| `weekly`  | ISO 8601 week buckets (Monday-start).                                                   | One row per non-empty ISO week.         |
| `monthly` | UTC calendar-month buckets.                                                             | One row per non-empty month.            |

### `last_n` semantics — what it is and isn't

`last_n` is **not** chunking. It produces one segment per bucket size:

- `last_n=500` is computed over `markets.slice(-500)` — the most recent 500 markets.
- `last_n=1000` is computed over `markets.slice(-1000)` — the most recent 1000 markets, which **includes** all 500 from above plus 500 older ones.
- Larger buckets are supersets of smaller ones.
- A row is emitted only when the run has at least N markets. A run with 950 markets gets `last_n=500` but not `last_n=1000`.

The default bucket set is `[500, 1000, 3000, 6000]`, declared as `LAST_N_BUCKETS` in `backtestSegments.ts`. To change it, edit the constant and re-run `rebuild:backtest-segments` over existing runs.

### Calendar buckets

`daily`, `weekly`, `monthly` group markets by calendar boundary of `market_start_ms` in **UTC**. Each bucket gets its own `capital_initial` (capital does **not** carry over between buckets — these are isolated-window views, useful for direct cross-run comparison).

Empty buckets produce no row.

## `segment_key` and `segment_ord`

`segment_key` is the human-readable identifier (`'all'`, `'500'`, `'2026-05-14'`, `'2026-W20'`, `'2026-05'`). `segment_ord` is a sort key that works across all kinds:

| kind     | `segment_key` example | `segment_ord`                |
| -------- | --------------------- | ---------------------------- |
| `all`    | `'all'`               | `0`                          |
| `last_n` | `'500'` / `'1000'`    | `N` (500, 1000, …)           |
| `daily`  | `'2026-05-14'`        | `start_ms` of the day        |
| `weekly` | `'2026-W20'`          | `start_ms` of the ISO week   |
| `monthly`| `'2026-05'`           | `start_ms` of the month      |

This means `ORDER BY segment_kind, segment_ord` returns segments in the natural display order within each kind.

## The `all` row vs run-level columns

`backtest_runs` still carries the run-level stat columns (so the run-list page can read them without a JOIN). The `all` segment row equals those columns by construction — it's deliberate, trivial duplication. The segments table is the source of truth for everything chunk-shaped; the `all` row exists so callers can query a uniform shape (`WHERE segment_kind = 'all'` to get the totals) instead of branching on "is this a chunk or a total?".

## Schema

```sql
CREATE TABLE backtest_run_segments (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  run_id          BIGINT NOT NULL REFERENCES backtest_runs(id) ON DELETE CASCADE,
  segment_kind    ENUM('all','last_n','daily','weekly','monthly') NOT NULL,
  segment_key     VARCHAR(32) NOT NULL,
  segment_ord     BIGINT NOT NULL,
  from_ms         BIGINT NOT NULL,
  to_ms           BIGINT NOT NULL,
  -- Full BatchStatsFields shape (same columns as backtest_runs run-level stats):
  capital_initial, capital_final, pnl_total, total_fees_paid,
  quality_system NULL, quality_trade NULL,
  ev_per_market_played, ev_per_market_total,
  markets_total, markets_skipped, markets_no_in_window_activity, markets_flat_with_trades,
  markets_played, markets_won, markets_lost,
  win_rate, win_rate_pct,
  trades_total, trades_maker, trades_taker,
  pnl_avg_win, pnl_avg_lose, pnl_max_win, pnl_max_lose,
  streak_max_win, streak_max_lose, streak_max_win_pnl, streak_max_lose_pnl, streak_max_skipped,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (run_id, segment_kind, segment_key),
  INDEX (segment_kind, segment_key),         -- cross-run compare on a fixed bucket
  INDEX (run_id, segment_kind, segment_ord)  -- read order within a run
);
```

`from_ms` and `to_ms` are `min`/`max` of `market_start_ms` in the segment (also stored on `backtest_run_markets` to remove the slug-reparsing dependency at compute time).

## How it's written

Three write paths, all using `computeBacktestSegments` + bulk insert into `backtest_run_segments`:

1. **Sequential CLI** (`src/cli/backtest.ts`) — computes segments after the per-market loop, inserts inside `insertBacktestRun`.
2. **BullMQ aggregate** (`src/backtest/aggregateProcessor.ts`) — same shape; runs after all children have completed/failed.
3. **`--extend <runId>`** (`src/db/backtests.ts:applyExtensionToRun`) — `DELETE FROM backtest_run_segments WHERE run_id = ?` + bulk insert, inside the same transaction that merges the new markets and updates the run-level stats. Atomic with the `extending_at` lock release.

All three sort markets by `market_start_ms` ascending before computing stats so streak fields (which depend on input order) are chronological.

## How to query it

**One run, all segments:**

```sql
SELECT segment_kind, segment_key, pnl_total, win_rate_pct, markets_total
FROM backtest_run_segments
WHERE run_id = 1234
ORDER BY segment_kind, segment_ord;
```

**Cross-run compare on a fixed bucket (e.g. May 2026):**

```sql
SELECT run_id, pnl_total, win_rate_pct
FROM backtest_run_segments
WHERE segment_kind = 'monthly' AND segment_key = '2026-05'
  AND run_id IN (123, 456);
```

**Last 500 across two strategies:**

```sql
SELECT r.strategy, s.pnl_total, s.win_rate_pct
FROM backtest_run_segments s
JOIN backtest_runs r ON r.id = s.run_id
WHERE s.segment_kind = 'last_n' AND s.segment_key = '500'
  AND r.strategy IN ('foo', 'bar');
```

The dashboard endpoint `/api/backtests/[id]/chunks?kind=<kind>` exposes the same data to the UI; see [`ChunkedSegmentsLive`](https://github.com/ivanmijatovic89/polymarket-bot/blob/main/dashboard/src/components/ChunkedSegmentsLive.tsx) for the consumer.

## Rebuilding for existing runs

If you change `LAST_N_BUCKETS` or recompute segments after a code fix, see [Rebuild Backtest Segments](/research/rebuild-backtest-segments).

## Migration notes

The previous schema stored a single JSON column `backtest_runs.chunked_batch_stats` produced by `computeChunkedBatchStats` (fixed-window sequential chunks: 96/200/300 markets with the trailing remainder folded into the last chunk). That column and the `walkForward` / `positivePct` / `stabilityPass` aggregates it carried are gone. The fixed-window chunking model isn't supported in the new schema — if you want a stability score, compute it from the segments table:

```sql
SELECT
  AVG(CASE WHEN pnl_total >= 0 THEN 1 ELSE 0 END) AS positive_pct
FROM backtest_run_segments
WHERE run_id = 1234 AND segment_kind = 'daily';
```
