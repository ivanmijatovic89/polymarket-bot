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

## Protocol Defaults

Use these defaults unless the experiment explicitly says otherwise:

- `symbol=btc`
- `timeframe=15m`
- `input-mode=telonex-delta`
- `converter=delta-typed`
- one market equals one BTC 15 minute up/down episode
- use an explicit `--batchUid` when the run belongs to a named experiment
- preserve the resulting `run id` and `batchUid`

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

- Preserve the `run id` or `batchUid`.
- Write the result reference to the relevant experiment in `FAMILY.json`.
- Summarize what was run in `FAMILY.md`.

## If It Fails

- Fix invalid strategy id, params, dataset selection, or environment issue.
- Do not mark the experiment `done`.
- Record only meaningful failures that affect research memory.
