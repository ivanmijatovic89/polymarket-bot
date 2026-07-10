# Generate Jobs from Grid Strategy Params

This document explains how to **generate large parameter-grid backtest job lists** using a single JSON definition file and a TypeScript CLI script.

The goal is to make **strategy parameter optimization reproducible, scalable, and strategy-agnostic**.

---

## Overview

Instead of manually running backtests with different parameters, we define:

- a **grid JSON file** (`*-grid.json`)
- a **job generator script**
- which produces a **jobs file** under `generated/backtest-jobs/`
- where **each line is a full executable CLI command**

These jobs are plain shell commands. Review the generated file, then run selected commands manually or feed them into your current orchestration workflow.

---

## Why This Exists

- Avoid hardcoding parameter combinations in code
- Make grid search **declarative**
- Support **any strategy** without changing the generator
- Enforce **parameter constraints** (time windows, ranges, etc.)
- Keep results **reproducible**

---

## File Structure

Example strategy folder:

```
src/strategies/split/jobs/
├── v5/
│   └── v5-dwell-ranges.json
└── v6/
    └── v6-tick-price-offset.json

generated/backtest-jobs/
├── v5-dwell-ranges-jobs.txt
├── v5-dwell-ranges-jobs-2.txt
└── v5-dwell-ranges-jobs-3.txt
```

---

## Grid File Format (`*-grid.json`)

### Example

```json
{
  "before": "npm run backtest -- --strategy SplitSellRedeem.v3",
  "after": "--symbol btc --limit 10 --random",
  "params": {
    "splitShares": [100],
    "dwellTrackPrice": ["bid"],
    "sellSize": [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 30],
    "dwallRanges": [
      [0.2, 0.35],
      [0.2, 0.4],
      [0.25, 0.35]
    ],
    "dwellSecondsRequired": [10, 15, 20, 25, 30, 35, 40, 45, 50, 60],
    "timeFilterAllowTradingAfterSeconds": [120, 180, 240, 300, 360, 420, 480, 540, 600],
    "timeFilterDisableTradingAfterSeconds": [300, 360, 420, 480, 540, 600, 660, 720, 780, 820, 900]
  }
}
```

---

## Special Parameters

### dwallRanges

Defined as range pairs:

```
"dwallRanges": [[0.20, 0.35], [0.25, 0.40]]
```

Expanded into:

```
--param dwellRangeFrom=0.20
--param dwellRangeTo=0.35
```

---

## Time Window Constraint

The generator enforces:

```
timeFilterAllowTradingAfterSeconds + 60 <= timeFilterDisableTradingAfterSeconds
```

Ensuring at least **60 seconds of valid trading window**.

---

## Running the Generator

```bash
npm run generate:grid:jobs -- ./src/strategies/split/jobs/v3-grid.json
```

---

## Design Philosophy

- Grid definition is **pure data**
- Generator is **strategy-agnostic**
- Output is **portable shell commands**
- Fully reproducible research runs
