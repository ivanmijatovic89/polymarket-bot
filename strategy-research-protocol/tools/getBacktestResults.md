# Tool: getBacktestResults

## Purpose

Retrieve a backtest result summary for evaluation and memory updates.

## Use When

- A backtest has finished.
- An experiment needs evaluation.
- A family memory file needs a persisted result reference.

## Do Not Use When

- The run has not been submitted yet.
- You need to create or extend a run.
- Terminal output is the only source and no persisted result exists yet.

## Inputs

- Backtest run id, or
- `batchUid`.

## Implementation

Current implementation: dashboard API / database-backed query

By run id:

```bash
curl -sS http://localhost:3051/api/backtests/<run-id>
```

By batch uid:

```bash
curl -sS http://localhost:3051/api/batches/<batchUid>
```

The API reads persisted run data from the dashboard/database layer. Batch lookup
may return active queue state before the run is finalized.

## Source Of Truth

Detailed result storage and statistics docs live in the parent repo docs:

- [`docs/backtest/statistics/result-storage.md`](../../docs/backtest/statistics/result-storage.md)
- [`docs/backtest/statistics/run-statistics.md`](../../docs/backtest/statistics/run-statistics.md)
- [`docs/backtest/statistics/run-markets.md`](../../docs/backtest/statistics/run-markets.md)
- [`docs/backtest/statistics/backtest-segments.md`](../../docs/backtest/statistics/backtest-segments.md)

Do not evaluate a strategy from this tool file alone. This tool only defines how
the research protocol retrieves persisted results for evaluation and memory.

## Output

- Run metadata.
- Batch stats.
- Market stats.
- Failed markets.
- Segment summaries when available.
- Execution summary when available.
- Per-market execution timing when available: worker identity, duration, event
  counts, and commit SHA.

## After Success

Update research memory according to
[`strategy-research-protocol/MEMORY.md`](../MEMORY.md).

- Write the result reference to
  `src/strategies/research/<family>/FAMILY.json`.
- Summarize the lesson in
  `src/strategies/research/<family>/FAMILY.md`.
- Preserve enough context for a future agent to retrieve the result again.
- If runtime or worker performance matters, summarize actual wall time,
  per-market timing, and slow-market outliers from the persisted result.

## If It Fails

- If the API returns not found, check whether the run is still active by
  `batchUid`.
- If the dashboard is not running, use the underlying database/query path or
  start the dashboard if appropriate.
- Do not evaluate from incomplete terminal output when a persisted result should
  exist.
