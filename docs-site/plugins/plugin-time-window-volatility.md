---
title: Time Window Volatility Plugin
description: Reference for the TimeWindowVolatility plugin — rolling price volatility statistics over configurable time windows, computed per asset from live orderbook ticks.
---

# Time Window Volatility Plugin

**Plugin ID:** `timeWindowVolatility`  
**Class:** `TimeWindowVolatility`  
**Source:** `src/strategy/plugins/TimeWindowVolatility.ts`

The Time Window Volatility Plugin maintains rolling statistics over configurable time windows for each asset in the current market. It tracks the chosen price (bid, ask, or mid) on every market tick and exposes precomputed metrics — including standard deviation, high/low range, and average absolute change — indexed by asset ID and window label.

This plugin operates **entirely in-process**, requires no network access, and is compatible with both live trading and backtesting.

---

## Configuration

The plugin is instantiated with a `TimeWindowVolatilityConfig` object:

```typescript
type TimeWindowVolatilityConfig = {
  /**
   * Named time windows. Key is the label used in the snapshot;
   * value is the window duration in milliseconds.
   * Example: { '5s': 5000, '30s': 30000, '2m': 120000 }
   */
  windows: Record<string, number>

  /**
   * Which orderbook price to track per asset.
   * 'bid' → bestBid | 'ask' → bestAsk | 'mid' → mid
   * Default: 'mid'
   */
  trackPrice?: 'bid' | 'ask' | 'mid'
}
```

### Configuration Fields

| Field        | Type                      | Default | Description                                                                                                      |
| ------------ | ------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `windows`    | `Record<string, number>`  | —       | Required. Map of label to window duration (ms). Each entry creates one `VolatilityWindowStats` object per asset. |
| `trackPrice` | `'bid' \| 'ask' \| 'mid'` | `'mid'` | The orderbook-derived price to sample on each tick.                                                              |

::: tip Window labelling
Window labels are arbitrary strings. Use descriptive names such as `'5s'`, `'1m'`, `'5m'` — they appear verbatim as keys in `byAssetId[assetId]`.
:::

---

## Output Types

```typescript
type VolatilitySnapshot = {
  asOfTsMs: number | null
  byAssetId: Record<string, Record<string, VolatilityWindowStats>>
}

type VolatilityWindowStats = {
  windowMs: number
  n: number
  startTsMs: number | null
  endTsMs: number | null
  coverageMs: number | null
  ready: boolean
  staleMs: number | null
  startPrice: number | null
  endPrice: number | null
  netChange: number | null
  low: number | null
  high: number | null
  stddev: number | null
  highLowRange: number | null
  avgAbsChange: number | null
}
```

---

## Output Fields

### `VolatilitySnapshot`

| Field       | Type                                                    | Description                                                                                      |
| ----------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `asOfTsMs`  | `number \| null`                                        | Timestamp (ms) of the most recent tick processed. `null` before the first tick.                  |
| `byAssetId` | `Record<string, Record<string, VolatilityWindowStats>>` | Outer key: asset ID. Inner key: window label (as configured). Value: statistics for that window. |

### `VolatilityWindowStats`

| Field          | Type             | Description                                                                                                                                                                                               |
| -------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `windowMs`     | `number`         | Configured window duration in milliseconds.                                                                                                                                                               |
| `n`            | `number`         | Number of samples currently in the window.                                                                                                                                                                |
| `startTsMs`    | `number \| null` | Timestamp of the oldest sample in the window. `null` when no samples exist.                                                                                                                               |
| `endTsMs`      | `number \| null` | Timestamp of the newest sample in the window. `null` when no samples exist.                                                                                                                               |
| `coverageMs`   | `number \| null` | `endTsMs - startTsMs`. Represents the actual time span covered by current samples.                                                                                                                        |
| `ready`        | `boolean`        | `true` when `coverageMs >= windowMs × 0.93` and `n >= 6`. Indicates the window is sufficiently populated for reliable statistics.                                                                         |
| `staleMs`      | `number \| null` | When `ready` is `false` and a previous ready value exists: milliseconds elapsed since the last ready computation. `null` if the window has never been ready, or if it is currently ready (`staleMs = 0`). |
| `startPrice`   | `number \| null` | Price of the oldest sample. Populated when `ready`; otherwise retained from the last ready computation.                                                                                                   |
| `endPrice`     | `number \| null` | Price of the newest sample. Populated when `ready`; otherwise retained from the last ready computation.                                                                                                   |
| `netChange`    | `number \| null` | `endPrice - startPrice`. Populated when `ready`; otherwise retained from the last ready computation.                                                                                                      |
| `low`          | `number \| null` | Minimum price observed within the window. Populated when `ready`.                                                                                                                                         |
| `high`         | `number \| null` | Maximum price observed within the window. Populated when `ready`.                                                                                                                                         |
| `stddev`       | `number \| null` | Population standard deviation of all prices in the window. Populated when `ready`.                                                                                                                        |
| `highLowRange` | `number \| null` | `high - low`. Populated when `ready`.                                                                                                                                                                     |
| `avgAbsChange` | `number \| null` | Average absolute price change between adjacent samples within the window. `0` when `n < 2`. Populated when `ready`.                                                                                       |

::: tip Stale values
When a window temporarily loses coverage (e.g. during a data gap in backtesting), `ready` becomes `false` but the statistical fields retain their last computed values. Use `staleMs` to decide whether stale data is acceptable for your strategy.
:::

---

## Readiness Criteria

A window is `ready` when **both** conditions are met:

1. `coverageMs >= windowMs × 0.93` — at least 93% of the configured duration is spanned by live samples.
2. `n >= 6` — at least 6 price samples are present.

These thresholds prevent misleading statistics at startup or after data gaps.

---

## Accessing the Snapshot in a Strategy

```typescript
import type { VolatilitySnapshot } from '../plugins/TimeWindowVolatility.js'

onMarketTick(ctx, snapshot): Intent[] {
  const vol = ctx.plugins.timeWindowVolatility?.snapshot() as
    VolatilitySnapshot | undefined

  if (!vol) return []

  const upAssetId   = ctx.market.upAssetId
  const downAssetId = ctx.market.downAssetId

  const upVol   = vol.byAssetId[upAssetId]?.['30s']
  const downVol = vol.byAssetId[downAssetId]?.['30s']

  if (!upVol?.ready || !downVol?.ready) return []

  const stddev = upVol.stddev!
  const range  = upVol.highLowRange!

  // ...
  return []
}
```

::: details PluginSet registration example

```typescript
import { TimeWindowVolatility } from '../plugins/TimeWindowVolatility.js'

const pluginSet = new PluginSet([
  new TimeWindowVolatility({
    windows: {
      '5s': 5_000,
      '30s': 30_000,
      '2m': 120_000,
      '5m': 300_000,
    },
    trackPrice: 'mid',
  }),
])
```

:::

---

## Behaviour Notes

- A separate rolling window is maintained per `(assetId, label)` pair. New asset IDs are registered automatically on first observation.
- Samples are evicted from the window when their timestamp falls outside the `[nowMs - windowMs, nowMs]` range. The eviction process correctly maintains the running sum, sum-of-squares, and adjacency differences without a full recomputation.
- The plugin's `reset()` method clears all accumulated data. `StrategyRunner` calls `reset()` between market window episodes in backtests.
