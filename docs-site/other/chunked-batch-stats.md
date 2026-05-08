# Chunked Batch Stats

This module computes batch stats over fixed-size market windows, producing a
sequence of segments per window size. It is intended for analyzing stability
and performance drift across a backtest batch.

File: `src/backtest/stats/chunkedBatchStats.ts`

## Inputs

- `markets`: array of `MarketStats` (parsed from `market_stats` JSON).
- `initialCapital`: starting capital for the first segment (USDC).
- `windows` (optional): array of window sizes. Default is `[96, 200, 300]`.

## Behavior

- Markets are sorted by slug timestamp (the numeric suffix of the slug).
- For each window size:
  - Markets are chunked into fixed windows.
  - Any remainder becomes its own final chunk.
  - Each chunk computes a `batch_stats` using the running capital.
  - The next chunk starts with the previous chunk's `capitalFinal`.
- A summary is added per window:
  - `positivePct`: share of segments with `evPerMarketTotal >= 0`.
  - `maxConsecutiveNegative`: longest streak of negative `evPerMarketTotal`.
  - `stabilityPass`: `positivePct >= 0.7`.

## Output Shape (example)

```json
{
  "version": 1,
  "windows": [
    {
      "window": 96,
      "segmentsCount": 12,
      "positivePct": 0.75,
      "maxConsecutiveNegative": 2,
      "stabilityPass": true,
      "version": 1,
      "segments": [
        {
          "i": 0,
          "fromTs": 1700000000,
          "toTs": 1700000950,
          "marketsTotal": 96,
          "batch_stats": { "capitalInitial": 100, "capitalFinal": 104, "...": "..." }
        }
      ],
      "walkForward": {
        "version": 1,
        "segmentCount": 12,
        "minEv": -0.12,
        "tailPositivePct": 0.75,
        "tailMeanEv": 0.08,
        "wfMeanEv": 0.05,
        "wfBadSegs": 2,
        "feesPerMarketAll": 0.12,
        "stabilityPass": true,
        "foldMode": "fold3",
        "fold2": { "wfMeanEv": 0.03, "wfBadSegs": 2, "stabilityPass": true },
        "fold3": { "wfMeanEv": 0.05, "wfBadSegs": 2, "stabilityPass": true }
      }
    }
  ]
}
```

## Usage

```ts
import { computeChunkedBatchStats } from '../backtest/stats/chunkedBatchStats.js'

const chunked = computeChunkedBatchStats(markets, initialCapital, [96, 200, 300])
```

## Notes

- `slug` is expected to end with a numeric timestamp segment (e.g. `...-1700000000`).
- The function is deterministic for the same inputs.
