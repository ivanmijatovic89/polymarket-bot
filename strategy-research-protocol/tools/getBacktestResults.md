# Tool: getBacktestResults

## Purpose

Retrieve persisted backtest result summaries for judgment. In the research
loop, raw results are read by the **Evaluator only** — the Researcher
consumes the Evaluator's judgment from FAMILY.json, never the raw numbers.

## Use When

- `checkBatch` reports an experiment's submissions complete and a pass or an
  experiment needs judgment.
- A recorded result reference needs to be re-inspected.

## Do Not Use When

- The runs are not finished — check with
  [`strategy-research-protocol/tools/checkBatch.md`](./checkBatch.md) first.
- You need to create or extend a run.
- You are the Researcher deciding what to do next — read FAMILY.json instead.

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
- For pass judgment, reduce the batch to a per-cell table sorted by
  `netEvPerMarket` (net of fees — the only verdict metric; gross is
  diagnostic), with markets and trade counts per cell. Judgment guidance
  lives in
  [`strategy-research-protocol/modules/Evaluator.md`](../modules/Evaluator.md).

## After Success

The Evaluator records judgment in FAMILY.json per
[`strategy-research-protocol/MEMORY.md`](../MEMORY.md):

- pass judgment → `best` + `note` on the pass
- experiment judgment → full `outcome` (verdict quoting the successCriteria,
  metrics, `stageReached`, `gatesVersion`), status `evaluated`, and champion /
  `validated` updates when warranted

The Evaluator never writes FAMILY.md — the Research-log entry is written by
the Researcher when it consumes the verdict.

## If It Fails

- Not found by run id: check the batch by `batchUid` — it may still be
  queue-active; re-run `checkBatch`.
- Dashboard not running: use the underlying database query path or start the
  dashboard.
- Never judge from incomplete terminal output when a persisted result should
  exist.
