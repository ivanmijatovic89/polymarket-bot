---
title: Deribit Volatility Index Plugin
description: Reference for the DeribitVolatilityIndexPlugin — BTC implied volatility candles at 5-minute, 15-minute, and 1-hour resolutions sourced from the Deribit REST API.
---

# Deribit Volatility Index Plugin

**Plugin ID:** `deribitVolatilityIndex`  
**Class:** `DeribitVolatilityIndexPlugin`  
**Source:** `src/strategy/plugins/DeribitVolatilityIndexPlugin.ts`

The Deribit Volatility Index Plugin fetches BTC implied volatility (DVOL) data from the Deribit public REST API and aggregates it into OHLC candles at three resolutions: **5-minute**, **15-minute**, and **1-hour**. The `close` value of each candle represents the implied volatility index at that point in time.

::: warning Live trading only
This plugin makes outbound HTTP requests and is designed for live trading. In backtests it will still attempt to fetch from Deribit, but network availability is not guaranteed in offline or isolated environments. The snapshot will remain `undefined` if the fetch fails or the slug is not supported.
:::

---

## Data Source

Candles are fetched from the Deribit public volatility index endpoint:

```
GET https://www.deribit.com/api/v2/public/get_volatility_index_data
  ?currency=BTC
  &start_timestamp=<ms>
  &end_timestamp=<ms>
  &resolution=60
```

The plugin always requests **60-second base candles**, then aggregates them in-process to produce 5-minute (300 s), 15-minute (900 s), and 1-hour (3600 s) candles. No authentication is required.

The `end_timestamp` is set to `epochStartMs - 1` — the millisecond immediately before the current 15-minute market window opens — so all volatility data is strictly historical with respect to the active market.

::: tip
The plugin only supports markets with slugs that parse as valid BTC updown-15m windows. Non-BTC slugs produce `undefined` and a console warning.
:::

---

## Resolutions

| Key (`byResolutionSec`) | Duration   | Description                                               |
| ----------------------- | ---------- | --------------------------------------------------------- |
| `300`                   | 5 minutes  | Primary resolution. Preferred for short-term vol reading. |
| `900`                   | 15 minutes | Aligns with the Polymarket 15-minute window boundary.     |
| `3600`                  | 1 hour     | Secondary resolution for structural vol context.          |

A candle is `null` at a given resolution when the base 60-second candles are insufficient to fill the expected time bucket completely.

---

## Output Type

```typescript
type DvolCandle = {
  openTime: number // ms — open of the aggregated bucket
  closeTime: number // ms — close of the aggregated bucket
  open: number // DVOL index at bucket open
  high: number // highest DVOL value in the bucket
  low: number // lowest DVOL value in the bucket
  close: number // DVOL index at bucket close
}

type DeribitVolatilityIndexSnapshot = {
  asOfTimeMs: number
  currency: 'BTC'
  byResolutionSec: Record<300 | 900 | 3600, DvolCandle | null>
  alignmentWarning?: string
}
```

---

## Output Fields

### Top-level

| Field              | Type                                             | Description                                                                                                                                                                                |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `asOfTimeMs`       | `number`                                         | Epoch start (ms) of the current 15-minute market window. All candles are computed on data strictly before this timestamp.                                                                  |
| `currency`         | `'BTC'`                                          | Always `'BTC'`. The plugin is hardcoded to BTC DVOL.                                                                                                                                       |
| `byResolutionSec`  | `Record<300 \| 900 \| 3600, DvolCandle \| null>` | OHLC candle per resolution. `null` when insufficient base candles exist for that bucket.                                                                                                   |
| `alignmentWarning` | `string \| undefined`                            | Present when one or more resolution buckets are missing or misaligned relative to the expected window boundary. The string is pipe-delimited, e.g. `missing_300s \| misaligned_900s(...)`. |

### `DvolCandle` Fields

| Field       | Type     | Description                                                                                                |
| ----------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `openTime`  | `number` | Bucket open timestamp in milliseconds (UTC).                                                               |
| `closeTime` | `number` | Bucket close timestamp in milliseconds (UTC).                                                              |
| `open`      | `number` | Deribit DVOL index value at the start of the bucket.                                                       |
| `high`      | `number` | Maximum DVOL index value within the bucket.                                                                |
| `low`       | `number` | Minimum DVOL index value within the bucket.                                                                |
| `close`     | `number` | Deribit DVOL index value at the end of the bucket. Typically the most useful field for strategy decisions. |

DVOL values are expressed as annualized implied volatility in percentage points (e.g. `60.0` = 60% annualized IV).

---

## Accessing the Snapshot in a Strategy

```typescript
import type { DeribitVolatilityIndexSnapshot } from '../plugins/DeribitVolatilityIndexPlugin.js'

onMarketTick(tick, portfolio, ctx?): Intent[] {
  const dvol = ctx?.plugins?.['deribitVolatilityIndex'] as
    DeribitVolatilityIndexSnapshot | undefined

  if (!dvol) return []  // not yet available

  const candle5m  = dvol.byResolutionSec[300]
  const candle15m = dvol.byResolutionSec[900]
  const candle1h  = dvol.byResolutionSec[3600]

  // Prefer the most granular available candle
  const primary = candle5m ?? candle15m ?? candle1h
  if (!primary) return []

  const impliedVol = primary.close  // annualized %, e.g. 62.4

  // Example: widen spread in high-IV regimes
  if (impliedVol > 80) return []

  // ...
  return []
}
```

::: details PluginSet registration example

```typescript
import { DeribitVolatilityIndexPlugin } from '../plugins/DeribitVolatilityIndexPlugin.js'

const pluginSet = new PluginSet([
  new DeribitVolatilityIndexPlugin(),
  // Optional: override the API base URL
  // new DeribitVolatilityIndexPlugin({ baseUrl: 'https://www.deribit.com' }),
])
```

The optional `baseUrl` constructor argument defaults to `https://www.deribit.com`.
:::

---

## Caching Behaviour

The plugin computes the snapshot once per market key (slug). Subsequent ticks within the same 15-minute window reuse the cached result without additional network requests. The cache is cleared on market key rotation (i.e., window boundary crossing).

If a fetch is already in flight for the current market key, additional ticks are ignored until it completes. On fetch failure, the snapshot remains `undefined` and an error is logged.

---

## Null Safety

| Condition                                                  | Result                                            |
| ---------------------------------------------------------- | ------------------------------------------------- |
| Plugin not yet computed for the current window             | `snapshot()` returns `undefined`                  |
| A specific resolution bucket lacks sufficient base candles | `byResolutionSec[n]` is `null`                    |
| Slug is not a valid BTC updown-15m slug                    | `snapshot()` returns `undefined` (warning logged) |
| Deribit API request fails                                  | `snapshot()` returns `undefined` (error logged)   |

Strategies should check for `undefined` at the snapshot level and `null` at the per-resolution level before accessing candle fields.
