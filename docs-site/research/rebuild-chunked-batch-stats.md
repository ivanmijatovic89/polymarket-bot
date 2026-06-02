# Rebuild Chunked Batch Stats (CLI)

CLI to backfill `chunked_batch_stats` for rows in `backtest_runs`.

File: `src/cli/rebuild-chunked-batch-stats.ts`

## Usage

```bash
tsx src/cli/rebuild-chunked-batch-stats.ts --onlyNull
```

## Options

- `--batchSize N`  
  Batch size for pagination (default: 500).
- `--onlyNull`  
  Only process rows where `chunked_batch_stats IS NULL`.
- `--force`  
  Recompute and overwrite even if `chunked_batch_stats` is already set.
- `--where "SQL fragment"`  
  Additional SQL filter (raw fragment). Example:
  `--where "strategy = 'foo' AND symbol = 'btc'"`.

## Behavior

- Reads `id` and `capital_initial` from `backtest_runs`, then hydrates ordered
  market rows from `backtest_run_markets`.
- If hydrated market stats are invalid/empty, writes:
  `{ "error": "invalid market_stats", "version": 1 }`.
- Uses `backtest_runs.capital_initial` as `initialCapital`.
  If missing, defaults to `100` and logs a warning.
- Computes chunked stats with windows `[96, 200, 300]`.
- Updates rows in ascending `id` order in batches.
- Idempotent and safe to re-run.

## Output

Logs progress per batch and a final summary with counts:
`processed`, `updated`, `skipped`, `errors`, `warnings`.
