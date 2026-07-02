# Tool: extendBacktest

## Purpose

Add market coverage to an existing Telonex backtest run.

## Use When

- A run is promising but has too few markets.
- A result needs more coverage before evaluation.
- You want to extend an existing run backward, forward, or across an explicit
  time range.

## Do Not Use When

- You need a new strategy, params, symbol, timeframe, input mode, or read source.
- The parent run is not Telonex-backed.
- You only need to inspect current results. Use `getBacktestResults`.

## Inputs

- Parent run id.
- Optional market selection: `--limit`, `--latest`, `--random`, `--from-ms`,
  `--to-ms`.

## Protocol Defaults

Use `extendBacktest` when the strategy, params, symbol, timeframe, input mode,
and read source should stay the same, but the market coverage should grow.

Important defaults:

- The parent run remains the same `run id`.
- Strategy and params are inherited from the parent run.
- BTC/15m/Telonex settings are inherited from the parent run.
- Result statistics are recomputed over the union of old and new markets.
- Use chunked extensions such as `--limit 500`, `--limit 1000`, or a bounded
  `--from-ms` / `--to-ms` range when you want controlled coverage growth.

Direction:

- Default extension grows backward into older missing markets.
- `--latest` grows forward into newer missing markets.
- Without `--limit`, the tool attempts to consume all missing markets in the
  selected direction or range.

Use the normal BullMQ worker path for meaningful extensions. Extensions can be
large and are expected to run across available workers.

## Implementation

Current implementation: CLI

```bash
npm run backtest -- --extend <run-id> --limit <n>
```

Explicit range:

```bash
npm run backtest -- --extend <run-id> --from-ms <epoch-ms> --to-ms <epoch-ms>
```

With `--extend`, the parent run provides strategy, params, symbol, timeframe,
input mode, and read source. Do not pass them again.

Important protocol rule: `--extend` updates the same parent backtest run. It
does not create a new run id.

Do not use `extendBacktest` to test new params. New params require a new
`runBacktest` run.

## Source Of Truth

Detailed extension behavior belongs to the parent repo docs:

- [`docs/backtest/extending-a-run.md`](../../docs/backtest/extending-a-run.md)
- [`docs/backtest/running-backtests.md`](../../docs/backtest/running-backtests.md)
- [`docs/backtest/parallelization.md`](../../docs/backtest/parallelization.md)
- [`docs/backtest/distributed-future.md`](../../docs/backtest/distributed-future.md)

Do not copy the full extension manual into this tool file. This file defines how
the research protocol should use the extend operation.

## Output

- Updated parent run coverage under the same `run id`.
- New extension `batchUid` while work is queued/running.

## After Success

- Preserve the updated `run id` and latest `batchUid`.
- Update the relevant experiment result reference if coverage changed.
- Summarize the extension in `FAMILY.md`.

## If It Fails

- If parent run is missing or not Telonex, choose another run.
- If extension is already in progress, wait or resolve the stuck lock manually.
- If there is nothing to extend, record that only if it affects the next
  research decision.
