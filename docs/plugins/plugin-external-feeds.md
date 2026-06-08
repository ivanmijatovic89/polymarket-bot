---
title: External Feeds Plugin
description: Reference for the ExternalFeedsPlugin and ExternalFeedsRequestPlugin — live price and volatility data from RTDS, Binance WebSocket, Polymarket, and Deribit, exposed to strategies via ctx.plugins.externalFeeds.
---

# External Feeds Plugin

**Plugin ID:** `externalFeeds`  
**Classes:** `ExternalFeedsPlugin`, `ExternalFeedsRequestPlugin`  
**Source:** `src/strategy/plugins/ExternalFeedsPlugin.ts`, `src/strategy/plugins/ExternalFeedsRequestPlugin.ts`, `src/trading/feeds/externalFeeds.ts`

The External Feeds Plugin makes live market data from external sources available to strategies via `ctx.plugins.externalFeeds`. It aggregates price and volatility data from four independent feed clients into a single `ExternalFeedsSnapshot` object, refreshed out-of-band and snapshotted once per tick.

::: danger Live trading only
External feeds are only active during live trading. In backtests, `ctx.plugins.externalFeeds` is absent (`undefined`). Strategies must guard against this; see [Backtest Safety](#backtest-safety) below.
:::

---

## Opt-in via `requiredFeeds`

A strategy declares which external feeds it needs by setting `requiredFeeds` on the strategy object. The trading bot reads this property at startup and instantiates only the requested feed clients.

```typescript
// Example: inside a strategy's create() factory
export const definition = {
  id: 'my-strategy',
  schema: z.object({
    /* ... */
  }),
  create(params) {
    const strategy: Strategy = {
      requiredFeeds: {
        rtdsCryptoPrices: {
          binanceSymbols: ['BTCUSDT'],
        },
        binanceWsSpotPrice: {
          symbol: 'BTCUSDT',
        },
        polymarketPriceToBeat: {
          enabled: true,
        },
        deribitVolatilityIndex: true,
      },
      onMarketTick(ctx, snapshot) {
        /* ... */
      },
      onAccountEvent(ctx, event) {
        /* ... */
      },
    }
    return { strategy }
  },
}
```

Only the declared feeds are started. Feeds not listed in `requiredFeeds` remain inactive and absent from the snapshot.

---

## `ExternalFeedsRequestPlugin`

`ExternalFeedsRequestPlugin` is the declarative, side-effect-free counterpart used in `PluginSet` configuration. It carries the feed request configuration and is fulfilled by the live runtime, which injects the actual snapshot provider.

```typescript
import { ExternalFeedsRequestPlugin } from '../plugins/ExternalFeedsRequestPlugin.js'

// Inside create():
const feedsPlugin = new ExternalFeedsRequestPlugin({
  rtdsCryptoPrices: {
    binanceSymbols: ['BTCUSDT'],
  },
  binanceWsSpotPrice: {
    symbol: 'BTCUSDT',
  },
})
```

The `ExternalFeedsRequestPlugin` and `ExternalFeedsPlugin` share the plugin ID `externalFeeds`. The live runtime replaces the request plugin with the fulfilled `ExternalFeedsPlugin` before strategy ticks begin.

### `ExternalFeedsRequestConfig`

| Field                   | Type                                                         | Description                                                                        |
| ----------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `rtdsCryptoPrices`      | `{ binanceSymbols?: string[]; chainlinkSymbols?: string[] }` | Request RTDS price data for specified symbols via Binance and/or Chainlink feeds.  |
| `binanceWsSpotPrice`    | `{ symbol?: string }`                                        | Request the Binance WebSocket spot price for a specific symbol (e.g. `'BTCUSDT'`). |
| `polymarketPriceToBeat` | `{ enabled?: boolean }`                                      | Request the Polymarket "price to beat" for the current market's symbol.            |

---

## Output Type

```typescript
type RtdsPricePoint = {
  symbol: string
  tsMs: number
  value: number
  receivedAtMs: number
}

type ExternalFeedsSnapshot = {
  rtdsPolymarketCryptoPrices?: {
    binance?: RtdsPricePoint
    chainlink?: RtdsPricePoint
  }
  binanceWsSpotPrice?: RtdsPricePoint
  polymarketPriceToBeat?: {
    symbol: string
    eventStartTimeIso: string
    endDateIso: string
    openPrice: number
    apiTimestampMs?: number
    receivedAtMs: number
  }
}
```

::: tip Deribit Volatility Index feed
The `deribitVolatilityIndex` feed referenced in `requiredFeeds` is exposed through the dedicated [`DeribitVolatilityIndexPlugin`](/plugins/plugin-deribit-volatility) (`ctx.plugins.deribitVolatilityIndex`), not through `ctx.plugins.externalFeeds`. It follows its own snapshot type.
:::

---

## Available Feeds

### `rtdsPolymarketCryptoPrices`

Polymarket RTDS (Real-Time Data Service) prices for BTC and other crypto assets via two sub-feeds: Binance and Chainlink. Each sub-feed provides an `RtdsPricePoint`.

| Sub-feed           | Key                                    | Source              |
| ------------------ | -------------------------------------- | ------------------- |
| Binance via RTDS   | `rtdsPolymarketCryptoPrices.binance`   | RTDS Binance feed   |
| Chainlink via RTDS | `rtdsPolymarketCryptoPrices.chainlink` | RTDS Chainlink feed |

#### `RtdsPricePoint` fields

| Field          | Type     | Description                                                                                           |
| -------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `symbol`       | `string` | Asset symbol (e.g. `'BTCUSDT'`).                                                                      |
| `tsMs`         | `number` | Timestamp of the price reading in milliseconds (from the data source).                                |
| `value`        | `number` | Price value.                                                                                          |
| `receivedAtMs` | `number` | `Date.now()` at the moment the update was received by the bot process. Used to detect data staleness. |

---

### `binanceWsSpotPrice`

The Binance WebSocket spot price for a configured symbol. Updated continuously via the Binance WebSocket stream, independent of RTDS.

Type: `RtdsPricePoint | undefined` (same type as above).

| Field          | Type     | Description                                                              |
| -------------- | -------- | ------------------------------------------------------------------------ |
| `symbol`       | `string` | Asset symbol as configured in `requiredFeeds.binanceWsSpotPrice.symbol`. |
| `tsMs`         | `number` | Timestamp from the Binance stream event in milliseconds.                 |
| `value`        | `number` | Spot price.                                                              |
| `receivedAtMs` | `number` | `Date.now()` at receipt.                                                 |

---

### `polymarketPriceToBeat`

The reference open price for the current Polymarket event, fetched from the Gamma API. This represents the price the market must beat (either up or down) to resolve as "Yes".

Type: `object | undefined`.

| Field               | Type                  | Description                                                                       |
| ------------------- | --------------------- | --------------------------------------------------------------------------------- |
| `symbol`            | `string`              | Asset symbol for this event.                                                      |
| `eventStartTimeIso` | `string`              | ISO 8601 timestamp of the event start.                                            |
| `endDateIso`        | `string`              | ISO 8601 timestamp of the event end/resolution.                                   |
| `openPrice`         | `number`              | The reference open price. Strategies compare live price feeds against this value. |
| `apiTimestampMs`    | `number \| undefined` | Timestamp (ms) from the Gamma API response, if available.                         |
| `receivedAtMs`      | `number`              | `Date.now()` at receipt.                                                          |

---

## Accessing the Snapshot in a Strategy

```typescript
import type { ExternalFeedsSnapshot } from '../../trading/feeds/externalFeeds.js'

onMarketTick(ctx, snapshot): Intent[] {
  const feeds = ctx.plugins.externalFeeds?.snapshot() as
    ExternalFeedsSnapshot | undefined

  if (!feeds) return []  // absent in backtests or if feed not started

  // RTDS Binance price
  const rtdsBinance = feeds.rtdsPolymarketCryptoPrices?.binance
  if (rtdsBinance) {
    const staleMs = Date.now() - rtdsBinance.receivedAtMs
    if (staleMs > 30_000) return []  // reject stale data
    const price = rtdsBinance.value
    // ...
  }

  // Direct Binance WS spot price
  const spot = feeds.binanceWsSpotPrice
  if (spot) {
    const spotPrice = spot.value
    // ...
  }

  // Price to beat
  const ptb = feeds.polymarketPriceToBeat
  if (ptb) {
    const openPrice = ptb.openPrice
    // ...
  }

  return []
}
```

---

## Backtest Safety

In backtests, `ctx.plugins.externalFeeds` is `undefined` because no feed clients are started. Strategies must handle this defensively:

```typescript
onMarketTick(ctx, snapshot): Intent[] {
  const feeds = ctx.plugins.externalFeeds?.snapshot() as
    ExternalFeedsSnapshot | undefined

  // Proceed with or without feeds — do not hard-require them
  const spot = feeds?.binanceWsSpotPrice
  const price = spot?.value ?? snapshot.byAssetId[ctx.market.upAssetId]?.mid

  if (price == null) return []
  // ...
}
```

::: warning
Strategies that unconditionally require external feeds will produce no intents during backtests. Design strategies to fall back gracefully, or document clearly that they are live-only.
:::

---

## Staleness Handling

All `RtdsPricePoint` values include a `receivedAtMs` field. Because feeds are updated asynchronously and the snapshot is captured once per tick, data may be seconds or minutes old if a feed client experiences connectivity issues.

Strategies should validate `receivedAtMs` relative to `Date.now()` (or in backtests, `tick.snapshot.timestamp`) before acting on feed data:

```typescript
const MAX_STALE_MS = 30_000

const binancePrice = feeds?.rtdsPolymarketCryptoPrices?.binance
if (!binancePrice || Date.now() - binancePrice.receivedAtMs > MAX_STALE_MS) {
  // Data too stale — skip this tick
  return []
}
```

---

## Store Architecture

The `ExternalFeedsStore` (defined in `src/trading/feeds/externalFeeds.ts`) is the in-process state container. It is populated by individual feed client callbacks and read by `ExternalFeedsPlugin.snapshot()` on each tick. The store exposes the following update methods (used internally by feed clients):

| Method                           | Description                                        |
| -------------------------------- | -------------------------------------------------- |
| `updateBinance(u)`               | Update RTDS Binance price.                         |
| `updateChainlink(u)`             | Update RTDS Chainlink price.                       |
| `updateBinanceWsSpotPrice(u)`    | Update Binance WebSocket spot price.               |
| `updatePolymarketPriceToBeat(u)` | Update Polymarket price-to-beat.                   |
| `clearPolymarketPriceToBeat()`   | Clear the price-to-beat (e.g. on window rotation). |
| `reset()`                        | Clear all feed data.                               |

Strategies do not interact with the store directly; they access data only through `ctx.plugins.externalFeeds.snapshot()`.
