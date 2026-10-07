---
title: External Feeds Plugin
description: Reference for the ExternalFeedsPlugin and ExternalFeedsRequestPlugin — live price data from RTDS, Binance WebSocket, and Polymarket, exposed to strategies via ctx.plugins.externalFeeds.
---

# External Feeds Plugin

**Plugin ID:** `externalFeeds`  
**Classes:** `ExternalFeedsPlugin`, `ExternalFeedsRequestPlugin`  
**Source:** `src/strategy/plugins/ExternalFeedsPlugin.ts`, `src/strategy/plugins/ExternalFeedsRequestPlugin.ts`, `src/trading/feeds/externalFeeds.ts`

The External Feeds Plugin exposes external market data to strategies through `ctx.plugins.externalFeeds`. Supported live runtimes populate it from feed clients; backtests populate it from their configured historical or recorded data. Snapshots are bound to individual strategy ticks.

::: warning Runtime support and missing observations
V4 live ingestion and Recorder v4 replay share receipt ordering and snapshot processing for Binance aggregate trades, best bid/ask, Chainlink spot/TWAP, and reference prices in receipt order. Historical input modes have different available sources. Unsupported new capabilities fail explicitly. Any individual observation can be absent before its first receipt or during a gap; strategies must handle that absence.
:::

---

## Legacy opt-in via `requiredFeeds`

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
      },
      onMarketTick(tick, portfolio, ctx?) {
        /* ... */
        return []
      },
      onAccountEvent(event, portfolio, lastMarket?, ctx?) {
        /* ... */
        return []
      },
    }
    return { strategy }
  },
}
```

Only the declared feeds are started. Feeds not listed in `requiredFeeds` remain inactive and absent from the snapshot.

Use `ExternalFeedsRequestPlugin` for Recorder v4 source selection, TWAP, and best bid/ask. These capabilities are not added to the legacy `requiredFeeds` interface.

---

## `ExternalFeedsRequestPlugin`

`ExternalFeedsRequestPlugin` is the declarative, side-effect-free counterpart used in `PluginSet` configuration. It carries the feed request configuration and is fulfilled by the selected runtime with a snapshot provider.

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

The `ExternalFeedsRequestPlugin` and `ExternalFeedsPlugin` share the plugin ID `externalFeeds`. Strategies read the same context field after the runtime supplies the requested snapshots.

### `ExternalFeedsRequestConfig`

| Field                   | Type                                                                    | Description                                                                                        |
| ----------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `rtdsCryptoPrices`      | `{ binanceSymbols?: string[]; chainlinkSymbols?: string[] }`            | Request RTDS price data for specified symbols via Binance and/or Chainlink feeds.                  |
| `binanceWsSpotPrice`    | `{ symbol?: string }`                                                   | Request the Binance WebSocket spot price for a specific symbol (e.g. `'BTCUSDT'`).                 |
| `polymarketPriceToBeat` | `{ enabled?: boolean; source?: 'website' \| 'chainlink-opening-twap' }` | Website is the unchanged default. Opening TWAP requires V4 live/replay and exact opening evidence. |
| `binanceBookTicker`     | `{ symbol?: string }`                                                   | BTCUSDT best bid/ask; V4 live/replay.                                                              |
| `chainlinkTwap`         | `{ symbol?: string; windowSeconds?: number }`                           | BTC/USD TWAP; V4 live/replay.                                                                      |

`binanceWsSpotPrice` and `rtdsCryptoPrices` also accept `tickOnUpdate` for supported synthetic feed ticks. See [synthetic feed ticks](/datasets/price-feeds/synthetic-ticks). V4 live/replay supplies the Chainlink subfeed under the existing `rtdsPolymarketCryptoPrices.chainlink` key using captured PolyBolt observations; it does not contain the RTDS Binance subfeed.

For `source: 'chainlink-opening-twap'`, `polymarketPriceToBeat` contains the selected exact opening observation, `websitePriceToBeat` retains the independent website observation, and `openingReference` exposes provenance/comparison diagnostics. The full decimal string is retained. Later website corrections never overwrite the selected TWAP. Missing or conflicting boundary evidence rejects ordinary backtests; explicit outage replay preserves its actual availability. See [opening reference configuration](/datasets/recording/recorder-v4#selecting-the-opening-chainlink-twap) for the contract and CLI example.

---

## Common Output Fields

The following excerpt shows the original common fields. The complete `ExternalFeedsSnapshot` type in `src/trading/feeds/externalFeeds.ts` also defines captured best bid/ask, TWAP, opening-reference diagnostics, and optional PTB source/provenance.

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
Deribit implied-volatility data is not part of `requiredFeeds` or `ctx.plugins.externalFeeds`. It is provided by the dedicated [`DeribitVolatilityIndexPlugin`](/plugins/plugin-deribit-volatility) (`ctx.plugins.deribitVolatilityIndex`), which follows its own snapshot type.
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

The selected reference open price for the current Polymarket event. Recorder v4 defaults to captured website responses and can explicitly select the exact opening Chainlink TWAP. Legacy historical replay retains its existing Gamma-backed behavior; legacy live trading uses its website price client. An omitted snapshot `source` field retains legacy semantics. Selective source support is documented above; selecting the new source in an unsupported runtime fails rather than falling back.

Type: `object | undefined`.

| Field               | Type                  | Description                                                                       |
| ------------------- | --------------------- | --------------------------------------------------------------------------------- |
| `symbol`            | `string`              | Asset symbol for this event.                                                      |
| `eventStartTimeIso` | `string`              | ISO 8601 timestamp of the event start.                                            |
| `endDateIso`        | `string`              | ISO 8601 timestamp of the event end/resolution.                                   |
| `openPrice`         | `number`              | The reference open price. Strategies compare live price feeds against this value. |
| `apiTimestampMs`    | `number \| undefined` | Timestamp (ms) from the source API response, if available.                        |
| `receivedAtMs`      | `number`              | `Date.now()` at receipt.                                                          |

---

## Accessing the Snapshot in a Strategy

```typescript
import type { ExternalFeedsSnapshot } from '../../trading/feeds/externalFeeds.js'

onMarketTick(tick, portfolio, ctx?): Intent[] {
  const feeds = ctx?.plugins?.['externalFeeds'] as
    ExternalFeedsSnapshot | undefined

  if (!feeds) return []  // no snapshot provider or no available observations

  // RTDS Binance price
  const rtdsBinance = feeds.rtdsPolymarketCryptoPrices?.binance
  if (rtdsBinance) {
    const nowMs = tick.source.tsLocalMs ??
      (tick.source.kind === 'live' ? Date.now() : tick.snapshot.timestamp)
    const staleMs = nowMs - rtdsBinance.receivedAtMs
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

Backtests use captured or historical providers without starting live feed clients. Before the first recorded receipt, or when a source is unavailable, a requested value may be absent. Strategies must define the same missing-data behavior in live execution and replay:

```typescript
onMarketTick(tick, portfolio, ctx?): Intent[] {
  const feeds = ctx?.plugins?.['externalFeeds'] as
    ExternalFeedsSnapshot | undefined

  // An explicit strategy policy: use the feed when available, otherwise the market mid.
  const spot = feeds?.binanceWsSpotPrice
  const upAssetId = ctx?.market?.upAssetId
  const price =
    spot?.value ?? (upAssetId ? tick.snapshot.byAssetId[upAssetId]?.mid : undefined)

  if (price == null) return []
  // ...
}
```

::: warning
If a strategy requires a reference to make a valid decision, skip that tick when it is absent. Do not substitute another source unless that fallback is an explicit part of the strategy in both live execution and replay.
:::

---

## Staleness Handling

All `RtdsPricePoint` values include a `receivedAtMs` field. Because feeds are updated asynchronously and the snapshot is captured once per tick, data may be seconds or minutes old if a feed client experiences connectivity issues.

Strategies should use the runtime clock for current-price freshness: recorded local receipt time during V4 live ingestion and replay, and the wall clock during legacy live processing. Older Parquet inputs without receipt time fall back to the market snapshot timestamp. An opening PTB is a fixed boundary reference, so applying a rolling-price staleness limit to it would usually be inappropriate:

```typescript
const MAX_STALE_MS = 30_000
const nowMs =
  tick.source.tsLocalMs ?? (tick.source.kind === 'live' ? Date.now() : tick.snapshot.timestamp)

const binancePrice = feeds?.rtdsPolymarketCryptoPrices?.binance
if (!binancePrice || nowMs - binancePrice.receivedAtMs > MAX_STALE_MS) {
  // Data too stale — skip this tick
  return []
}
```

---

## Store Architecture

V4 live/replay uses `CapturedMarketDispatcher` to serialize observations and bind
each feed snapshot to its tick. Live mode keeps a bounded in-memory queue and
reuses the recorder transport adapters. See [live feed configuration](/live-trading/live-trading-bot#v4-receipt-ordered-live-feeds).

The legacy runtime uses `ExternalFeedsStore` (defined in `src/trading/feeds/externalFeeds.ts`) as its in-process state container. It is populated by individual feed client callbacks and read by `ExternalFeedsPlugin.snapshot()` on each tick. The store exposes the following update methods (used internally by feed clients):

| Method                           | Description                                        |
| -------------------------------- | -------------------------------------------------- |
| `updateBinance(u)`               | Update RTDS Binance price.                         |
| `updateChainlink(u)`             | Update RTDS Chainlink price.                       |
| `updateBinanceWsSpotPrice(u)`    | Update Binance WebSocket spot price.               |
| `updatePolymarketPriceToBeat(u)` | Update Polymarket price-to-beat.                   |
| `clearPolymarketPriceToBeat()`   | Clear the price-to-beat (e.g. on window rotation). |
| `reset()`                        | Clear all feed data.                               |

Strategies do not interact with the store directly; they access data only through `ctx.plugins.externalFeeds` (the per-tick snapshot already resolved by the plugin runtime).
