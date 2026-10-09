/**
 * FX-2 feed trimming and its content checks for the committed fixture markets
 * (native/spec/60 §12, 14 F-12 to F-14 and F-20 to F-22).
 *
 * - `trimBinance` / `trimChainlink` write one trimmed copy per covered day
 *   file: the membership rows plus the seed row, in source row order.
 * - `verifyTrimmedFeeds` proves the trim without reusing the trim predicates:
 *   every trimmed file is an order-preserving sub-multiset of its source day
 *   file, the TS loaders (`loadBinanceAggTradesSeries`,
 *   `loadChainlinkCryptoPricesSeries`, the oracle of F-13/F-14/F-21/F-22)
 *   return identical series on the full and on the trimmed day files, and the
 *   trimmed files hold no row beyond that series. Together this is "exactly
 *   the membership rows plus the seed".
 *
 * Reads and writes only the paths it is given. No MySQL, Redis or R2.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import type { DuckDBConnection } from '@duckdb/node-api'
import { getInMemoryDuckDb, sqlQuote } from '../../src/utils/duckdb.js'
import { aggTradesDayPath, utcDatesCovering } from '../../src/binance/paths.js'
import {
  CRYPTO_PRICES_COVERAGE_FROM_MS,
  cryptoPricesDayPath,
} from '../../src/telonex/cryptoPrices/paths.js'
import { loadBinanceAggTradesSeries } from '../../src/backtest/feeds/binanceAggTradesSource.js'
import { loadChainlinkCryptoPricesSeries } from '../../src/backtest/feeds/chainlinkCryptoPricesSource.js'
import { sha256File, type FeedSeriesDigest, type FixtureFile } from './fixtures-lib.js'

/** 14 §4.3: lookback and tails are engine constants (TS: wireBacktestExternalFeeds.ts DEFAULT_LOOKBACK_MS, the sources' SERIES_TAIL_MS). */
export const LOOKBACK_MS = 300_000
export const BINANCE_TAIL_MS = 2_000
export const CHAINLINK_TAIL_MS = 5_000

export type Window = { startMs: number; endMs: number }

/** Feed dataset roots, laid out as the dataset (14 §4.1, §5.1). */
export type FeedRoots = { binance: string; chainlink: string }

/** The feed roots under a data root (`<data-root>/binance`, `<data-root>/telonex/crypto_prices`). */
export function dataFeedRoots(dataRoot: string): FeedRoots {
  return {
    binance: path.join(dataRoot, 'binance'),
    chainlink: path.join(dataRoot, 'telonex', 'crypto_prices'),
  }
}

/** The trimmed feed roots inside a fixture directory (the same layout). */
export function fixtureFeedRoots(dir: string): FeedRoots {
  return { binance: path.join(dir, 'binance'), chainlink: path.join(dir, 'chainlink') }
}

/**
 * Runs `fn` with the TS day-file layout (src/binance/paths.ts,
 * src/telonex/cryptoPrices/paths.ts) pointed at `roots` and the Chainlink gap
 * knob set, then restores the previous values.
 */
export async function withFeedEnv<T>(
  roots: FeedRoots,
  maxGapMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const set: Record<string, string> = {
    BINANCE_DATA_BASE_DIR: roots.binance,
    TELONEX_CRYPTO_PRICES_BASE_DIR: roots.chainlink,
    BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS: String(maxGapMs),
  }
  const saved = Object.fromEntries(Object.keys(set).map((k) => [k, process.env[k]]))
  Object.assign(process.env, set)
  try {
    return await fn()
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

function num(v: unknown): number {
  if (typeof v === 'bigint') {
    const n = Number(v)
    if (!Number.isSafeInteger(n)) throw new Error(`integer out of safe range: ${v}`)
    return n
  }
  if (typeof v === 'number') return v
  throw new Error(`expected a number, got ${typeof v}`)
}

let connPromise: Promise<DuckDBConnection> | undefined
async function duck(): Promise<DuckDBConnection> {
  connPromise ??= (async () => {
    const db = await getInMemoryDuckDb()
    const conn = await db.connect()
    // One thread: deterministic writer output for the trimmed files.
    await conn.run('SET threads = 1')
    return conn
  })()
  return connPromise
}

export async function rows(sql: string): Promise<unknown[][]> {
  const conn = await duck()
  const res = await conn.run(sql)
  return (await res.getRows()) as unknown[][]
}

export async function parquetRowCount(file: string): Promise<number> {
  return num((await rows(`SELECT count(*) FROM read_parquet(${sqlQuote(file)})`))[0]![0])
}

type ParquetColumn = {
  name: string
  physical: string
  convertedType: string | null
  logicalType: string | null
  repetition: string
}

async function parquetColumns(file: string): Promise<ParquetColumn[]> {
  const found = await rows(
    `SELECT name, type, converted_type, logical_type, repetition_type
     FROM parquet_schema(${sqlQuote(file)}) WHERE type IS NOT NULL`,
  )
  return found.map((r) => ({
    name: String(r[0]),
    physical: String(r[1]),
    convertedType: r[2] === null ? null : String(r[2]),
    logicalType: r[3] === null ? null : String(r[3]),
    repetition: String(r[4]),
  }))
}

/**
 * FX-2 "same columns, types and row order": column names, order, physical
 * types, repetition and DuckDB logical types MUST equal the source. Parquet
 * converted/logical annotations may differ (DuckDB writes `INT_64` on INT64
 * and no `StringType()` on UTF8 columns where the arrow-written Chainlink
 * sources carry none and `StringType()`); every difference is returned so the
 * manifest records it.
 */
export async function compareSchema(
  source: string,
  trimmed: string,
): Promise<NonNullable<FixtureFile['trim']>['annotationDifferences']> {
  const describe = async (f: string): Promise<string> =>
    JSON.stringify(
      (await rows(`DESCRIBE SELECT * FROM read_parquet(${sqlQuote(f)})`)).map((r) => [r[0], r[1]]),
    )
  if ((await describe(source)) !== (await describe(trimmed))) {
    throw new Error(`${trimmed}: DuckDB column types differ from ${source}`)
  }
  const a = await parquetColumns(source)
  const b = await parquetColumns(trimmed)
  const shape = (c: ParquetColumn[]): string =>
    JSON.stringify(c.map((x) => [x.name, x.physical, x.repetition]))
  if (shape(a) !== shape(b)) throw new Error(`${trimmed}: parquet columns differ from ${source}`)
  const diffs: NonNullable<FixtureFile['trim']>['annotationDifferences'] = []
  for (let i = 0; i < a.length; i += 1) {
    const s = a[i]!
    const t = b[i]!
    if (s.convertedType !== t.convertedType || s.logicalType !== t.logicalType) {
      diffs.push({
        column: s.name,
        source: { convertedType: s.convertedType, logicalType: s.logicalType },
        trimmed: { convertedType: t.convertedType, logicalType: t.logicalType },
      })
    }
  }
  return diffs
}

// ---------------------------------------------------------------------------
// Trimming
// ---------------------------------------------------------------------------

type SeedRow = { file: string; rowNumber: number; key: number[] }

/** The single seed row, or null; a tie on the ordering key is refused (the TS pick would be arbitrary). */
function pickSeed(found: unknown[][], what: string): SeedRow | null {
  if (found.length === 0) return null
  const key = (r: unknown[]): number[] => r.slice(2).map(num)
  const first = found[0]!
  if (found.length > 1 && JSON.stringify(key(found[1]!)) === JSON.stringify(key(first))) {
    throw new Error(
      `${what}: seed tie on ${JSON.stringify(key(first))}; refusing an ambiguous trim`,
    )
  }
  return { file: String(first[0]), rowNumber: num(first[1]), key: key(first) }
}

function assertSeedPlaced(files: FixtureFile[], seed: SeedRow | null, what: string): void {
  const holders = files.filter((f) => f.trim?.holdsSeed).length
  if (holders !== (seed ? 1 : 0))
    throw new Error(`${what}: seed row placed in ${holders} day files`)
}

/** `data/<path relative to the data root>`: where a source file came from, independent of the machine. */
export function sourceLabel(dataRoot: string, abs: string): string {
  const rel = path.relative(dataRoot, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`${abs} is outside the data root ${dataRoot}`)
  }
  return `data/${rel.split(path.sep).join('/')}`
}

export async function fileEntry(args: {
  role: FixtureFile['role']
  dir: string
  relPath: string
  day: string | null
  source: string
  sourceLabel: string
  trim: FixtureFile['trim']
}): Promise<FixtureFile> {
  const abs = path.join(args.dir, args.relPath)
  return {
    role: args.role,
    path: args.relPath,
    bytes: statSync(abs).size,
    sha256: await sha256File(abs),
    rows: await parquetRowCount(abs),
    day: args.day,
    source: {
      path: args.sourceLabel,
      bytes: statSync(args.source).size,
      sha256: await sha256File(args.source),
      rows: await parquetRowCount(args.source),
    },
    trim: args.trim,
  }
}

async function writeTrimmed(args: {
  source: string
  dest: string
  membership: string
  seed: SeedRow | null
  compression: 'zstd' | 'snappy'
}): Promise<NonNullable<FixtureFile['trim']>> {
  const holdsSeed = args.seed !== null && args.seed.file === args.source
  const where = holdsSeed
    ? `(${args.membership}) OR file_row_number = ${args.seed!.rowNumber}`
    : args.membership
  mkdirSync(path.dirname(args.dest), { recursive: true })
  const conn = await duck()
  await conn.run(
    `COPY (SELECT * EXCLUDE (file_row_number)
           FROM read_parquet(${sqlQuote(args.source)}, file_row_number = true)
           WHERE ${where} ORDER BY file_row_number)
     TO ${sqlQuote(args.dest)} (FORMAT parquet, COMPRESSION ${args.compression})`,
  )
  const [m] = await rows(
    `SELECT count(*) FROM read_parquet(${sqlQuote(args.source)}) WHERE ${args.membership}`,
  )
  const membershipRows = num(m![0])
  const written = await parquetRowCount(args.dest)
  if (written !== membershipRows + (holdsSeed ? 1 : 0)) {
    throw new Error(`${args.dest}: wrote ${written} rows, expected ${membershipRows} + seed`)
  }
  return {
    membershipRows,
    holdsSeed,
    annotationDifferences: await compareSchema(args.source, args.dest),
  }
}

export async function trimBinance(args: {
  dir: string
  dataRoot: string
  pair: string
  window: Window
}): Promise<{ files: FixtureFile[]; seedAggTradeId: number | null }> {
  const fromMs = args.window.startMs - LOOKBACK_MS
  const days = utcDatesCovering(fromMs, args.window.endMs) // F-12
  const roots = dataFeedRoots(args.dataRoot)
  const sources = await withFeedEnv(roots, 0, async () =>
    days.map((d) => aggTradesDayPath(args.pair, d)),
  )
  for (const s of sources) if (!existsSync(s)) throw new Error(`missing Binance day file ${s}`)
  const list = sources.map(sqlQuote).join(', ')
  // F-14: highest agg_trade_id with ts_ms < start - lookback, covered day files only.
  const seed = pickSeed(
    await rows(
      `SELECT filename, file_row_number, agg_trade_id FROM read_parquet([${list}], filename = true, file_row_number = true)
       WHERE ts_ms < ${fromMs} ORDER BY agg_trade_id DESC LIMIT 2`,
    ),
    `binance ${args.pair}`,
  )
  // F-13 membership.
  const membership = `ts_ms BETWEEN ${fromMs} AND ${args.window.endMs + BINANCE_TAIL_MS}`
  const files: FixtureFile[] = []
  for (let i = 0; i < days.length; i += 1) {
    const source = sources[i]!
    const relPath = `binance/aggTrades/${args.pair}/${path.basename(source)}`
    const trim = await writeTrimmed({
      source,
      dest: path.join(args.dir, relPath),
      membership,
      seed,
      compression: 'zstd',
    })
    files.push(
      await fileEntry({
        role: 'binance_agg_trades',
        dir: args.dir,
        relPath,
        day: days[i]!,
        source,
        sourceLabel: sourceLabel(args.dataRoot, source),
        trim,
      }),
    )
  }
  assertSeedPlaced(files, seed, `binance ${args.pair}`)
  return { files, seedAggTradeId: seed ? seed.key[0]! : null }
}

export async function trimChainlink(args: {
  dir: string
  dataRoot: string
  assetId: string
  window: Window
}): Promise<{ files: FixtureFile[]; seedRoundUs: number | null; seedBroadcastUs: number | null }> {
  const fromMs = args.window.startMs - LOOKBACK_MS
  const days = utcDatesCovering(Math.max(fromMs, CRYPTO_PRICES_COVERAGE_FROM_MS), args.window.endMs) // F-20
  const roots = dataFeedRoots(args.dataRoot)
  const sources = await withFeedEnv(roots, 0, async () =>
    days.map((d) => cryptoPricesDayPath(args.assetId, d)),
  )
  for (const s of sources) if (!existsSync(s)) throw new Error(`missing Chainlink day file ${s}`)
  const list = sources.map(sqlQuote).join(', ')
  // F-22: latest row with round < start - lookback in (broadcast, round) order.
  const seed = pickSeed(
    await rows(
      `SELECT filename, file_row_number, server_timestamp_us, timestamp_us
       FROM read_parquet([${list}], filename = true, file_row_number = true)
       WHERE timestamp_us < ${fromMs} * 1000
       ORDER BY server_timestamp_us DESC, timestamp_us DESC LIMIT 2`,
    ),
    `chainlink ${args.assetId}`,
  )
  // F-21 membership by round time.
  const membership = `timestamp_us BETWEEN ${fromMs} * 1000 AND ${args.window.endMs + CHAINLINK_TAIL_MS} * 1000`
  const files: FixtureFile[] = []
  for (let i = 0; i < days.length; i += 1) {
    const source = sources[i]!
    const relPath = `chainlink/${args.assetId}/${path.basename(source)}`
    const trim = await writeTrimmed({
      source,
      dest: path.join(args.dir, relPath),
      membership,
      seed,
      compression: 'snappy',
    })
    files.push(
      await fileEntry({
        role: 'chainlink_crypto_prices',
        dir: args.dir,
        relPath,
        day: days[i]!,
        source,
        sourceLabel: sourceLabel(args.dataRoot, source),
        trim,
      }),
    )
  }
  assertSeedPlaced(files, seed, `chainlink ${args.assetId}`)
  return {
    files,
    seedBroadcastUs: seed ? seed.key[0]! : null,
    seedRoundUs: seed ? seed.key[1]! : null,
  }
}

// ---------------------------------------------------------------------------
// Verification (independent of the trim predicates)
// ---------------------------------------------------------------------------

/**
 * Every row of `trimmed` exists in `source`, and the trimmed rows appear in
 * source row order (identical rows are interchangeable, so a greedy match
 * on the smallest later source row is exact).
 */
export async function assertOrderedSubset(source: string, trimmed: string): Promise<void> {
  const cols = (await parquetColumns(source)).map((c) => c.name)
  const quoted = (c: string): string => `"${c.replaceAll('"', '""')}"`
  const on = cols.map((c) => `t.${quoted(c)} IS NOT DISTINCT FROM s.${quoted(c)}`).join(' AND ')
  const matches = await rows(
    `WITH t AS (SELECT *, file_row_number AS __t FROM read_parquet(${sqlQuote(trimmed)}, file_row_number = true)),
          s AS (SELECT *, file_row_number AS __s FROM read_parquet(${sqlQuote(source)}, file_row_number = true))
     SELECT t.__t, string_agg(s.__s::VARCHAR, ',' ORDER BY s.__s)
     FROM t LEFT JOIN s ON ${on}
     GROUP BY t.__t ORDER BY t.__t`,
  )
  let prev = -1
  for (const [t, list] of matches) {
    const candidates = typeof list === 'string' && list !== '' ? list.split(',').map(Number) : []
    const next = candidates.find((s) => s > prev)
    if (next === undefined) {
      throw new Error(
        `FX-2: ${trimmed} row ${num(t)} is not a row of ${source} after source row ${prev} (trimmed rows must be source rows in source order)`,
      )
    }
    prev = next
  }
}

function seriesSha256(arrays: Float64Array[]): string {
  const hash = createHash('sha256')
  for (const a of arrays) hash.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength))
  return hash.digest('hex')
}

/** The TS loaders' series for the fixture's feeds under `roots`, as digests. */
export async function feedSeriesDigests(args: {
  roots: FeedRoots
  pair: string
  chainlinkAssetId: string | null
  window: Window
  maxGapMs: number
}): Promise<FeedSeriesDigest[]> {
  return withFeedEnv(args.roots, args.maxGapMs, async () => {
    const out: FeedSeriesDigest[] = []
    const b = await loadBinanceAggTradesSeries({
      pair: args.pair,
      startMs: args.window.startMs,
      endMs: args.window.endMs,
      lookbackMs: LOOKBACK_MS,
    })
    out.push({
      feed: 'binance_agg_trades',
      length: b.length,
      sha256: seriesSha256([b.tsMs, b.value]),
    })
    if (args.chainlinkAssetId !== null) {
      const c = await loadChainlinkCryptoPricesSeries({
        assetId: args.chainlinkAssetId,
        startMs: args.window.startMs,
        endMs: args.window.endMs,
        lookbackMs: LOOKBACK_MS,
      })
      out.push({
        feed: 'chainlink_crypto_prices',
        length: c.length,
        sha256: seriesSha256([c.tsMs, c.visibleAtMs, c.value]),
      })
    }
    return out
  })
}

/**
 * Proves the trimmed day files of one fixture (FX-2) and returns the series
 * digests. Throws when a trimmed file holds a row its source does not hold
 * (or out of order), when a TS loader returns a different series on the
 * trimmed files than on the full day files (a missing, altered or extra
 * membership row, or a different seed), or when the trimmed files of a feed
 * hold more rows than that series (a row outside membership plus seed).
 */
export async function verifyTrimmedFeeds(args: {
  dir: string
  files: FixtureFile[]
  sourceRoots: FeedRoots
  pair: string
  chainlinkAssetId: string | null
  window: Window
  maxGapMs: number
}): Promise<FeedSeriesDigest[]> {
  const feedFiles = args.files.filter((f) => f.role !== 'telonex_delta')
  for (const f of feedFiles) {
    const sourceRoot =
      f.role === 'binance_agg_trades' ? args.sourceRoots.binance : args.sourceRoots.chainlink
    const prefix = f.role === 'binance_agg_trades' ? 'binance/' : 'chainlink/'
    const source = path.join(sourceRoot, f.path.slice(prefix.length))
    await assertOrderedSubset(source, path.join(args.dir, f.path))
  }
  const common = {
    pair: args.pair,
    chainlinkAssetId: args.chainlinkAssetId,
    window: args.window,
    maxGapMs: args.maxGapMs,
  }
  const full = await feedSeriesDigests({ ...common, roots: args.sourceRoots })
  const trimmed = await feedSeriesDigests({ ...common, roots: fixtureFeedRoots(args.dir) })
  if (JSON.stringify(full) !== JSON.stringify(trimmed)) {
    throw new Error(
      `FX-2: TS loader series differ between full and trimmed day files: full ${JSON.stringify(full)} != trimmed ${JSON.stringify(trimmed)}`,
    )
  }
  for (const f of feedFiles) {
    if (!full.some((s) => s.feed === f.role)) {
      throw new Error(`FX-2: ${f.path} belongs to no loaded feed (${f.role})`)
    }
  }
  for (const s of full) {
    let held = 0
    for (const f of feedFiles.filter((x) => x.role === s.feed)) {
      held += await parquetRowCount(path.join(args.dir, f.path))
    }
    if (held !== s.length) {
      throw new Error(
        `FX-2: trimmed ${s.feed} files hold ${held} rows, the TS series has ${s.length} (rows outside membership plus seed)`,
      )
    }
  }
  return full
}
