---
title: Technical Indicators Plugin
description: Reference for the TechnicalIndicatorsPlugin — ATR, ADX, Bollinger Bands, realized volatility, and wick ratios derived from Binance BTCUSDT klines.
---

# Technical Indicators Plugin

**Plugin ID:** `technicalIndicators`  
**Class:** `TechnicalIndicatorsPlugin`  
**Source:** `src/strategy/plugins/TechnicalIndicatorsPlugin.ts`

The Technical Indicators Plugin fetches OHLCV candles for `BTCUSDT` from the Binance REST API and computes a set of price-action and volatility indicators across two timeframes: **1-hour** and **15-minute**. It also derives session and calendar metadata from the market window's epoch timestamp.

The plugin is **compatible with both live trading and backtesting**. In backtests, indicator computation is asynchronous and the snapshot is `undefined` until the first fetch completes. Set `BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS=1` to pause tick processing until the snapshot is available.

---

## Data Source

Candles are fetched from the Binance public klines endpoint:

```
GET https://api.binance.com/api/v3/klines
  ?symbol=BTCUSDT
  &interval=1h|15m
  &endTime=<epochMs>
  &limit=<n>
```

The `endTime` is derived from the Polymarket 15-minute market slug epoch — specifically `epochStartMs - 1` — so all indicators reflect data **strictly before** the current market window opens. No authentication or API key is required.

::: warning
This plugin only supports slugs for the `btc` symbol. If the market slug does not parse as a valid BTC updown-15m window, the snapshot will be `undefined` and a warning is logged.
:::

---

## Computation Periods

| Timeframe | Indicator                  | Period         |
| --------- | -------------------------- | -------------- |
| 1h        | ATR                        | 14             |
| 1h        | ADX                        | 14             |
| 1h        | Bollinger Bands            | 20 (2 std dev) |
| 1h        | Realized volatility (fast) | 20             |
| 1h        | Realized volatility (slow) | 80             |
| 15m       | ATR                        | 14             |
| 15m       | Realized volatility        | 20             |

The plugin fetches a lookback of `2 × max_period + 10` candles per timeframe to ensure statistical stability.

---

## Environment Variables

| Variable                                 | Required | Description                                                                                                                                            |
| ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS` | No       | Set to `1` to hold backtest tick processing until the first snapshot is computed. Without this, ticks may fire while `snapshot()` returns `undefined`. |

::: tip
In live trading, the snapshot is computed asynchronously on the first tick for each 15-minute window. Subsequent ticks within the same window reuse the cached result. The snapshot is cleared when the market key changes (i.e., on window rotation).
:::

---

## Output Type

```typescript
type Session = 'ASIA' | 'EU' | 'US'

type TechnicalIndicatorsSnapshot = {
  asOfTimeMs: number
  symbol: string
  tf1h: {
    atr14Pct: number | null
    bbWidth: number | null
    adx14: number | null
    hlRangePct: number | null
    wickRatio: number | null
    rv20: number | null
    rv80: number | null
    rv20Over80: number | null
  }
  tf15m: {
    hlRangePct: number | null
    wickRatio: number | null
    atr14Pct: number | null
    rv20: number | null
  }
  meta: {
    session: Session
    hourOfDayUTC: number
    dayOfWeekUTC: number
  }
  alignmentWarning?: string
}
```

---

## Output Fields

### Top-level

| Field              | Type                  | Description                                                                                                                                                        |
| ------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `asOfTimeMs`       | `number`              | The epoch start of the 15-minute market window (ms). All indicators are computed on data strictly before this timestamp.                                           |
| `symbol`           | `string`              | Always `'BTCUSDT'`.                                                                                                                                                |
| `alignmentWarning` | `string \| undefined` | Present when the 15-minute candle close timestamp does not align with the expected market window boundary. Treat the snapshot with caution when this field is set. |

### `tf1h` — 1-Hour Timeframe

| Field        | Type             | Description                                                                                                                |
| ------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `atr14Pct`   | `number \| null` | Average True Range (14-period) divided by the last close price. Expressed as a fraction (e.g. `0.012` = 1.2%).             |
| `bbWidth`    | `number \| null` | Bollinger Band width: `(upper - lower) / middle` (20-period, 2 std dev). A wider band indicates higher recent volatility.  |
| `adx14`      | `number \| null` | Average Directional Index (14-period). Values above 25 indicate a trending market; below 20 indicate a ranging market.     |
| `hlRangePct` | `number \| null` | High-minus-low range of the most recent completed candle divided by its low.                                               |
| `wickRatio`  | `number \| null` | `(upperWick + lowerWick) / max(body, ε)` for the most recent candle. High values indicate indecision or reversal pressure. |
| `rv20`       | `number \| null` | 20-period realized volatility: rolling standard deviation of log returns across 20 closes.                                 |
| `rv80`       | `number \| null` | 80-period realized volatility. Represents slower-moving, structural volatility.                                            |
| `rv20Over80` | `number \| null` | Ratio `rv20 / rv80`. Values above 1 indicate elevated short-term volatility relative to the longer-term baseline.          |

### `tf15m` — 15-Minute Timeframe

| Field        | Type             | Description                                                                  |
| ------------ | ---------------- | ---------------------------------------------------------------------------- |
| `hlRangePct` | `number \| null` | High-minus-low range of the most recent 15-minute candle divided by its low. |
| `wickRatio`  | `number \| null` | Same wick-ratio computation as `tf1h`, applied to the 15-minute candle.      |
| `atr14Pct`   | `number \| null` | ATR (14-period) on 15-minute candles, divided by the last close price.       |
| `rv20`       | `number \| null` | 20-period realized volatility on 15-minute closes.                           |

### `meta` — Session and Calendar

| Field          | Type                     | Description                                                                                                           |
| -------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `session`      | `'ASIA' \| 'EU' \| 'US'` | UTC trading session at the market window open. `ASIA`: 00:00–07:59 UTC. `EU`: 08:00–15:59 UTC. `US`: 16:00–23:59 UTC. |
| `hourOfDayUTC` | `number`                 | UTC hour (0–23) of the market window open.                                                                            |
| `dayOfWeekUTC` | `number`                 | UTC day of week (0 = Sunday, 6 = Saturday) of the market window open.                                                 |

---

## Accessing the Snapshot in a Strategy

```typescript
import type { TechnicalIndicatorsSnapshot } from '../plugins/TechnicalIndicatorsPlugin.js'

onMarketTick(ctx, snapshot): Intent[] {
  const ti = ctx.plugins.technicalIndicators?.snapshot() as
    TechnicalIndicatorsSnapshot | undefined

  if (!ti) return []  // not yet computed

  const { adx14, rv20Over80, wickRatio } = ti.tf1h
  const { rv20 } = ti.tf15m
  const { session } = ti.meta

  // Example: skip trading in low-conviction conditions
  if (adx14 !== null && adx14 < 20) return []
  if (session === 'ASIA') return []

  // ...
  return []
}
```

::: details PluginSet registration example

```typescript
import { TechnicalIndicatorsPlugin } from '../plugins/TechnicalIndicatorsPlugin.js'

const pluginSet = new PluginSet([new TechnicalIndicatorsPlugin()])
```

The plugin takes no constructor arguments.
:::

---

## Null Safety

All indicator fields are `number | null`. A field is `null` when:

- Insufficient candles are available for the computation period.
- The candle data contains non-finite or non-positive values.
- The snapshot itself is `undefined` (plugin not yet initialized for the current market window).

Strategies must guard against `null` values before using any indicator in a conditional.

::: danger
Do not assume the snapshot is non-`undefined` on the first tick of a market window. In backtests without `BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS=1`, the first several ticks will observe `undefined`.
:::
