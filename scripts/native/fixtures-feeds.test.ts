/**
 * Tests of the fixture-market generator pieces (native/spec/60 §12):
 * FX-2 trimming and its independent content proof on synthetic day files
 * (with negative cases: a lookback row, the seed, a tail row, an extra row,
 * an unused column and an 18-decimal price), the job shapes of 14 §6.2 /
 * 21 §5.1, and the R14 CLI parsing of both scripts. No MySQL, R2 or data
 * root needed.
 *
 * Run: npm run native:fixtures:test
 */
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { sqlQuote } from '../../src/utils/duckdb.js'
import {
  dataFeedRoots,
  rows,
  trimBinance,
  trimChainlink,
  verifyTrimmedFeeds,
} from './fixtures-feeds.js'
import { parseCli } from './fixtures-build.js'
import { parseArgs } from './fixture-job.js'
import {
  ALL_FEEDS,
  NO_FEEDS,
  committedJob,
  committedSlugs,
  parseFeeds,
  readManifest,
  readModelConfig,
  renderJob,
  type FixtureFile,
} from './fixtures-lib.js'

const TMP = mkdtempSync(path.join(tmpdir(), 'fixtures-feeds-test-'))
after(() => rmSync(TMP, { recursive: true, force: true }))

/** 2026-04-19T00:00:00Z: the lookback crosses midnight, so each feed has two day files. */
const START = 1_776_556_800_000
const WINDOW = { startMs: START, endMs: START + 900_000 }
const PAIR = 'BTCUSDT'
const ASSET = 'btcusd'
const DAY1 = '2026-04-18'
const DAY2 = '2026-04-19'
const MAX_GAP_MS = 300_000

async function sql(text: string): Promise<void> {
  await rows(text)
}

/**
 * Binance day files: a trade every 10 s from start - 600 s to start + 960 s,
 * plus one tail trade at end + 1 s; ids increase with time; split by UTC day.
 */
async function writeBinanceDays(dataRoot: string): Promise<void> {
  const dir = path.join(dataRoot, 'binance', 'aggTrades', PAIR)
  mkdirSync(dir, { recursive: true })
  const all = `(SELECT row_number() OVER (ORDER BY ts) + 1000 AS id, ts FROM (
      SELECT ${START - 600_000} + 10000 * r AS ts FROM range(0, 157) t(r)
      UNION ALL SELECT ${WINDOW.endMs + 1000}))`
  for (const [day, lo, hi] of [
    [DAY1, START - 86_400_000, START],
    [DAY2, START, START + 86_400_000],
  ] as const) {
    await sql(`COPY (SELECT id::BIGINT AS agg_trade_id, (80000 + id / 100.0)::DOUBLE AS price,
        (id % 7 + 1) / 10.0 AS qty, (id * 3)::BIGINT AS first_trade_id, (id * 3 + 2)::BIGINT AS last_trade_id,
        ts::BIGINT AS ts_ms, (id % 2 = 0) AS is_buyer_maker
      FROM ${all} WHERE ts >= ${lo} AND ts < ${hi} ORDER BY id)
      TO ${sqlQuote(path.join(dir, `${PAIR}-aggTrades-${day}.parquet`))} (FORMAT parquet, COMPRESSION zstd)`)
  }
}

/** Chainlink day files: a round every 5 s, broadcast 1 s later, 18-decimal string prices. */
async function writeChainlinkDays(dataRoot: string): Promise<void> {
  const dir = path.join(dataRoot, 'telonex', 'crypto_prices', ASSET)
  mkdirSync(dir, { recursive: true })
  const all = `(SELECT ${START - 600_000} + 5000 * r AS ts, r FROM range(0, 313) t(r))`
  for (const [day, lo, hi] of [
    [DAY1, START - 86_400_000, START],
    [DAY2, START, START + 86_400_000],
  ] as const) {
    await sql(`COPY (SELECT (ts * 1000)::BIGINT AS timestamp_us, ((ts + 1000) * 1000)::BIGINT AS server_timestamp_us,
        ((ts + 1100) * 1000)::BIGINT AS local_timestamp_us, 'chainlink' AS exchange, '${ASSET}' AS asset_id,
        'btc/usd' AS symbol, 'rtds' AS source, (84000 + r)::VARCHAR || '.123456789012345678' AS price
      FROM ${all} WHERE ts >= ${lo} AND ts < ${hi} ORDER BY ts)
      TO ${sqlQuote(path.join(dir, `${ASSET}-crypto-prices-${day}.parquet`))} (FORMAT parquet, COMPRESSION snappy)`)
  }
}

/** Rewrites one parquet file through a SELECT over it (`f` = the file). */
async function rewrite(file: string, select: (f: string) => string): Promise<void> {
  const tmp = `${file}.tmp.parquet`
  await sql(
    `COPY (${select(`read_parquet(${sqlQuote(file)})`)}) TO ${sqlQuote(tmp)} (FORMAT parquet)`,
  )
  renameSync(tmp, file)
}

const dataRoot = path.join(TMP, 'data')
const fixture = path.join(TMP, 'fixture')
let files: FixtureFile[] = []

async function verify(dir: string): Promise<unknown> {
  return verifyTrimmedFeeds({
    dir,
    files,
    sourceRoots: dataFeedRoots(dataRoot),
    pair: PAIR,
    chainlinkAssetId: ASSET,
    window: WINDOW,
    maxGapMs: MAX_GAP_MS,
  })
}

test('trim: exactly membership + seed per day file, seed in the previous day', async () => {
  await writeBinanceDays(dataRoot)
  await writeChainlinkDays(dataRoot)
  const b = await trimBinance({ dir: fixture, dataRoot, pair: PAIR, window: WINDOW })
  const c = await trimChainlink({ dir: fixture, dataRoot, assetId: ASSET, window: WINDOW })
  files = [...b.files, ...c.files]
  assert.deepEqual(
    files.map((f) => [f.path, f.rows, f.trim?.membershipRows, f.trim?.holdsSeed]),
    [
      // Lookback [start - 300 s, start): 30 trades, plus the seed (start - 310 s).
      [`binance/aggTrades/${PAIR}/${PAIR}-aggTrades-${DAY1}.parquet`, 31, 30, true],
      // [start, end + 2 s]: 91 trades every 10 s plus the tail trade at end + 1 s.
      [`binance/aggTrades/${PAIR}/${PAIR}-aggTrades-${DAY2}.parquet`, 92, 92, false],
      [`chainlink/${ASSET}/${ASSET}-crypto-prices-${DAY1}.parquet`, 61, 60, true],
      // Rounds in [start, end + 5 s]: 182.
      [`chainlink/${ASSET}/${ASSET}-crypto-prices-${DAY2}.parquet`, 182, 182, false],
    ],
  )
  // Seeds: the last trade before start - 300 s (id 1000 + 30) and the round at start - 305 s.
  assert.equal(b.seedAggTradeId, 1030)
  assert.equal(c.seedRoundUs, (START - 305_000) * 1000)
  // The DuckDB-written copies keep every annotation of DuckDB-written sources.
  for (const f of files) assert.deepEqual(f.trim?.annotationDifferences, [])
  const series = await verify(fixture)
  assert.deepEqual(
    (series as Array<{ feed: string; length: number }>).map((s) => [s.feed, s.length]),
    [
      ['binance_agg_trades', 123],
      ['chainlink_crypto_prices', 243],
    ],
  )
})

const b1 = (): string => `binance/aggTrades/${PAIR}/${PAIR}-aggTrades-${DAY1}.parquet`
const b2 = (): string => `binance/aggTrades/${PAIR}/${PAIR}-aggTrades-${DAY2}.parquet`
const c1 = (): string => `chainlink/${ASSET}/${ASSET}-crypto-prices-${DAY1}.parquet`
const c2 = (): string => `chainlink/${ASSET}/${ASSET}-crypto-prices-${DAY2}.parquet`
const src = (rel: string): string =>
  rel.startsWith('binance/')
    ? path.join(dataRoot, rel)
    : path.join(dataRoot, 'telonex', 'crypto_prices', rel.slice('chainlink/'.length))

const SERIES = /FX-2: TS loader series differ/
const SUBSET = /FX-2: .* is not a row of /
const EXTRA = /FX-2: trimmed binance_agg_trades files hold 124 rows, the TS series has 123/

const MUTATIONS: Array<{
  name: string
  file: () => string
  select: (f: string) => string
  expect: RegExp
}> = [
  {
    name: 'binance: a lookback row other than the last one is dropped',
    file: b1,
    select: (f) => `SELECT * FROM ${f} WHERE ts_ms <> ${START - 240_000}`,
    expect: SERIES,
  },
  {
    name: 'binance: the seed is replaced by an older trade (same row count)',
    file: b1,
    select: (f) =>
      `SELECT * FROM (SELECT * FROM ${f} WHERE agg_trade_id <> 1030
         UNION ALL SELECT * FROM read_parquet(${sqlQuote(src(b1()))}) WHERE agg_trade_id = 1029)
       ORDER BY agg_trade_id`,
    expect: SERIES,
  },
  {
    name: 'binance: the tail trade after the window end is dropped',
    file: b2,
    select: (f) => `SELECT * FROM ${f} WHERE ts_ms <> ${WINDOW.endMs + 1000}`,
    expect: SERIES,
  },
  {
    name: 'binance: an extra trade outside membership plus seed is kept',
    file: b1,
    select: (f) =>
      `SELECT * FROM (SELECT * FROM ${f}
         UNION ALL SELECT * FROM read_parquet(${sqlQuote(src(b1()))}) WHERE agg_trade_id = 1029)
       ORDER BY agg_trade_id`,
    expect: EXTRA,
  },
  {
    name: 'binance: a column the loader does not read is altered',
    file: b2,
    select: (f) =>
      `SELECT * REPLACE (CASE WHEN agg_trade_id = 1100 THEN qty + 1 ELSE qty END AS qty) FROM ${f}`,
    expect: SUBSET,
  },
  {
    name: 'binance: two rows are swapped (row order)',
    file: b2,
    select: (f) =>
      `SELECT * FROM ${f} ORDER BY CASE agg_trade_id WHEN 1100 THEN 1101 WHEN 1101 THEN 1100 ELSE agg_trade_id END`,
    expect: SUBSET,
  },
  {
    name: 'chainlink: a lookback round is dropped',
    file: c1,
    select: (f) => `SELECT * FROM ${f} WHERE timestamp_us <> ${(START - 200_000) * 1000}`,
    expect: SERIES,
  },
  {
    name: 'chainlink: the seed is replaced by an older round',
    file: c1,
    select: (f) =>
      `SELECT * FROM (SELECT * FROM ${f} WHERE timestamp_us <> ${(START - 305_000) * 1000}
         UNION ALL SELECT * FROM read_parquet(${sqlQuote(src(c1()))}) WHERE timestamp_us = ${(START - 310_000) * 1000})
       ORDER BY timestamp_us`,
    expect: SERIES,
  },
  {
    name: 'chainlink: a tail round after the window end is dropped',
    file: c2,
    select: (f) => `SELECT * FROM ${f} WHERE timestamp_us <> ${(WINDOW.endMs + 5000) * 1000}`,
    expect: SERIES,
  },
  {
    name: 'chainlink: the 18th price decimal changes (invisible as f64)',
    file: c2,
    select: (f) =>
      `SELECT * REPLACE (CASE WHEN timestamp_us = ${START * 1000} THEN regexp_replace(price, '8$', '9') ELSE price END AS price) FROM ${f}`,
    expect: SUBSET,
  },
]

for (const [i, m] of MUTATIONS.entries()) {
  test(`verify fails: ${m.name}`, async () => {
    const dir = path.join(TMP, `mutated-${i}`)
    cpSync(fixture, dir, { recursive: true })
    await rewrite(path.join(dir, m.file()), m.select)
    await assert.rejects(verify(dir), m.expect)
  })
}

test('fixtures-build CLI rejects positionals, foreign flags, repeats and bad values', () => {
  assert.deepEqual(
    parseCli(['build', '--slug', 'a', '--data-root', '/x']).values.get('--slug'),
    'a',
  )
  assert.throws(() => parseCli([]), /subcommand/)
  assert.throws(() => parseCli(['bogus']), /subcommand/)
  assert.throws(() => parseCli(['build', 'btc-updown-15m-1773969300']), /unexpected argument/)
  assert.throws(() => parseCli(['check', '--slug', 'x']), /not a flag of check/)
  assert.throws(() => parseCli(['build', '--max-bytes', '5']), /not a flag of build/)
  assert.throws(() => parseCli(['prove', '--slug', 'a', '--slug', 'b']), /twice/)
  assert.throws(() => parseCli(['scan', '--max-bytes']), /missing value/)
  assert.throws(() => parseCli(['scan', '--max-bytes', '--data-root']), /missing value/)
  assert.ok(parseCli(['build', '--prune']).switches.has('--prune'))
})

test('fixture-job CLI: exerciser default, explicit feeds for other strategies', () => {
  const d = parseArgs(['s'])
  assert.equal(d.strategyId, 'engine-exerciser.rs')
  assert.deepEqual(d.feeds, NO_FEEDS)
  assert.throws(() => parseArgs(['s', '--out', 'a', '--out', 'b']), /twice/)
  assert.throws(() => parseArgs(['s', '--out', '--feeds']), /missing value/)
  assert.throws(() => parseArgs(['s', '--bogus', 'x']), /unknown argument/)
  assert.throws(() => parseArgs(['s', '--strategy-id', 'lagsnipe']), /explicit --feeds/)
  assert.deepEqual(parseArgs(['s', '--strategy-id', 'x', '--feeds', 'all']).feeds, ALL_FEEDS)
  assert.deepEqual(parseFeeds('binance,price-to-beat'), {
    binance: true,
    chainlink: false,
    priceToBeat: true,
  })
  assert.throws(() => parseFeeds('binance,binance'), /twice/)
  assert.throws(() => parseFeeds('ta'), /unknown feed/)
})

test('committed fixtures: job.json is the no-feeds exerciser job; feed form on request', () => {
  const slugs = committedSlugs()
  assert.ok(slugs.length >= 6)
  for (const slug of slugs) {
    const m = readManifest(slug)
    const job = committedJob(m) as { run: { strategyId: string }; market: Record<string, unknown> }
    assert.equal(job.run.strategyId, 'engine-exerciser.rs')
    assert.equal('gammaPriceToBeat' in job.market, false)
    assert.deepEqual(job.market.feedAvailability, { priceToBeat: null })
    assert.deepEqual(job.market.feedFiles, [])
    const opts = { params: {}, baseDir: '/abs', modelConfig: readModelConfig() }
    assert.throws(
      () => renderJob(m, { ...opts, strategyId: 'engine-exerciser.rs', feeds: ALL_FEEDS }),
      /requests no feeds/,
    )
    const fed = renderJob(m, { ...opts, strategyId: 'x', feeds: ALL_FEEDS }) as {
      market: {
        gammaPriceToBeat: unknown
        feedAvailability: unknown
        feedFiles: Array<{ path: string }>
      }
    }
    assert.deepEqual(fed.market.feedAvailability, { priceToBeat: { status: m.priceToBeat.status } })
    assert.deepEqual(fed.market.gammaPriceToBeat, {
      priceToBeat: m.priceToBeat.value,
      syncedAtMs: m.priceToBeat.syncedAtMs,
    })
    assert.deepEqual(
      fed.market.feedFiles.map((f) => f.path),
      m.files.filter((f) => f.role !== 'telonex_delta').map((f) => `/abs/${f.path}`),
    )
  }
})
