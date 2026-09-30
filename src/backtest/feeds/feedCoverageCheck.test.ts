import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { aggTradesDayPath } from '../../binance/paths.js'
import { cryptoPricesDayPath } from '../../telonex/cryptoPrices/paths.js'
import { getInMemoryDuckDb, sqlQuote } from '../../utils/duckdb.js'
import { parseFeedCoverageArgs } from '../../cli/helpers/feedCoverageCheck.js'
import { coverageStatus, measureFeedCoverage, summarizeFeedCoverage } from './feedCoverageCheck.js'

const DATE = '2026-06-01'
const START = Date.parse(`${DATE}T00:00:00Z`)
const DAY_MS = 86_400_000
let root = ''
let originalBinance: string | undefined
let originalChainlink: string | undefined

test.before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'feed-coverage-'))
  originalBinance = process.env.BINANCE_DATA_BASE_DIR
  originalChainlink = process.env.TELONEX_CRYPTO_PRICES_BASE_DIR
  process.env.BINANCE_DATA_BASE_DIR = path.join(root, 'binance')
  process.env.TELONEX_CRYPTO_PRICES_BASE_DIR = path.join(root, 'chainlink')
})

test.after(async () => {
  if (originalBinance === undefined) delete process.env.BINANCE_DATA_BASE_DIR
  else process.env.BINANCE_DATA_BASE_DIR = originalBinance
  if (originalChainlink === undefined) delete process.env.TELONEX_CRYPTO_PRICES_BASE_DIR
  else process.env.TELONEX_CRYPTO_PRICES_BASE_DIR = originalChainlink
  await rm(root, { recursive: true, force: true })
})

async function fixture(file: string, select: string) {
  await mkdir(path.dirname(file), { recursive: true })
  const conn = await (await getInMemoryDuckDb()).connect()
  try {
    await conn.run(`COPY (${select}) TO ${sqlQuote(file)} (FORMAT PARQUET)`)
  } finally {
    conn.closeSync()
  }
}

function window(startMs: number, endMs: number) {
  return { slug: `test-${startMs}-${endMs}`, startMs, endMs }
}

async function binanceFixture(offsets: number[], date = DATE, price = '100') {
  const base = Date.parse(`${date}T00:00:00Z`)
  await fixture(
    aggTradesDayPath('BTCUSDT', date),
    `SELECT * FROM (VALUES ${offsets.map((offset) => `(${base + offset}::BIGINT, ${price}::DOUBLE)`).join(',')}) t(ts_ms, price)`,
  )
}

test('10 seconds passes exactly; leading, internal, and trailing gaps are measured per window', async () => {
  // Deliberately unordered, with duplicate timestamps.
  await binanceFixture([20_000, 0, 10_000, 10_000, 40_001, 50_001])
  const results = await measureFeedCoverage({
    feed: 'binance',
    symbol: 'btc',
    windows: [
      window(START, START + 30_000),
      window(START + 20_000, START + 50_001),
      window(START + 30_000, START + 50_001),
      window(START + 40_001, START + 60_002),
    ],
  })
  assert.deepEqual(
    results.map((r) => r.maxGapMs),
    [10_000, 20_001, 10_001, 10_001],
  )
  assert.deepEqual(summarizeFeedCoverage(results, 10_000), {
    allowedGapMs: 10_000,
    total: 4,
    usable: 1,
    unusable: 3,
    unverified: 0,
  })
})

test('a gap crossing midnight is joined, not split into two shorter gaps', async () => {
  await binanceFixture([DAY_MS - 4000])
  await binanceFixture([3000], '2026-06-02')
  const [result] = await measureFeedCoverage({
    feed: 'binance',
    symbol: 'btc',
    windows: [window(START + DAY_MS - 4000, START + DAY_MS + 4000)],
  })
  assert.equal(result!.maxGapMs, 7000)
  assert.equal(coverageStatus(result!, 5000), 'unusable')
})

test('a window ending at midnight does not require the following day', async () => {
  await binanceFixture([DAY_MS - 10_000, DAY_MS - 5000])
  await rm(aggTradesDayPath('BTCUSDT', '2026-06-02'))
  const [result] = await measureFeedCoverage({
    feed: 'binance',
    symbol: 'btc',
    windows: [window(START + DAY_MS - 10_000, START + DAY_MS)],
  })
  assert.equal(coverageStatus(result!, 10_000), 'usable')
  assert.equal(result!.maxGapMs, 5000)
})

test('missing and unreadable files remain unverified, including partly available windows', async () => {
  await binanceFixture([DAY_MS - 1000])
  await writeFile(aggTradesDayPath('BTCUSDT', '2026-06-03'), 'not parquet')
  const results = await measureFeedCoverage({
    feed: 'binance',
    symbol: 'btc',
    windows: [
      window(START + DAY_MS - 1000, START + DAY_MS + 1000),
      window(START + 2 * DAY_MS, START + 2 * DAY_MS + 1000),
    ],
  })
  assert.deepEqual(
    results.map((r) => coverageStatus(r, 10_000)),
    ['unverified', 'unverified'],
  )
  assert.deepEqual(
    results.map((r) => r.maxGapMs),
    [null, null],
  )
  assert.match(results[0]!.issues[0]!, /missing local file/)
  assert.match(results[1]!.issues[0]!, /read error/)
})

test('empty files fail even with a permissive gap limit', async () => {
  const file = aggTradesDayPath('BTCUSDT', DATE)
  await fixture(file, 'SELECT 0::BIGINT AS ts_ms, 1.0 AS price WHERE FALSE')
  const args = { feed: 'binance' as const, symbol: 'btc', windows: [window(START, START + 1000)] }
  const [empty] = await measureFeedCoverage(args)
  assert.equal(coverageStatus(empty!, 60_000), 'unusable')
})

test('invalid prices and undatable rows cannot produce a usable market', async () => {
  await fixture(
    aggTradesDayPath('BTCUSDT', DATE),
    `SELECT * FROM (VALUES
    (${START}::BIGINT, 'NaN'::DOUBLE), (NULL::BIGINT, 100.0)) t(ts_ms, price)`,
  )
  const [result] = await measureFeedCoverage({
    feed: 'binance',
    symbol: 'btc',
    windows: [window(START, START + 1000)],
  })
  assert.equal(result!.invalidRows, 2)
  assert.equal(coverageStatus(result!, 60_000), 'unusable')
})

test('Chainlink uses round timestamps in milliseconds and validates broadcast timestamps and asset', async () => {
  const file = cryptoPricesDayPath('btcusd', DATE)
  await fixture(
    file,
    `SELECT * FROM (VALUES
    (${START * 1000}::BIGINT, ${(START + 20_000) * 1000}::BIGINT, 'btcusd', '100'),
    (${(START + 10_000) * 1000}::BIGINT, ${(START + 11_000) * 1000}::BIGINT, 'btcusd', '101')
  ) t(timestamp_us, server_timestamp_us, asset_id, price)`,
  )
  const args = {
    feed: 'chainlink' as const,
    symbol: 'btc',
    windows: [window(START, START + 20_000)],
  }
  const [valid] = await measureFeedCoverage(args)
  assert.equal(valid!.maxGapMs, 10_000)
  assert.equal(coverageStatus(valid!, 10_000), 'usable')
  await fixture(
    file,
    `SELECT ${START * 1000}::BIGINT AS timestamp_us, 0::BIGINT AS server_timestamp_us,
    'ethusd' AS asset_id, '100' AS price`,
  )
  const [invalid] = await measureFeedCoverage(args)
  assert.equal(coverageStatus(invalid!, 60_000), 'unusable')
})

test('CLI dates and thresholds are explicit and invalid inputs are rejected', () => {
  const args = ['--symbol', 'btc', '--from', '2026-06-01', '--to', '2026-06-02']
  const parsed = parseFeedCoverageArgs(args)
  assert.equal(parsed.allowedGapMs, 10_000)
  assert.equal(parsed.toMs, START + 2 * DAY_MS - 1)
  assert.equal(parsed.readFrom, 'r2')
  for (const value of ['0', '-1', 'NaN', 'Infinity']) {
    assert.throws(() => parseFeedCoverageArgs([...args, '--max-gap-seconds', value]))
  }
  assert.throws(() =>
    parseFeedCoverageArgs(['--symbol', 'btc', '--from', '2026-02-30', '--to', '2026-06-02']),
  )
  assert.throws(() => parseFeedCoverageArgs([...args, '--limit', '100']))
  assert.throws(() => parseFeedCoverageArgs([...args, '--symbol', 'eth']))
})
