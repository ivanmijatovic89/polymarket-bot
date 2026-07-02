---
title: Rebuild Backtest Segments
description: CLI to rebuild rows in `backtest_run_segments` for one, many, or all backtest runs.
---

# Rebuild Backtest Segments (CLI)

Rebuilds rows in `backtest_run_segments` for backtest runs. Use this when:

- You change `LAST_N_BUCKETS` in `src/backtest/stats/backtestSegments.ts` and want existing runs to reflect the new tail set.
- You fix a bug in the segment builder and need to recompute over already-persisted data.
- A run failed to compute segments at insert time and you want to backfill it.

File: `src/cli/rebuild-backtest-segments.ts`.

## Usage

```bash
# Recompute only runs that have no segments yet.
npm run rebuild:backtest-segments

# Recompute ALL runs (delete-and-rewrite).
npm run rebuild:backtest-segments:all

# With custom filters / batch size.
tsx src/cli/rebuild-backtest-segments.ts --batchSize 1000 --where "strategy = 'foo'"
```

## Options

- `--onlyMissing` — only process runs that have **no** rows in `backtest_run_segments` (uses a `NOT EXISTS` subquery). Default for `npm run rebuild:backtest-segments`.
- `--force` — recompute even runs that already have segments. Default for `npm run rebuild:backtest-segments:all`.
- `--batchSize N` — pagination batch size when scanning `backtest_runs`. Default `500`.
- `--where "<SQL fragment>"` — raw `WHERE` fragment ANDed onto the scan, e.g. `--where "strategy = 'foo' AND symbol = 'btc'"`.

`--onlyMissing` and `--force` are mutually exclusive in spirit — `--force` wins.

## Behavior

For each matched run:

1. Loads `id` and `capital_initial` from `backtest_runs`.
2. Hydrates the run's market rows via `getBacktestRunById` (ordered by idx, joined with failures).
3. Decorates each market with `marketStartMs = slugTs(slug)` (matches what live writers persist on `backtest_run_markets`).
4. Calls `computeBacktestSegments` to produce the full segment set (`all` + `last_n` + `daily` + `weekly` + `monthly`).
5. Inside one DB transaction: `DELETE FROM backtest_run_segments WHERE run_id = ?`, then bulk insert the new rows.

If a run has zero market rows, it's logged and skipped (no row is written; nothing is deleted).

The script is idempotent — re-running over the same run with no upstream changes produces the same rows.

## Output

Per-batch progress log:

```
[rebuild-backtest-segments] batch=1 processed=500 updated=498 skipped=0 errors=2
```

Final summary line with the same counters plus `warnings` (e.g. missing `capital_initial` fell back to the `100` default).

## Notes

- `capital_initial` falls back to `100` if missing on the run row, with a warning.
- The script rebuilds the segment rows that own computed stats. It does not touch `backtest_runs` metadata.
- For one-off recomputation of a single run, just pass `--force --where "id = 1234"`.
