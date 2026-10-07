import assert from 'node:assert/strict'
import test from 'node:test'
import { parseStrategyArgs } from '../strategy/strategyDefinition.js'
import { externalFeedsRequest } from '../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { ConfigSchema, createStrategy } from './readExternalFeedsExample.v1.js'

test('feed observer preserves the historical default request', () => {
  const config = ConfigSchema.parse({})
  assert.equal(config.binanceBookTicker, false)
  assert.equal(config.chainlinkTwap, false)
  assert.deepEqual(externalFeedsRequest(createStrategy(config)), {
    rtdsCryptoPrices: {},
    binanceWsSpotPrice: {},
    polymarketPriceToBeat: { enabled: true, source: 'website' },
  })
})

test('CLI opt-in requests all V4 feeds without legacy RTDS Binance', () => {
  const parsed = parseStrategyArgs([
    '--strategy',
    'readExternalFeedsExample.v1',
    '--param',
    'priceToBeatSource=chainlink-opening-twap',
    '--param',
    'binanceBookTicker=true',
    '--param',
    'chainlinkTwap=true',
  ])
  const config = ConfigSchema.parse(parsed.rawParams)
  assert.deepEqual(externalFeedsRequest(createStrategy(config)), {
    rtdsCryptoPrices: { binanceSymbols: [] },
    binanceWsSpotPrice: {},
    polymarketPriceToBeat: { enabled: true, source: 'chainlink-opening-twap' },
    binanceBookTicker: {},
    chainlinkTwap: { windowSeconds: 60 },
  })
  assert.equal(ConfigSchema.parse(config).chainlinkTwap, true)
})

test('feed flags parse false literally and reject invalid/unknown parameters', () => {
  const config = ConfigSchema.parse({ binanceBookTicker: 'false', chainlinkTwap: 'false' })
  assert.equal(config.binanceBookTicker, false)
  assert.equal(config.chainlinkTwap, false)
  assert.throws(() => ConfigSchema.parse({ chainlinkTwap: 'yes' }))
  assert.throws(() => ConfigSchema.parse({ chainlinkTwap: 1 }))
  assert.throws(() => ConfigSchema.parse({ undeclaredFeed: true }))
})
