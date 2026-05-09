---
title: Generate Backtest Jobs
description: How to use generate-jobs.ts to expand a parameter grid into a flat list of backtest commands ready for the parallel queue runner.
---

# Generate Backtest Jobs

`src/backtest/generate-jobs.ts` reads a JSON grid specification and writes one shell command per parameter combination into a jobs file in `queue/approve/`. The output is consumed directly by the [Parallel Backtest Runner](./ParallelBacktestRunner.md).

## What It Generates

Each output line is a fully formed `npm run backtest` command with `--param key=value` flags for every combination of the supplied parameter arrays. The Cartesian product of all parameter arrays is expanded, so N parameters with lengths `[a, b, c]` produce `a × b × c` jobs.

A constraint filters out combinations where `timeFilterAllowTradingAfterSeconds + 60 > timeFilterDisableTradingAfterSeconds`, preventing nonsensical time-filter configurations.

## Grid File Format

The grid file is a JSON object with three top-level keys.

```json
{
  "before": "npm run backtest -- --strategy SplitSellRedeem.v1 --symbol btc --limit 500",
  "after": "--comment grid-search-v1",
  "params": {
    "splitShares": [50, 100, 200],
    "triggerBidBelow": [0.18, 0.2, 0.22],
    "sellPrice": [0.21, 0.23, 0.25],
    "sellSize": [10]
  }
}
```

### `before` (string, required)

The command prefix prepended to every generated job. This must include `npm run backtest --` and any flags that are constant across the entire grid (strategy ID, symbol, limit, etc.).

### `after` (string)

Optional suffix appended to every job after the `--param` flags. Use it for flags such as `--comment`, `--batchUid`, or file paths that apply to every run.

### `params` (object, required)

Each key is a strategy parameter name. Each value must be an **array** of values to sweep. The generator takes the Cartesian product of all arrays.

Supported value types per element: `number`, `string`, `boolean`. Objects or arrays are serialised to JSON strings.

### Special key: `dwallRanges`

If `dwallRanges` is present in `params`, it is handled separately from the Cartesian product. Each element must be a two-element array `[from, to]`. For every parameter combination, one job is emitted per range pair, with `--param dwellRangeFrom=<from>` and `--param dwellRangeTo=<to>` appended. Values are formatted to two decimal places.

```json
{
  "params": {
    "splitShares": [100, 200],
    "dwallRanges": [
      [0.1, 0.2],
      [0.2, 0.35]
    ]
  }
}
```

This produces `2 × 2 = 4` jobs: two `splitShares` values crossed with two dwell ranges.

## Running the Generator

```bash
npx tsx src/backtest/generate-jobs.ts <path-to-grid.json>
```

### Output file location

The output file is placed in `queue/approve/` and named by replacing `-grid.json` with `-jobs.txt` in the source filename. If a file with that name already exists, a numeric suffix is appended (`-2`, `-3`, ...).

```
src/strategies/split/v1-grid.json  →  queue/approve/v1-jobs.txt
```

The `queue/approve/` directory is created automatically if it does not exist.

### Console output

```
Wrote 27 jobs to /path/to/queue/approve/v1-jobs.txt
Grid file: /path/to/src/strategies/split/v1-grid.json
Jobs written to: /path/to/queue/approve/v1-jobs.txt
Total jobs: 27
```

## Output Format

Each line in the jobs file is a self-contained shell command:

```bash
npm run backtest -- --strategy SplitSellRedeem.v1 --symbol btc --limit 500 --param splitShares=50 --param triggerBidBelow=0.18 --param sellPrice=0.21 --param sellSize=10 --comment grid-search-v1
npm run backtest -- --strategy SplitSellRedeem.v1 --symbol btc --limit 500 --param splitShares=50 --param triggerBidBelow=0.18 --param sellPrice=0.23 --param sellSize=10 --comment grid-search-v1
npm run backtest -- --strategy SplitSellRedeem.v1 --symbol btc --limit 500 --param splitShares=50 --param triggerBidBelow=0.18 --param sellPrice=0.25 --param sellSize=10 --comment grid-search-v1
```

Parameter values are quoted only when they contain characters outside `[a-zA-Z0-9._=:/+-]`.

## Using the Output with the Parallel Queue

Once the jobs file is in `queue/approve/`, move it (or leave it) and start the queue runner:

```bash
./queue/run-queue.sh --jobs 8 --save-results
```

The queue runner picks up files from `queue/approve/`, moves them to `queue/pending/` while running, and places results in `queue/done/` or `queue/failed/`. See [Parallel Backtest Runner](./ParallelBacktestRunner.md) for full queue documentation.

::: tip Grid file naming convention
Name grid files as `<version>-grid.json` (e.g. `v3-grid.json`) so the generator can automatically derive the jobs filename (`v3-jobs.txt`). Store grid files alongside the strategy source under `src/strategies/<family>/`.
:::

::: warning Parameter constraint
Combinations where `timeFilterAllowTradingAfterSeconds + 60 > timeFilterDisableTradingAfterSeconds` are silently dropped. This avoids generating jobs with overlapping or inverted time-filter windows. Ensure your grid values satisfy `allow + 60 <= disable` for all intended combinations.
:::

## Complete Example

**Grid file** at `src/strategies/split/v2-grid.json`:

```json
{
  "before": "npm run backtest -- --strategy SplitSellRedeem.v2 --symbol btc --limit 300 --random",
  "after": "--comment v2-grid-run1",
  "params": {
    "splitShares": [50, 100],
    "triggerBidBelow": [0.18, 0.2],
    "sellPrice": [0.21, 0.23],
    "dwallRanges": [
      [0.1, 0.2],
      [0.2, 0.35]
    ]
  }
}
```

**Command:**

```bash
npx tsx src/backtest/generate-jobs.ts src/strategies/split/v2-grid.json
```

**Result:** `2 × 2 × 2 × 2 = 16` jobs written to `queue/approve/v2-jobs.txt`.
