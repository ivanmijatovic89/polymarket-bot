import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getInMemoryDuckDb, sqlQuote } from '../../utils/duckdb.js'
import {
  CRYPTO_PRICES_COVERAGE_FROM_MS,
  cryptoPricesDayPath,
} from '../../telonex/cryptoPrices/paths.js'
import { loadChainlinkCryptoPricesSeries } from './chainlinkCryptoPricesSource.js'

/**
 * Fixture-backed loader tests: a private TELONEX_CRYPTO_PRICES_BASE_DIR per
 * run, with synthetic day parquet written through DuckDB (same engine that
 * reads them). Day 2026-04-10 carries 4 rounds; the second broadcast arrives
 * OUT of round order to prove the loader sorts by broadcast time.
 */
const DAY = '2026-04-10'
const DAY0 = Date.parse(`${DAY}T00:00:00Z`)

async function writeFixtureDay(assetId: string, isoDate: string, rowsSql: string): Promise<void> {
  const p = cryptoPricesDayPath(assetId, isoDate)
  await fs.mkdir(path.dirname(p), { recursive: true })
  const db = await getInMemoryDuckDb()
  const conn = await db.connect()
  try {
    await conn.run(`COPY (${rowsSql}) TO ${sqlQuote(p)} (FORMAT PARQUET)`)
  } finally {
    conn.closeSync()
  }
}

let baseDir = ''

test.before(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crypto-prices-test-'))
  process.env.TELONEX_CRYPTO_PRICES_BASE_DIR = baseDir
  // Rounds at +10s, +11s, +12s, +13s after midnight. The +11s round is
  // broadcast LAST (out of order); prices are 18-decimal strings.
  const us = (ms: number): string => String((DAY0 + ms) * 1000)
  await writeFixtureDay(
    'btcusd',
    DAY,
    `SELECT * FROM (VALUES
       (${us(10_000)}::BIGINT, ${us(11_000)}::BIGINT, 'polymarket', 'btcusd', 'btc/usd', 'chainlink', '85124.96061942543'),
       (${us(12_000)}::BIGINT, ${us(13_000)}::BIGINT, 'polymarket', 'btcusd', 'btc/usd', 'chainlink', '85130.1'),
       (${us(11_000)}::BIGINT, ${us(13_500)}::BIGINT, 'polymarket', 'btcusd', 'btc/usd', 'chainlink', '85127.5'),
       (${us(13_000)}::BIGINT, ${us(14_000)}::BIGINT, 'polymarket', 'btcusd', 'btc/usd', 'chainlink', '85131.9')
     ) t(timestamp_us, server_timestamp_us, exchange, asset_id, symbol, source, price)`,
  )
})

test.after(async () => {
  delete process.env.TELONEX_CRYPTO_PRICES_BASE_DIR
  if (baseDir) await fs.rm(baseDir, { recursive: true, force: true })
})

test('loader sorts by broadcast time, converts µs→ms exactly, casts 18-decimal prices', async () => {
  const series = await loadChainlinkCryptoPricesSeries({
    assetId: 'btcusd',
    startMs: DAY0 + 10_000,
    endMs: DAY0 + 20_000,
    lookbackMs: 5_000,
  })
  assert.equal(series.length, 4)
  // Broadcast order: 11000, 13000, 13500, 14000 → round order 10000, 12000, 11000, 13000
  assert.deepEqual(
    Array.from(series.visibleAtMs),
    [11_000, 13_000, 13_500, 14_000].map((m) => DAY0 + m),
  )
  assert.deepEqual(
    Array.from(series.tsMs),
    [10_000, 12_000, 11_000, 13_000].map((m) => DAY0 + m),
  )
  // CAST of the 18-decimal string equals JS Number of the same string.
  assert.equal(series.value[0], Number('85124.96061942543'))
})

test('loader seeds with the latest pre-range round in broadcast order', async () => {
  const series = await loadChainlinkCryptoPricesSeries({
    assetId: 'btcusd',
    startMs: DAY0 + 12_500,
    endMs: DAY0 + 20_000,
    lookbackMs: 0,
  })
  // Seed = latest broadcast among rounds strictly before 12500 (rounds 10000,
  // 11000, 12000) → the 11000 round broadcast at 13500.
  assert.equal(series.tsMs[0], DAY0 + 11_000)
  assert.equal(series.visibleAtMs[0], DAY0 + 13_500)
  // In-range: round 13000 only.
  assert.equal(series.length, 2)
})

test('pre-coverage market → hard error naming the policy', async () => {
  await assert.rejects(
    loadChainlinkCryptoPricesSeries({
      assetId: 'btcusd',
      startMs: CRYPTO_PRICES_COVERAGE_FROM_MS - 86_400_000,
      endMs: CRYPTO_PRICES_COVERAGE_FROM_MS - 86_400_000 + 900_000,
      lookbackMs: 0,
    }),
    /before\s+crypto_prices coverage/,
  )
})

test('missing older day file → hard error naming both fix commands', async () => {
  await assert.rejects(
    loadChainlinkCryptoPricesSeries({
      assetId: 'btcusd',
      startMs: Date.parse('2026-04-11T00:00:00Z'),
      endMs: Date.parse('2026-04-11T00:15:00Z'),
      lookbackMs: 0,
    }),
    /download-r2-to-local[\s\S]*telonex:crypto-prices:download/,
  )
})

test('missing day within publication lag → hard error naming the lag', async () => {
  const now = Date.now()
  await assert.rejects(
    loadChainlinkCryptoPricesSeries({
      assetId: 'btcusd',
      startMs: now - 900_000,
      endMs: now,
      lookbackMs: 0,
    }),
    /publishes daily after midnight UTC/,
  )
})

test('in-window data hole ≥ threshold → hard error naming the hole', async () => {
  // Rounds end at +13s; a window stretching to +400s leaves a ~387s hole ≥ the
  // 300s default threshold.
  await assert.rejects(
    loadChainlinkCryptoPricesSeries({
      assetId: 'btcusd',
      startMs: DAY0 + 10_000,
      endMs: DAY0 + 400_000,
      lookbackMs: 0,
    }),
    /hole in the oracle series[\s\S]*BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS=0/,
  )
})

test('BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS=0 disables the hole check (stale replay accepted)', async () => {
  process.env.BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS = '0'
  try {
    const series = await loadChainlinkCryptoPricesSeries({
      assetId: 'btcusd',
      startMs: DAY0 + 10_000,
      endMs: DAY0 + 400_000,
      lookbackMs: 0,
    })
    assert.equal(series.length, 4)
  } finally {
    delete process.env.BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS
  }
})

test('day file with no rounds up to window end → hard error', async () => {
  const EMPTY_DAY = '2026-04-12'
  const d0 = Date.parse(`${EMPTY_DAY}T00:00:00Z`)
  await writeFixtureDay(
    'btcusd',
    EMPTY_DAY,
    `SELECT * FROM (VALUES (1::BIGINT, 2::BIGINT, 'polymarket', 'btcusd', 'btc/usd', 'chainlink', '1.0')) t(timestamp_us, server_timestamp_us, exchange, asset_id, symbol, source, price) WHERE 1=0`,
  )
  await assert.rejects(
    loadChainlinkCryptoPricesSeries({
      assetId: 'btcusd',
      startMs: d0 + 10_000,
      endMs: d0 + 20_000,
      lookbackMs: 0,
    }),
    /no rounds up to/,
  )
})
