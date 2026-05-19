---
title: Chunked Batch Statistics
description: Reference for the chunked batch statistics system — fixed-size time windows used to analyse strategy stability and performance drift across a backtest run.
---

# Chunked Batch Statistics

`ChunkedBatchStats` is produced by `computeChunkedBatchStats` in `src/backtest/stats/chunkedBatchStats.ts`. It divides a sorted sequence of `MarketStats` records into fixed-size windows (chunks), computes `BatchStats` for each chunk independently, and then derives stability signals across the resulting segments.

This representation is used for **learning-curve analysis** — evaluating whether a strategy's edge is consistent across time or concentrated in a particular period.

## Chunking Semantics

Markets are first sorted chronologically by the numeric timestamp embedded in each slug (e.g. `btc-updown-15m-`**`1700000000`**). They are then partitioned into fixed-size windows of length `window`.

**Remainder handling:** any trailing markets that do not fill a complete window are appended to the final chunk rather than forming a separate, undersized segment.

```
1350 markets @ window=300  →  300, 300, 300, 450
```

If the total number of markets is less than `window`, all markets form a single segment.

### Running capital

Segments are computed sequentially. Each segment starts with the `capitalFinal` of the preceding segment, so cumulative compounding is tracked across chunks. The first segment starts with `initialCapital`.

## Computation

```ts
import { computeChunkedBatchStats } from '../backtest/stats/chunkedBatchStats.js'

const result = computeChunkedBatchStats(markets, initialCapital, [96, 200, 300])
```

- `markets` — array of `MarketStats` (output of one backtest run).
- `initialCapital` — starting USDC balance.
- `windows` — array of chunk sizes. Defaults to `[96, 200, 300]` when omitted.

The backtest CLI always computes chunked stats for windows `[96, 200, 300]` and stores them with each run record.

## Top-Level Output: `ChunkedBatchStats`

| Field     | Type                     | Description                                            |
| --------- | ------------------------ | ------------------------------------------------------ |
| `windows` | `ChunkedBatchStatsRun[]` | One entry per window size.                             |
| `version` | `number`                 | Schema version (`4` as of the current implementation). |

## Per-Window Record: `ChunkedBatchStatsRun`

| Field                    | Type                       | Description                                                                                            |
| ------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `window`                 | `number`                   | The chunk size used (number of markets per segment).                                                   |
| `segments`               | `Segment[]`                | Ordered array of segment results. See below.                                                           |
| `segmentsCount`          | `number`                   | Number of segments produced.                                                                           |
| `positivePct`            | `number`                   | Fraction of segments where `evPerMarketTotal >= 0`, in `[0, 1]`.                                       |
| `maxConsecutiveNegative` | `number`                   | Longest consecutive run of segments with `evPerMarketTotal < 0`.                                       |
| `stabilityPass`          | `boolean`                  | `true` when `positivePct >= 0.7`. A simple guard against strategies that only win intermittently.      |
| `walkForward`            | `WalkForwardWindowMetrics` | Walk-forward fold analysis across the segments. See [Walk-Forward Ranking](./walk-forward-ranking.md). |
| `version`                | `number`                   | Schema version for this run record.                                                                    |

## Segment Record

Each entry in `segments` covers one contiguous slice of markets.

| Field          | Type         | Description                                                                            |
| -------------- | ------------ | -------------------------------------------------------------------------------------- |
| `i`            | `number`     | Zero-based index of the segment within this window.                                    |
| `fromTs`       | `number`     | Epoch timestamp (seconds) of the first market in the segment, parsed from the slug.    |
| `toTs`         | `number`     | Epoch timestamp (seconds) of the last market in the segment, parsed from the slug.     |
| `marketsTotal` | `number`     | Number of markets in this segment. Equal to `window` for all segments except the last. |
| `batch_stats`  | `BatchStats` | Full `BatchStats` for this segment. See [Batch Statistics](./batch-stats.md).          |

## Interpreting the Results

### Stability pass

`stabilityPass: true` indicates that at least 70% of time windows produced a non-negative expected value. This is a necessary but not sufficient condition for a deployable strategy — it should be combined with the walk-forward analysis.

### Learning curve

By examining `segments[i].batch_stats.evPerMarketTotal` across increasing `i`, you can detect:

- **Ramp-up** — early segments underperform as the strategy has not yet encountered representative market conditions.
- **Decay** — later segments show declining edge, which may indicate regime changes or overfitting to earlier data.
- **Consistency** — flat or gently rising EV across segments indicates a robust signal.

### Window size selection

| Window | Typical use                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------- |
| `96`   | Fine-grained; detects short-term instability. Requires many markets to produce meaningful segments. |
| `200`  | Balanced; ~3-4 months of 15-minute BTC episodes.                                                    |
| `300`  | Coarse; best suited to large batch runs (1 000+ markets).                                           |

::: tip
Use the `96`-market window as the primary stability filter during strategy development. Larger windows smooth out noise and are more useful for comparing strategies across long historical ranges.
:::

## Example Output

```json
{
  "version": 4,
  "windows": [
    {
      "window": 96,
      "segmentsCount": 5,
      "positivePct": 0.8,
      "maxConsecutiveNegative": 1,
      "stabilityPass": true,
      "version": 4,
      "segments": [
        {
          "i": 0,
          "fromTs": 1700000000,
          "toTs": 1700086400,
          "marketsTotal": 96,
          "batch_stats": {
            "capitalInitial": 1000,
            "capitalFinal": 1018.4,
            "evPerMarketTotal": 0.19,
            "winRatePct": 61.54
          }
        },
        {
          "i": 1,
          "fromTs": 1700087300,
          "toTs": 1700173700,
          "marketsTotal": 96,
          "batch_stats": {
            "capitalInitial": 1018.4,
            "capitalFinal": 1035.1,
            "evPerMarketTotal": 0.17,
            "winRatePct": 60.0
          }
        }
      ],
      "walkForward": {
        "segmentCount": 5,
        "minEv": -0.05,
        "tailPositivePct": 1.0,
        "tailMeanEv": 0.15,
        "wfMeanEv": 0.14,
        "wfBadSegs": 0,
        "feesPerMarketAll": 0.08,
        "stabilityPass": true,
        "foldMode": "none",
        "version": 1
      }
    }
  ]
}
```

::: details Rebuilding chunked stats for existing runs
If the chunked stats schema changes (version bump), existing database records can be recomputed without re-running the full backtest:

```bash
npm run rebuild:chunked-batch-stats
```

See [rebuild-chunked-batch-stats](/research/rebuild-chunked-batch-stats) for details.
:::
