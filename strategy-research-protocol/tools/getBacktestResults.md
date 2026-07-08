# Tool: getBacktestResults

## Purpose

Retrieve persisted backtest result summaries for judgment. In the research
loop, the Researcher reads results only for COMPLETE work (per
[`checkBatch`](./checkBatch.md)) and judges them against the experiment's
pre-declared `successCriteria` — never against criteria invented after
seeing the numbers.

## Use When

- `checkBatch` reports an experiment's submissions complete and a pass or an
  experiment needs judgment.
- A recorded result reference needs to be re-inspected.

## Do Not Use When

- The runs are not finished — check with
  [`strategy-research-protocol/tools/checkBatch.md`](./checkBatch.md) first.
- You need to create or extend a run.

## Inputs

- Backtest run id, or
- `batchUid` (one coordinate pass / one single-run experiment).

## Implementation

Current implementation: dashboard API / database-backed query

```bash
curl -sS http://localhost:3051/api/backtests/<run-id>
curl -sS http://localhost:3051/api/batches/<batchUid>
```

The API reads persisted run data from the dashboard/database layer. Batch
lookup may return active queue state before the run is finalized — that is
why completion is checked with `checkBatch` first.

## Source Of Truth

- [`docs/backtest/statistics/result-storage.md`](../../docs/backtest/statistics/result-storage.md)
- [`docs/backtest/statistics/run-statistics.md`](../../docs/backtest/statistics/run-statistics.md)
- [`docs/backtest/statistics/run-markets.md`](../../docs/backtest/statistics/run-markets.md)
- [`docs/backtest/statistics/backtest-segments.md`](../../docs/backtest/statistics/backtest-segments.md)

## Output

- Run metadata, batch stats, market stats, failed markets, segment summaries,
  execution summary and per-market timing when available.
- What to look at and how to judge it lives in the Judging results section
  of
  [`strategy-research-protocol/modules/Researcher.md`](../modules/Researcher.md).

## After Success

The Researcher records the judgment in FAMILY.json — which fields, per
[`strategy-research-protocol/MEMORY.md`](../MEMORY.md); how to judge, per
the Judging results section of
[`strategy-research-protocol/modules/Researcher.md`](../modules/Researcher.md).

## If It Fails

- Not found by run id: check the batch by `batchUid` — it may still be
  queue-active; re-run `checkBatch`.
- Dashboard not running: report it and STOP — never start the dashboard
  yourself and never improvise database queries; the operator starts it
  (SESSIONS.md preconditions), then the session is relaunched.
- Never judge from incomplete terminal output when a persisted result should
  exist.
