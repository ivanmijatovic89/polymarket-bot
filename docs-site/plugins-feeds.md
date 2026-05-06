# Plugins and External Feeds

## Plugin Model

Plugin framework: `src/strategy/plugins/PluginSet.ts`

- plugins update once per market tick
- strategy receives cached plugin snapshot in `ctx.plugins`
- plugin state resets on market change

## Plugins in This Repo

- `TimeWindowVolatility`
- `TimeWindowGatePlugin`
- `DwellGatePlugin`
- `TechnicalIndicatorsPlugin`
- `DeribitVolatilityIndexPlugin`
- `ExternalFeedsPlugin`
- `ExternalFeedsRequestPlugin`

## External Feeds (live-only)

Feed clients under `src/trading/feeds/*`:

- RTDS crypto prices (`rtdsCryptoPricesClient`)
- Binance WS spot (`binanceWsSpotPriceClient`)
- Polymarket price-to-beat (`polymarketPriceToBeatClient`)
- Deribit volatility index fetcher

Store and snapshot bridge: `src/trading/feeds/externalFeeds.ts`

## Important Constraints

- backtests do not have live feed streams
- strategies must tolerate missing feed snapshots
- if a strategy requires feed startup logic, declare via request plugin or `requiredFeeds`

## Technical Indicator and Volatility Notes

- indicator plugins fetch and cache snapshots keyed by market/slug
- `BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS` can enforce warmup wait in backtests
