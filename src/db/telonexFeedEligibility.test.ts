import assert from 'node:assert/strict'
import test from 'node:test'
import { and } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { getInMemoryDuckDb } from '../utils/duckdb.js'
import { telonexMarkets, telonexMarketConversions } from './schema.js'
import { buildTelonexEligibilityConditions } from './telonexEligibility.js'
import { requireTelonexSelectionSize } from './telonexMarkets.js'
import {
  externalFeedsRequest,
  ExternalFeedsRequestPlugin,
  type ExternalFeedsRequestConfig,
} from '../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { PluginSet } from '../strategy/plugins/PluginSet.js'

const columns = { markets: telonexMarkets, conversions: telonexMarketConversions }
const base = {
  converter: 'delta-typed',
  readFrom: 'r2' as const,
  symbol: 'btc',
  timeframe: '15m',
  fromMs: 0,
  toMs: 5000,
}

function where(requiredFeeds: ExternalFeedsRequestConfig = {}) {
  return new MySqlDialect().sqlToQuery(
    and(...buildTelonexEligibilityConditions(columns, { ...base, requiredFeeds }))!,
  )
}

test('effective pluginSet wins over plugins, including an empty set', () => {
  const binance = new ExternalFeedsRequestPlugin({ binanceWsSpotPrice: { tickOnUpdate: false } })
  const chainlink = new ExternalFeedsRequestPlugin({ rtdsCryptoPrices: {} })
  const pluginSet = new PluginSet()
  pluginSet.register(chainlink)
  assert.deepEqual(externalFeedsRequest({}), {})
  assert.deepEqual(externalFeedsRequest({ plugins: [new ExternalFeedsRequestPlugin({})] }), {})
  assert.equal(externalFeedsRequest({ plugins: [binance] }), binance.config)
  assert.equal(externalFeedsRequest({ plugins: [binance], pluginSet }), chainlink.config)
  assert.deepEqual(externalFeedsRequest({ plugins: [binance], pluginSet: new PluginSet() }), {})
})

test('feed filtering precedes arbitrary limits; unrequested and unverified feeds stay distinct', async () => {
  const conn = await (await getInMemoryDuckDb()).connect()
  try {
    await conn.run(`CREATE TEMP TABLE telonex_markets AS SELECT i AS id, 'market-' || i AS slug,
      'btc' AS symbol, '15m' AS timeframe, i AS market_start_ms, 'resolved' AS telonex_status,
      'UP' AS result_id,
      CASE WHEN i % 13 = 0 THEN NULL ELSE i % 5 != 0 END AS binance_usable,
      CASE WHEN i % 17 = 0 THEN NULL ELSE i % 7 != 0 END AS chainlink_usable,
      CASE WHEN i % 11 = 0 THEN NULL ELSE 100 END AS price_to_beat
      FROM range(1, 4001) t(i)`)
    await conn.run(`CREATE TEMP TABLE telonex_market_conversions AS SELECT id AS market_id,
      'delta-typed' AS converter, 'done' AS status, '/local/file' AS local_path, 'r2://file' AS r2_url
      FROM telonex_markets`)
    const all = Array.from({ length: 4000 }, (_, i) => i + 1)
    const binance = (i: number) => i % 13 !== 0 && i % 5 !== 0
    const chainlink = (i: number) => i % 17 !== 0 && i % 7 !== 0
    const ptb = (i: number) => i % 11 !== 0
    const cases: Array<[ExternalFeedsRequestConfig, (i: number) => boolean]> = [
      [{}, () => true],
      [{ polymarketPriceToBeat: {} }, () => true],
      [{ polymarketPriceToBeat: { enabled: false } }, () => true],
      [{ binanceWsSpotPrice: { tickOnUpdate: false } }, binance],
      [{ rtdsCryptoPrices: { tickOnUpdate: false } }, chainlink],
      [{ polymarketPriceToBeat: { enabled: true } }, ptb],
      [{ binanceWsSpotPrice: {}, rtdsCryptoPrices: {} }, (i) => binance(i) && chainlink(i)],
      [
        { binanceWsSpotPrice: {}, rtdsCryptoPrices: {}, polymarketPriceToBeat: { enabled: true } },
        (i) => binance(i) && chainlink(i) && ptb(i),
      ],
      // Existing replay semantics: any RTDS request loads Chainlink; it does not substitute WS Binance.
      [{ rtdsCryptoPrices: { binanceSymbols: ['btcusdt'] } }, chainlink],
    ]
    for (const [request, predicate] of cases) {
      const query = where(request)
      // Execute the real shared SQL predicate against isolated fixture tables.
      const condition = query.sql.replaceAll('`', '"')
      const params = query.params.map((value) =>
        typeof value === 'boolean' ? Number(value) : (value as string | number),
      )
      const prefix = `SELECT id FROM telonex_markets JOIN telonex_market_conversions ON market_id = id WHERE ${condition}`
      const eligible = all.filter(predicate)
      for (const limit of [100, 500, 1000]) {
        const result = await conn.run(`${prefix} ORDER BY market_start_ms LIMIT ${limit}`, params)
        assert.deepEqual(
          result
            .getChunk(0)
            .getRows()
            .map((r) => Number(r[0])),
          eligible.slice(0, limit),
        )
      }
      const latest = await conn.run(`${prefix} ORDER BY market_start_ms DESC LIMIT 100`, params)
      assert.deepEqual(
        latest
          .getChunk(0)
          .getRows()
          .map((r) => Number(r[0])),
        eligible.slice(-100).reverse(),
      )
      const random = await conn.run(`${prefix} ORDER BY random() LIMIT 100`, params)
      assert.equal(random.getChunk(0).getRows().length, 100)
      assert.ok(
        random
          .getChunk(0)
          .getRows()
          .every((r) => predicate(Number(r[0]))),
      )
    }
  } finally {
    conn.closeSync()
  }
})

test('matching explicit symbols are accepted; cross-asset flags are never silently reused', () => {
  assert.doesNotThrow(() =>
    where({
      binanceWsSpotPrice: { symbol: ' BTCUSDT ' },
      rtdsCryptoPrices: { chainlinkSymbols: [' BTC/USD ', 'eth/usd'] },
    }),
  )
  assert.throws(() => where({ binanceWsSpotPrice: { symbol: 'ethusdt' } }), /Cross-asset/)
  assert.throws(() => where({ rtdsCryptoPrices: { chainlinkSymbols: ['eth/usd'] } }), /Cross-asset/)
  assert.doesNotThrow(() =>
    buildTelonexEligibilityConditions(columns, {
      converter: 'delta-typed',
      readFrom: 'r2',
      fromMs: 0,
      slugs: ['btc-updown-15m-1780272000'],
      requiredFeeds: { binanceWsSpotPrice: { symbol: 'btcusdt' } },
    }),
  )
})

test('an insufficient selection cannot silently start a smaller limited run', () => {
  requireTelonexSelectionSize(undefined, 12)
  requireTelonexSelectionSize(100, 100)
  assert.throws(() => requireTelonexSelectionSize(100, 85), /only 85.*shortfall 15/)
})
