---
title: Walk-Forward Ranking
description: Reference for the walk-forward analysis layer that evaluates out-of-sample segment performance within chunked batch statistics.
---

# Walk-Forward Ranking

Walk-forward ranking is computed by `computeWalkForwardForRun` in `src/backtest/stats/walkForwardRank.ts`. It operates on the ordered sequence of segments produced by the chunked batch statistics system and provides a cross-validated view of out-of-sample performance.

The analysis is embedded in each `ChunkedBatchStatsRun` under the `walkForward` key. It is not invoked separately — it runs automatically as part of `computeChunkedBatchStats`.

## What Walk-Forward Analysis Means Here

Rather than a full rolling-window optimise-then-test procedure, this implementation uses a **fold-based selection**: a fixed set of segment indices is treated as a validation window, and the mean expected value (`evPerMarketTotal`) across those indices is reported as the out-of-sample estimate.

Two fold configurations are available, selected based on how many segments exist:

| Mode    | Minimum segments | Fold indices selected                     |
| ------- | ---------------- | ----------------------------------------- |
| `fold2` | 7                | 3 early segments + 4 tail segments        |
| `fold3` | 10               | 6 early-to-mid segments + 4 tail segments |
| `none`  | < 7              | No fold computed                          |

When both folds are available (`segmentCount >= 10`), `fold3` is used as the primary (`wfMeanEv`, `wfBadSegs`). `fold2` results are preserved in the output for reference.

## Stability Gate

A common stability condition is applied across both the top-level `walkForward` metrics and each fold:

```
stabilityPass = true
  when: segmentCount >= 4
    AND tailPositivePct >= 1.0   (all tail segments positive)
    AND minEv >= -0.3            (worst segment not catastrophic)
```

The tail is always the last 4 segments. `segmentCount >= 4` is a hard minimum — fewer segments do not provide enough evidence.

## Output Fields: `WalkForwardWindowMetrics`

| Field              | Type                                  | Description                                                                                                          |
| ------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `segmentCount`     | `number`                              | Total number of segments in the chunked run.                                                                         |
| `minEv`            | `number`                              | Lowest `evPerMarketTotal` across all segments. A strongly negative value indicates at least one catastrophic window. |
| `tailPositivePct`  | `number`                              | Fraction of the last 4 segments where `evPerMarketTotal >= 0`, in `[0, 1]`. Measures recent performance momentum.    |
| `tailMeanEv`       | `number`                              | Mean `evPerMarketTotal` of the last 4 segments.                                                                      |
| `wfMeanEv`         | `number`                              | Mean `evPerMarketTotal` across the active fold's indices. This is the primary walk-forward estimate.                 |
| `wfBadSegs`        | `number`                              | Number of fold indices with `evPerMarketTotal < 0`. Lower is better.                                                 |
| `feesPerMarketAll` | `number`                              | Total fees paid across all segments divided by total markets. Useful for assessing fee drag relative to EV.          |
| `stabilityPass`    | `boolean`                             | Result of the stability gate applied to the top-level tail metrics and `minEv`.                                      |
| `foldMode`         | `'fold3' \| 'fold2' \| 'none'`        | Which fold configuration was used to populate `wfMeanEv` and `wfBadSegs`.                                            |
| `fold2`            | `WalkForwardFoldMetrics \| undefined` | Results for the 7-segment fold. Present when `segmentCount >= 7`.                                                    |
| `fold3`            | `WalkForwardFoldMetrics \| undefined` | Results for the 10-segment fold. Present when `segmentCount >= 10`.                                                  |
| `version`          | `number`                              | Schema version (`1` as of the current implementation).                                                               |

## Output Fields: `WalkForwardFoldMetrics`

Each fold produces its own metrics:

| Field           | Type      | Description                                                                                                               |
| --------------- | --------- | ------------------------------------------------------------------------------------------------------------------------- |
| `wfMeanEv`      | `number`  | Mean `evPerMarketTotal` across the fold's selected segment indices.                                                       |
| `wfBadSegs`     | `number`  | Number of selected segment indices with `evPerMarketTotal < 0`.                                                           |
| `stabilityPass` | `boolean` | Stability gate applied using the fold's segment count, `tailPositivePct` from the parent run, and the fold's own `minEv`. |

## Relationship to Chunked Batch Stats

Walk-forward ranking works exclusively with the `evPerMarketTotal` values from each segment's `batch_stats`. It does not re-read Parquet files or re-run strategies — it is a post-processing step on already-computed `BatchStats` objects.

The segment ordering is chronological (earliest market epochs first), which is a prerequisite for the walk-forward fold indices to carry temporal meaning.

## Example

```json
{
  "segmentCount": 12,
  "minEv": -0.08,
  "tailPositivePct": 1.0,
  "tailMeanEv": 0.22,
  "wfMeanEv": 0.18,
  "wfBadSegs": 1,
  "feesPerMarketAll": 0.09,
  "stabilityPass": true,
  "foldMode": "fold3",
  "fold2": {
    "wfMeanEv": 0.15,
    "wfBadSegs": 1,
    "stabilityPass": true
  },
  "fold3": {
    "wfMeanEv": 0.18,
    "wfBadSegs": 1,
    "stabilityPass": true
  },
  "version": 1
}
```

::: tip Interpreting `stabilityPass`
`stabilityPass: true` at the walk-forward level requires that the entire tail of recent segments is profitable and that no single segment lost more than 0.30 USDC per market on average. A strategy that passes this gate across multiple window sizes (96, 200, 300) has demonstrated consistent in-sample performance without catastrophic windows.
:::

::: warning Limitations
The fold indices are fixed relative to segment count rather than optimised per run. This avoids look-ahead bias in index selection, but the approach is less rigorous than a full expanding-window walk-forward optimisation. Use these metrics as a screening filter, not as a definitive out-of-sample validation.
:::
