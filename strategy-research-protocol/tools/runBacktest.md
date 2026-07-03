# Tool: runBacktest

## Purpose

Create a new backtest run for one strategy or experiment.

## Use When

- An experiment is ready to run for the first time.
- You need a fresh result with explicit strategy params or sweep params.
- You need a quick local smoke test before a larger queued run.

## Do Not Use When

- You are adding coverage to an existing run. Use `extendBacktest`.
- You only need to inspect an existing result. Use `getBacktestResults`.

## Inputs

- Strategy id.
- Optional strategy params.
- Market selection: latest, random, explicit time range, or limit.
- Optional execution mode: sequential, queued, or detached.

## Precondition

Commit (and push, when workers run on other machines) before submitting —
workers run committed code only. See
[`strategy-research-protocol/PolymarketTwinEngine.md`](../PolymarketTwinEngine.md#workers-run-committed-code-only).

## Protocol Defaults

Use these defaults unless the experiment explicitly says otherwise:

- `symbol=btc`
- `timeframe=15m`
- `input-mode=telonex-delta`
- `converter=delta-typed`
- one market equals one BTC 15 minute up/down episode
- use an explicit `--batchUid` when the run belongs to a named experiment
- preserve the resulting `run id` and `batchUid`

Batch UID format is defined in
[`strategy-research-protocol/rules/BATCH-UID.md`](../rules/BATCH-UID.md).
For a research experiment, the default label is:

```text
<family>--<experiment-id>
```

Read source depends on where workers run:

- Single local machine with prewarmed data: `--read-from local`
- Distributed workers across several machines:
  `--read-from local-or-download-from-r2-to-local`
- Cloud or disposable workers with no local cache: `--read-from r2`

Selection profile:

- Smoke test: `--latest --limit 10 --sequential`
- First meaningful experiment run: `--latest --limit 500`
- Larger confidence run: increase coverage with `extendBacktest` instead of
  creating unrelated runs with different params.
- Robustness or bias check: use `--random --limit <n>` only when the experiment
  explicitly needs random sampling.

## Sweep Grids

A sweep grid expands to one backtest run per parameter combination. The grid is
the Cartesian product of each listed parameter array:

```text
params:
  minSpreadTicks: [1, 2]
  orderSize: [5, 10, 20]
```

This produces six runs:

```text
minSpreadTicks=1 orderSize=5
minSpreadTicks=1 orderSize=10
minSpreadTicks=1 orderSize=20
minSpreadTicks=2 orderSize=5
minSpreadTicks=2 orderSize=10
minSpreadTicks=2 orderSize=20
```

Submit every cell with the same experiment `--batchUid`. The batch answers
"how did this experiment do"; each run inside the batch answers "how did this
parameter cell do." Do not invent per-cell batch labels.

For non-sweep experiments, submit exactly one run under the experiment
`--batchUid`.

When a sweep must be re-run because of a bug, bad data, or broken submission,
do not reuse the old label for a different effective experiment. Follow the
re-run suffix rule in
[`strategy-research-protocol/rules/BATCH-UID.md`](../rules/BATCH-UID.md), for
example:

```text
book-imbalance--002-persistence-filter--r2
```

The experiment result reference in `FAMILY.json` should point to the batch UID
that counts for evaluation.

## Implementation

Current implementation: CLI

Default BTC 15m Telonex command:

```bash
npm run backtest:telonex:btc:15m -- --strategy <strategy-id>
```

Equivalent explicit command:

```bash
npm run backtest -- --input-mode telonex-delta --read-from local --symbol btc --timeframe 15m --strategy <strategy-id>
```

Common protocol-level flags:

```bash
--param <key=value>
--limit <n>
--latest
--random
--from-ms <epoch-ms>
--to-ms <epoch-ms>
--sequential
--detach
--batchUid <id>
```

Sweep cells are submitted as separate commands that share `--batchUid`:

```bash
npm run backtest:telonex:btc:15m -- --strategy <strategy-id> \
  --latest --limit 500 \
  --batchUid <family>--<experiment-id> \
  --param minSpreadTicks=1 \
  --param orderSize=5

npm run backtest:telonex:btc:15m -- --strategy <strategy-id> \
  --latest --limit 500 \
  --batchUid <family>--<experiment-id> \
  --param minSpreadTicks=1 \
  --param orderSize=10
```

For meaningful runs, prefer the normal BullMQ worker path. Use `--sequential`
only for smoke tests, local debugging, or parity checks.

## Source Of Truth

Detailed CLI behavior belongs to the parent repo docs:

- [`docs/backtest/running-backtests.md`](../../docs/backtest/running-backtests.md)
- [`docs/datasets/telonex/backtest.md`](../../docs/datasets/telonex/backtest.md)
- [`docs/backtest/parallelization.md`](../../docs/backtest/parallelization.md)
- [`docs/backtest/distributed-future.md`](../../docs/backtest/distributed-future.md)
- [`docs/backtest/worker-self-update.md`](../../docs/backtest/worker-self-update.md)

Do not copy the full CLI manual into this tool file. This file defines how the
research protocol should use the backtest operation.

## Output

- New backtest run.
- `run id` after persistence.
- `batchUid` for queued/detached tracking.

## After Success

Update research memory according to
[`strategy-research-protocol/MEMORY.md`](../MEMORY.md).

- Preserve the `run id` or `batchUid`.
- Write the result reference to the relevant experiment in
  `src/strategies/research/<family>/FAMILY.json`.
- Summarize what was run in
  `src/strategies/research/<family>/FAMILY.md`.

## If It Fails

- Fix invalid strategy id, params, dataset selection, or environment issue.
- Do not mark the experiment `done`.
- Record only meaningful failures that affect research memory.
