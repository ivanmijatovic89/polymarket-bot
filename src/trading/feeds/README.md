# Trading external feeds (`ctx.plugins.externalFeeds`)

This folder contains **live-only external data feeds** that can be consumed by strategies via `ctx.plugins.externalFeeds`.

External feeds are **not available in backtests** (unless you explicitly record/replay them later).

## Docs

- Binance Spot **WebSocket Streams**: [WebSocket Streams for Binance](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams)
- Polymarket **RTDS crypto prices**: [RTDS Crypto Prices](https://docs.polymarket.com/developers/RTDS/RTDS-crypto-prices)

## How it works

- A strategy declares which feeds it needs via `strategy.requiredFeeds` (see [`src/strategy/Strategy.ts`](../../strategy/Strategy.ts)).
- `src/cli/trading-bot.ts` reads `requiredFeeds` and **only starts the requested feed clients**.
- Feed clients update an in-memory store (`createExternalFeedsStore()`).
- `src/cli/trading-bot.ts` registers an `ExternalFeedsPlugin` into the runner’s `PluginSet`.
- `StrategyRunner` snapshots plugins once per market tick and strategies read `ctx.plugins.externalFeeds`.

## Current feed snapshot shape

Defined in [`externalFeeds.ts`](externalFeeds.ts) (this exact object is exposed under `ctx.plugins.externalFeeds`):

- `ctx.plugins.externalFeeds.rtdsPolymarketCryptoPrices`
  - `binance`: price point from Polymarket RTDS “Binance source”
  - `chainlink`: price point from Polymarket RTDS “Chainlink source”
- `ctx.plugins.externalFeeds.binanceWsSpotPrice`
  - “Direct Binance” spot price derived from the Binance Spot WebSocket `aggTrade` stream (last trade price)

Each price point has:
- `symbol`: stream symbol (lowercase)
- `tsMs`: exchange/event timestamp in ms (source-dependent)
- `value`: numeric price
- `receivedAtMs`: local `Date.now()` when we ingested it

## Available feed clients

### Polymarket RTDS crypto prices

- **Client**: [`rtdsCryptoPricesClient.ts`](rtdsCryptoPricesClient.ts)
- **Enable**: in a strategy, set:
  - `requiredFeeds.rtdsCryptoPrices.binanceSymbols` (e.g. `["btcusdt"]`)
  - `requiredFeeds.rtdsCryptoPrices.chainlinkSymbols` (e.g. `["btc/usd"]`)

Notes:
- Symbols are treated as explicit allow-lists. If you pass an empty list, that side will produce no updates.

### Binance Spot WebSocket `aggTrade` (direct Binance)

- **Client**: [`binanceWsSpotPriceClient.ts`](binanceWsSpotPriceClient.ts)
- **Enable**: in a strategy, set:
  - `requiredFeeds.binanceWsSpotPrice.symbol = "btcusdt"`

Notes:
- Uses `aggTrade` and treats `p` as last trade price and `T` as trade timestamp.
- All Binance stream symbols are lowercase.

## Example strategy

See [`src/strategies/readExternalFeedsExample.v1.ts`](../../strategies/readExternalFeedsExample.v1.ts) for:
- enabling RTDS + Binance WS feeds
- reading `ctx.plugins.externalFeeds.*`
- printing a simple diff (`binanceWsSpotPrice - rtdsBinance`)


