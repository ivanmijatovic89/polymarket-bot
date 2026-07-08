# Tool: extendBacktest

## Purpose

Add market coverage to an existing Telonex backtest run.

## Use When

- A run is promising but has too few markets.
- A result needs more coverage before evaluation.
- You want to extend an existing run backward, forward, or across an explicit
  time range.
- A sweep cell already exists and only its market coverage should increase.

## Do Not Use When

- You need a new strategy, params, symbol, timeframe, input mode, or read source.
- The parent run is not Telonex-backed.
- You only need to inspect current results. Use `getBacktestResults`.
- You are testing another sweep cell or new selected params. Use `runBacktest`
  with the experiment batch UID instead.

## Inputs

- Parent run id.
- Optional market selection: `--limit`, `--latest`, `--random`, `--from-ms`,
  `--to-ms`.

## Precondition

An extension runs on your current commit, while the parent's markets ran on an
older one. Merging them into one run is valid only because frozen strategy
files never change — see the freeze rule in
[`strategy-research-protocol/rules/EXPERIMENT-NAMING.md`](../rules/EXPERIMENT-NAMING.md)
and
[`strategy-research-protocol/PolymarketTwinEngine.md`](../PolymarketTwinEngine.md#workers-run-committed-code-only).
Submit preconditions (clean tree, committed and pushed, worker fleet synced)
per [`strategy-research-protocol/RUNNING.md`](../RUNNING.md).

## Protocol Defaults

Use `extendBacktest` when the strategy, params, symbol, timeframe, input mode,
and read source should stay the same, but the market coverage should grow.

Important defaults:

- The parent run remains the same `run id`.
- The parent run keeps the same `batchUid`; `--batchUid` is inherited and must
  not be passed again.
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

## Relationship To Experiment Batches

Batch UID format is defined in
[`strategy-research-protocol/rules/BATCH-UID.md`](../rules/BATCH-UID.md).
An extension does not create a new experiment, a new sweep cell, or a new
protocol batch label. It enlarges one existing run under the parent's batch UID.

Use extension when the current research question is:

```text
does this same strategy + same params still hold over more markets?
```

Use a new `runBacktest` submission when the question changes:

- different strategy code
- different params or another sweep cell
- different symbol, timeframe, input mode, converter, or read source
- intentionally separate sampling design, such as a fresh random sample that
  should not merge into the parent run

For a sweep, each parameter cell is its own run inside the experiment batch.
Extend the promising cell's run id to add coverage to that exact cell. Do not
extend one cell and treat the result as coverage for other cells.

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
input mode, read source, and batch UID. Do not pass them again.

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
- Same parent `batchUid` for research lookup.
- Internal extension submission id while work is queued/running.

## After Success

Update research memory according to
[`strategy-research-protocol/MEMORY.md`](../MEMORY.md): the experiment's
`coverage` grows in FAMILY.json (run id and batchUid stay the same). No
Research-log entry is due during a climb — the gateLog carries the numbers.

## If It Fails

- If parent run is missing or not Telonex, choose another run.
- If extension is already in progress, wait or resolve the stuck lock manually.
- If there is nothing to extend, record that only if it affects the next
  research decision.
