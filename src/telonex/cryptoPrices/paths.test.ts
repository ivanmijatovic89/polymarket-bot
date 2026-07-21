import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assetIdForSymbol,
  assetIdFromChainlinkFeedSymbol,
  chainlinkFeedSymbolForMarketSymbol,
  CRYPTO_PRICES_COVERAGE_FROM,
  CRYPTO_PRICES_COVERAGE_FROM_MS,
  cryptoPricesDayFilename,
  cryptoPricesDayPath,
  cryptoPricesDownloadUrl,
  cryptoPricesR2Key,
  cryptoPricesR2Prefix,
  isoDateFromCryptoPricesFilename,
} from './paths.js'

test('assetIdForSymbol maps market symbols and passes asset ids through', () => {
  assert.equal(assetIdForSymbol('btc'), 'btcusd')
  assert.equal(assetIdForSymbol('BTC'), 'btcusd')
  assert.equal(assetIdForSymbol(' eth '), 'ethusd')
  assert.equal(assetIdForSymbol('btcusd'), 'btcusd')
  assert.throws(() => assetIdForSymbol('btc/usd'), /invalid symbol/)
  assert.throws(() => assetIdForSymbol(''), /invalid symbol/)
})

test('chainlink feed symbol conversions round-trip', () => {
  assert.equal(chainlinkFeedSymbolForMarketSymbol('btc'), 'btc/usd')
  assert.equal(assetIdFromChainlinkFeedSymbol('btc/usd'), 'btcusd')
  assert.equal(assetIdFromChainlinkFeedSymbol('BTC/USD'), 'btcusd')
  assert.equal(assetIdFromChainlinkFeedSymbol('btcusd'), null)
  assert.equal(assetIdFromChainlinkFeedSymbol('btc/eur'), null)
  assert.throws(() => chainlinkFeedSymbolForMarketSymbol('btc/usd'), /invalid symbol/)
})

test('day filename builds and parses round-trip; foreign names rejected', () => {
  const name = cryptoPricesDayFilename('btcusd', '2026-04-02')
  assert.equal(name, 'btcusd-crypto-prices-2026-04-02.parquet')
  assert.equal(isoDateFromCryptoPricesFilename(name, 'btcusd'), '2026-04-02')
  // R2 keys parse too (basename anchoring)
  assert.equal(
    isoDateFromCryptoPricesFilename(cryptoPricesR2Key('btcusd', '2026-04-02'), 'btcusd'),
    '2026-04-02',
  )
  // Foreign / non-canonical names must never parse
  assert.equal(isoDateFromCryptoPricesFilename(name, 'ethusd'), null)
  assert.equal(
    isoDateFromCryptoPricesFilename('btcusd-crypto-prices-2026-04-02.parquet.bak', 'btcusd'),
    null,
  )
  assert.equal(
    isoDateFromCryptoPricesFilename('xbtcusd-crypto-prices-2026-04-02.parquet', 'btcusd'),
    null,
  )
  assert.equal(
    isoDateFromCryptoPricesFilename('btcusd-crypto-prices-2026-4-2.parquet', 'btcusd'),
    null,
  )
})

test('R2 key layout mirrors the local layout under the telonex/crypto_prices prefix', () => {
  assert.equal(cryptoPricesR2Prefix('btcusd'), 'telonex/crypto_prices/btcusd/')
  assert.equal(
    cryptoPricesR2Key('btcusd', '2026-05-01'),
    'telonex/crypto_prices/btcusd/btcusd-crypto-prices-2026-05-01.parquet',
  )
  assert.ok(
    cryptoPricesDayPath('btcusd', '2026-05-01').endsWith(
      'btcusd/btcusd-crypto-prices-2026-05-01.parquet',
    ),
  )
})

test('download URL targets the crypto_prices channel with the asset id', () => {
  assert.equal(
    cryptoPricesDownloadUrl('btcusd', '2026-04-02'),
    'https://api.telonex.io/v1/downloads/polymarket/crypto_prices/2026-04-02?asset_id=btcusd',
  )
})

test('coverage floor constants agree', () => {
  assert.equal(CRYPTO_PRICES_COVERAGE_FROM, '2026-04-02')
  assert.equal(CRYPTO_PRICES_COVERAGE_FROM_MS, Date.parse('2026-04-02T00:00:00Z'))
})
