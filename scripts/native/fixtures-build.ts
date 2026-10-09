/**
 * Committed fixture markets generator (native/spec/60 §12 FX-1, FX-1a, FX-2,
 * FX-2a, FX-5).
 *
 *   npm run native:fixtures:build -- scan [--max-bytes N]   # read-only candidate scan
 *   npm run native:fixtures:build -- build [--slug a,b]     # (re)build + prove the selection
 *   npm run native:fixtures:build -- prove [--slug a,b]     # re-run the FX-2 proof on committed fixtures
 *   npm run native:fixtures:build -- check                  # bytes/sha256 + size cap of committed files
 *
 * `build` materializes `native/fixtures/markets/<slug>/` for every market of
 * SELECTION: the telonex-delta file (copied byte for byte, the canonical
 * input), the Binance and Chainlink day files trimmed per FX-2 (same columns,
 * types and row order; exactly the membership rows of 14 F-13/F-21 plus the
 * seed row of F-14/F-22 in the day file that holds it; one file per covered
 * day of F-12/F-20), `job.json` (an `EngineJob`, 21 §5, with fixture-relative
 * paths) and `fixture.json` (provenance, bytes and sha256 of every file, the
 * price to beat, anomaly counters and the proof results). It then runs the
 * TS engine (`runSingleMarket`, backtest mode, no persistence) on the full
 * and on the trimmed feed inputs and only moves the fixture into place when
 * both traces are byte-identical (FX-2). Without TechnicalIndicators (FX-2a).
 *
 * Reads: local dataset files under data/ (read-only) and `telonex_markets`
 * through src/db/telonexMarkets.ts only (CLAUDE.md eligibility rule). Writes
 * only under native/fixtures/markets/. Never writes MySQL, Redis or R2, and
 * never runs `npm run backtest` (which persists runs).
 */
import '../../src/config/env.js'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import type { DuckDBConnection } from '@duckdb/node-api'
import { closeDb } from '../../src/db/index.js'
import {
  listEligibleTelonexMarkets,
  summarizeTelonexEligibility,
  type Market,
} from '../../src/db/telonexMarkets.js'
import { getInMemoryDuckDb, sqlQuote } from '../../src/utils/duckdb.js'
import {
  aggTradesDayPath,
  defaultBinancePairForSymbol,
  utcDatesCovering,
} from '../../src/binance/paths.js'
import {
  CRYPTO_PRICES_COVERAGE_FROM_MS,
  assetIdForSymbol,
  cryptoPricesDayPath,
} from '../../src/telonex/cryptoPrices/paths.js'
import { gammaPriceToBeatEpochMs } from '../../src/polymarket/gammaEventMetadata.js'
import {
  symbolFromSlug,
  timeframeFromSlug,
  windowFromSlug,
} from '../../src/polymarket/upDownSlugWindow.js'
import { replayTelonexDeltaParquetForMarket } from '../../src/parquet/replay/replayTelonexDeltaParquetForMarket.js'
import { runSingleMarket, type RunSingleMarketInput } from '../../src/backtest/runSingleMarket.js'
import { isSyntheticFeedTick } from '../../src/market/syntheticTick.js'
import { ExternalFeedsRequestPlugin } from '../../src/strategy/plugins/ExternalFeedsRequestPlugin.js'
import type { StrategyDefinition } from '../../src/strategy/strategyDefinition.js'
import { definition as feedsParityProbe } from '../../src/strategies/feedsParityProbe.v1.js'
import * as prettier from 'prettier'
import * as z from 'zod'
import type { ExternalFeedsRequestConfig } from '../../src/strategy/plugins/ExternalFeedsRequestPlugin.js'
import {
  FIXTURES_DIR,
  FIXTURES_MAX_TOTAL_BYTES,
  JOB_FILE,
  MANIFEST_FILE,
  MANIFEST_VERSION,
  REPO_ROOT,
  fixtureDir,
  jsonText,
  readManifest,
  sha256File,
  verifyFixtureFiles,
  type FixtureFile,
  type FixtureManifest,
  type FixtureProofRun,
} from './fixtures-lib.js'

const GENERATOR = 'scripts/native/fixtures-build.ts'

// ---------------------------------------------------------------------------
// Spec constants
// ---------------------------------------------------------------------------

/** 11 §5.3 dated fee table, keyed by market start. */
const FEE_ERA_STARTS: Array<{ id: FixtureManifest['feeEra']; fromMs: number }> = [
  { id: 'F3', fromMs: 1_778_198_400_000 },
  { id: 'F2', fromMs: 1_774_828_800_000 },
  { id: 'F1', fromMs: 1_767_571_200_000 },
  { id: 'F0', fromMs: Number.NEGATIVE_INFINITY },
]
function feeEra(startMs: number): FixtureManifest['feeEra'] {
  return FEE_ERA_STARTS.find((e) => startMs >= e.fromMs)!.id
}

/** 14 §4.3: lookback and tails are engine constants (TS: wireBacktestExternalFeeds.ts DEFAULT_LOOKBACK_MS, the sources' SERIES_TAIL_MS). */
const LOOKBACK_MS = 300_000
const BINANCE_TAIL_MS = 2_000
const CHAINLINK_TAIL_MS = 5_000

/** Model config every fixture job carries (21 §6; committed ts-compat default). */
const MODEL_CONFIG_FILE = path.join(
  REPO_ROOT,
  'native/contract/model-configs/ts-compat-default.json',
)

// D-PENDING: 60 §5.1 names the Rust exerciser `engine-exerciser.rs`, while the
// contract fixture native/contract/fixtures/jobs/valid/telonex-delta-ts-compat.json
// uses `engine-exerciser.v2.rs`. The spec id is used; `native:fixture-job --strategy-id` overrides.
const DEFAULT_STRATEGY_ID = 'engine-exerciser.rs'

// ---------------------------------------------------------------------------
// Selection (found with `scan`; see native/fixtures/markets/README.md)
// ---------------------------------------------------------------------------

type Selected = { slug: string; roles: string[]; why: string }

const SELECTION: Selected[] = [
  {
    slug: 'btc-updown-15m-1773969300',
    roles: ['fee-era:F1'],
    why: 'F1 (PriceWeighted fee era), before Chainlink coverage; price to beat fed; a small eligible file (174 KB, 11,122 rows) with rows across the whole window.',
  },
  {
    slug: 'btc-updown-15m-1776556800',
    roles: ['fee-era:F2', 'chainlink', 'midnight-start'],
    why: 'F2 inside Chainlink coverage; window starts at 00:00 UTC, so the lookback crosses midnight: two Binance and two Chainlink day files, seeds in the previous day (14 F-12, F-14, F-20, F-22).',
  },
  {
    slug: 'btc-updown-15m-1787730300',
    roles: ['fee-era:F3', 'chainlink'],
    why: 'F3 inside Chainlink coverage; a small eligible file (185 KB, 15,503 rows) with rows across the whole window.',
  },
  {
    slug: 'btc-updown-15m-1777152600',
    roles: ['edge:crossed-book', 'edge:local-clock-backwards', 'fee-era:F2', 'chainlink'],
    why: 'Edge market: the most crossed-book ticks (574) among the scanned F2/F3 files up to 600 KB with local time stepping backwards (8 steps); 15 §8 crossedBookTicks, localClockBackwards. Found by `scan --max-bytes 600000`.',
  },
  {
    slug: 'btc-updown-5m-1770870900',
    roles: ['5m', 'fee-era:F1'],
    why: 'BTC 5m (local 5m telonex files exist, D38): the smallest local 5m file with at least 1,000 in-window rows; before the 5m price-to-beat epoch (absent_pre_series_epoch) and before Chainlink coverage.',
  },
  {
    slug: 'btc-updown-5m-1770875700',
    roles: ['5m', 'fee-era:F1', 'edge:local-clock-backwards'],
    why: 'Second BTC 5m market: the next smallest active 5m file, with crossed books and a backward local-clock step.',
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rel(abs: string): string {
  return path.relative(REPO_ROOT, abs).split(path.sep).join('/')
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

async function rows(sql: string): Promise<unknown[][]> {
  const conn = await duck()
  const res = await conn.run(sql)
  return (await res.getRows()) as unknown[][]
}

async function parquetRowCount(file: string): Promise<number> {
  return num((await rows(`SELECT count(*) FROM read_parquet(${sqlQuote(file)})`))[0]![0])
}

/** Column names and DuckDB types plus parquet physical types, for the "same columns and types" check. */
async function schemaFingerprint(file: string): Promise<string> {
  const logical = await rows(`DESCRIBE SELECT * FROM read_parquet(${sqlQuote(file)})`)
  const physical = await rows(
    `SELECT name, type, repetition_type FROM parquet_schema(${sqlQuote(file)}) WHERE type IS NOT NULL`,
  )
  return JSON.stringify({ logical: logical.map((r) => [r[0], r[1]]), physical })
}

async function fileEntry(args: {
  role: FixtureFile['role']
  dir: string
  relPath: string
  day: string | null
  source: string
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
      path: rel(args.source),
      bytes: statSync(args.source).size,
      sha256: await sha256File(args.source),
      rows: await parquetRowCount(args.source),
    },
    trim: args.trim,
  }
}

// ---------------------------------------------------------------------------
// Catalog lookup (read-only, through src/db/telonexMarkets.ts)
// ---------------------------------------------------------------------------

function requiredFeedsFor(startMs: number, slug: string): ExternalFeedsRequestConfig {
  const ptbFed = startMs >= gammaPriceToBeatEpochMs(symbolFromSlug(slug), timeframeFromSlug(slug))
  return {
    binanceWsSpotPrice: {},
    ...(startMs >= CRYPTO_PRICES_COVERAGE_FROM_MS ? { rtdsCryptoPrices: {} } : {}),
    ...(ptbFed ? { polymarketPriceToBeat: { enabled: true } } : {}),
  }
}

type FeedCheck = 'usable' | 'unverified' | 'not_required'

/**
 * The market's catalog row, eligible under the strategy-free rules
 * (delta-typed, local, resolved) and with no feed known unusable. A feed the
 * catalog has not verified yet (`*_usable IS NULL`, e.g. every BTC 5m market)
 * is accepted and recorded as `unverified`: the FX-2 proof loads that feed
 * through the TS loaders, which fail loudly on missing or empty data.
 */
async function catalogRow(
  slug: string,
  startMs: number,
): Promise<{ row: Market; feedChecks: Record<'binance' | 'chainlink', FeedCheck> }> {
  const base = {
    converter: 'delta-typed' as const,
    readFrom: 'local' as const,
    slugs: [slug],
    fromMs: 0,
  }
  const requiredFeeds = requiredFeedsFor(startMs, slug)
  const summary = await summarizeTelonexEligibility({ ...base, requiredFeeds })
  if (summary.total !== 1) throw new Error(`${slug}: not eligible (delta-typed, local, resolved)`)
  if (summary.binanceUnusable || summary.chainlinkUnusable || summary.priceToBeatMissing) {
    throw new Error(
      `${slug}: a required feed is unusable or the price to beat is missing: ${JSON.stringify(summary)}`,
    )
  }
  const found = await listEligibleTelonexMarkets({ ...base, limit: 2 })
  if (found.length !== 1) throw new Error(`${slug}: expected one catalog row, got ${found.length}`)
  const check = (required: boolean, unverified: number): FeedCheck =>
    !required ? 'not_required' : unverified > 0 ? 'unverified' : 'usable'
  return {
    row: found[0]!,
    feedChecks: {
      binance: check(true, summary.binanceUnverified),
      chainlink: check(requiredFeeds.rtdsCryptoPrices !== undefined, summary.chainlinkUnverified),
    },
  }
}

// ---------------------------------------------------------------------------
// Telonex input checks and anomaly counters
// ---------------------------------------------------------------------------

async function telonexIdentity(
  file: string,
  tokens: { UP: string; DOWN: string },
): Promise<string> {
  const markets = await rows(`SELECT DISTINCT market FROM read_parquet(${sqlQuote(file)})`)
  if (markets.length !== 1 || typeof markets[0]![0] !== 'string') {
    throw new Error(`${file}: expected one constant market column (15 I-18), got ${markets.length}`)
  }
  const assets = await rows(
    `SELECT DISTINCT a FROM (SELECT asset0_id AS a FROM read_parquet(${sqlQuote(file)})
       UNION ALL SELECT asset1_id FROM read_parquet(${sqlQuote(file)})) WHERE a IS NOT NULL AND trim(a) <> ''`,
  )
  for (const [a] of assets) {
    if (a !== tokens.UP && a !== tokens.DOWN) throw new Error(`${file}: foreign asset ${String(a)}`)
  }
  return markets[0]![0]
}

async function anomalies(
  file: string,
  window: { startMs: number; endMs: number },
): Promise<FixtureManifest['anomalies']> {
  const [r] = await rows(`
    WITH t AS (
      SELECT ts_local_ms, ts_exchange_ms,
        lag(ts_local_ms) OVER (ORDER BY file_row_number) AS pl,
        lag(ts_exchange_ms) OVER (ORDER BY file_row_number) AS pe
      FROM read_parquet(${sqlQuote(file)}, file_row_number = true))
    SELECT count(*),
      count(*) FILTER (WHERE ts_exchange_ms BETWEEN ${window.startMs} AND ${window.endMs}),
      count(*) FILTER (WHERE ts_local_ms > 0 AND pl > 0 AND ts_local_ms < pl),
      count(*) FILTER (WHERE ts_exchange_ms < pe)
    FROM t`)
  let crossed = 0
  let locked = 0
  await replayTelonexDeltaParquetForMarket({
    filePath: file,
    onSnapshot: (snap) => {
      let c = false
      let l = false
      for (const b of Object.values(snap.byAssetId)) {
        if (b.bestBid === null || b.bestAsk === null) continue
        if (b.bestBid > b.bestAsk) c = true
        else if (b.bestBid === b.bestAsk) l = true
      }
      if (c) crossed += 1
      if (l) locked += 1
    },
  })
  return {
    rows: num(r![0]),
    inWindowRows: num(r![1]),
    localClockBackwards: num(r![2]),
    exchangeClockBackwards: num(r![3]),
    crossedBookTicks: crossed,
    lockedBookTicks: locked,
  }
}

// ---------------------------------------------------------------------------
// FX-2 trimming
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

async function writeTrimmed(args: {
  source: string
  dest: string
  membership: string
  seed: SeedRow | null
  compression: 'zstd' | 'snappy'
}): Promise<{ membershipRows: number; holdsSeed: boolean }> {
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
  if ((await schemaFingerprint(args.dest)) !== (await schemaFingerprint(args.source))) {
    throw new Error(`${args.dest}: schema differs from ${args.source}`)
  }
  return { membershipRows, holdsSeed }
}

async function trimBinance(args: {
  dir: string
  pair: string
  window: { startMs: number; endMs: number }
}): Promise<{ files: FixtureFile[]; seedAggTradeId: number | null }> {
  const fromMs = args.window.startMs - LOOKBACK_MS
  const days = utcDatesCovering(fromMs, args.window.endMs) // F-12
  const sources = days.map((d) => aggTradesDayPath(args.pair, d))
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
    const relPath = `binance/aggTrades/${args.pair}/${path.basename(sources[i]!)}`
    const trim = await writeTrimmed({
      source: sources[i]!,
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
        source: sources[i]!,
        trim,
      }),
    )
  }
  assertSeedPlaced(files, seed, `binance ${args.pair}`)
  return { files, seedAggTradeId: seed ? seed.key[0]! : null }
}

async function trimChainlink(args: {
  dir: string
  assetId: string
  window: { startMs: number; endMs: number }
}): Promise<{ files: FixtureFile[]; seedRoundUs: number | null; seedBroadcastUs: number | null }> {
  const fromMs = args.window.startMs - LOOKBACK_MS
  const days = utcDatesCovering(Math.max(fromMs, CRYPTO_PRICES_COVERAGE_FROM_MS), args.window.endMs) // F-20
  const sources = days.map((d) => cryptoPricesDayPath(args.assetId, d))
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
    const relPath = `chainlink/${args.assetId}/${path.basename(sources[i]!)}`
    const trim = await writeTrimmed({
      source: sources[i]!,
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
        source: sources[i]!,
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
// FX-2 proof: TS traces on full vs trimmed inputs
// ---------------------------------------------------------------------------

/**
 * Interim feed probe for markets before Chainlink coverage, where every
 * existing all-feeds TS strategy hard-errors by policy (14 F-19). Same shape
 * as feedsParityProbe.v1 minus Chainlink: Binance + price to beat, no intents.
 * Replaced by the TS feed-exerciser twin (60 §5.8, `chainlink: false`).
 */
const ProbeSchema = z.strictObject({
  tickOnUpdate: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true')
    .default(false),
})
const preCoverageProbe: StrategyDefinition<z.infer<typeof ProbeSchema>> = {
  id: 'fixtures-feed-probe.binance-ptb',
  schema: ProbeSchema,
  create: (cfg) => ({
    strategy: {
      name: 'fixtures-feed-probe.binance-ptb',
      onMarketTick: () => [],
      onAccountEvent: () => [],
    },
    plugins: [
      new ExternalFeedsRequestPlugin({
        binanceWsSpotPrice: cfg.tickOnUpdate ? { tickOnUpdate: true } : {},
        polymarketPriceToBeat: { enabled: true },
      }),
    ],
  }),
}

const replacer = (_k: string, v: unknown): unknown => (typeof v === 'bigint' ? v.toString() : v)

type FeedRoots = { binance: string; chainlink: string }

/** Pins every feed knob to the ts-compat model config so env cannot change the proof. */
function pinFeedEnv(roots: FeedRoots): void {
  process.env.BINANCE_DATA_BASE_DIR = roots.binance
  process.env.TELONEX_CRYPTO_PRICES_BASE_DIR = roots.chainlink
  process.env.BACKTEST_BINANCE_FEED_LOOKBACK_MS = String(LOOKBACK_MS)
  process.env.BACKTEST_RTDS_CHAINLINK_LOOKBACK_MS = String(LOOKBACK_MS)
  process.env.BACKTEST_BINANCE_FEED_LATENCY_MS = '110'
  process.env.BACKTEST_RTDS_CHAINLINK_LATENCY_MS = '320'
  process.env.BACKTEST_PRICE_TO_BEAT_LATENCY_MS = '2700'
  process.env.BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS = '300000'
  delete process.env.FEEDS_PARITY_OUT
  delete process.env.BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS
}

async function tsTrace(args: {
  manifest: FixtureManifest
  telonexFile: string
  roots: FeedRoots
  definition: StrategyDefinition<unknown>
  params: Record<string, unknown>
}): Promise<Omit<FixtureProofRun, 'strategyId' | 'params'>> {
  pinFeedEnv(args.roots)
  const hash = createHash('sha256')
  let lines = 0
  let ticks = 0
  let syntheticTicks = 0
  let tick: { kind: string; ts: number; local: number | null; feeds: string } | null = null
  const emit = (line: string): void => {
    hash.update(line)
    hash.update('\n')
    lines += 1
  }
  const observer: NonNullable<RunSingleMarketInput['observer']> = {
    onTickStart: (t) => {
      ticks += 1
      if (isSyntheticFeedTick(t.msg)) syntheticTicks += 1
      tick = {
        kind: t.msg.event_type,
        ts: t.snapshot.timestamp,
        local: t.source.kind === 'parquet' ? (t.source.tsLocalMs ?? null) : null,
        feeds: 'null',
      }
    },
    onContext: (ctx) => {
      // Serialize at once: the provider may hand out a mutable view.
      if (tick) tick.feeds = JSON.stringify(ctx?.plugins?.['externalFeeds'] ?? null, replacer)
    },
    onDecision: (origin, intents) => emit(JSON.stringify({ decision: origin, intents }, replacer)),
    onAccountEvent: (event) => emit(JSON.stringify({ account: event }, replacer)),
    onTickEnd: () => {
      if (!tick) return
      emit(
        `{"tick":${JSON.stringify(tick.kind)},"ts":${tick.ts},"local":${tick.local},"feeds":${tick.feeds}}`,
      )
      tick = null
    },
  }
  const m = args.manifest
  const out = await runSingleMarket({
    idx: 0,
    filePath: args.telonexFile,
    slug: m.slug,
    marketMeta: undefined,
    marketResolution: {
      tokenMap: { UP: m.tokenIds.UP, DOWN: m.tokenIds.DOWN },
      outcome: m.outcome,
    },
    strategyId: args.definition.id,
    strategyParams: args.params,
    strategyDefinition: args.definition,
    inputMode: 'telonex-delta',
    order: 'recorded',
    timeDriven: false,
    latency: { delayMs: 0, jitterMs: 0 },
    strategyWindow: m.window,
    machineId: 'fixtures-build',
    commitSha: 'fixtures-build',
    gammaPriceToBeat: { priceToBeat: m.priceToBeat.value, syncedAtMs: m.priceToBeat.syncedAtMs },
    observer,
  })
  const stats = out.marketStats ? { ...out.marketStats, execution: null } : null
  const outputText = JSON.stringify(
    {
      marketStats: stats,
      eventsProcessed: out.eventsProcessed,
      eventsByType: out.eventsByType,
      skipReason: out.skipReason ?? null,
    },
    replacer,
  )
  return {
    traceSha256: hash.digest('hex'),
    traceLines: lines,
    ticks,
    syntheticTicks,
    outputSha256: createHash('sha256').update(outputText).digest('hex'),
  }
}

const FULL_ROOTS: FeedRoots = {
  binance: path.join(REPO_ROOT, 'data/binance'),
  chainlink: path.join(REPO_ROOT, 'data/telonex/crypto_prices'),
}

/** Runs the FX-2 proof for one fixture directory; throws on any difference. */
async function prove(dir: string, manifest: FixtureManifest): Promise<FixtureProofRun[]> {
  const telonexFile = path.join(dir, manifest.files.find((f) => f.role === 'telonex_delta')!.path)
  const trimmedRoots: FeedRoots = {
    binance: path.join(dir, 'binance'),
    chainlink: path.join(dir, 'chainlink'),
  }
  const definition = (
    manifest.chainlinkCoverage ? feedsParityProbe : preCoverageProbe
  ) as StrategyDefinition<unknown>
  const results: FixtureProofRun[] = []
  for (const tickOnUpdate of [false, true]) {
    const params = definition.schema.parse({ tickOnUpdate }) as Record<string, unknown>
    const full = await tsTrace({ manifest, telonexFile, roots: FULL_ROOTS, definition, params })
    const trimmed = await tsTrace({
      manifest,
      telonexFile,
      roots: trimmedRoots,
      definition,
      params,
    })
    if (JSON.stringify(full) !== JSON.stringify(trimmed)) {
      throw new Error(
        `${manifest.slug}: FX-2 proof failed (tickOnUpdate=${tickOnUpdate}): full ${JSON.stringify(full)} != trimmed ${JSON.stringify(trimmed)}`,
      )
    }
    console.log(
      `[fixtures] ${manifest.slug} proof ${definition.id} tickOnUpdate=${tickOnUpdate}: ` +
        `trace ${full.traceSha256.slice(0, 16)} lines=${full.traceLines} synthetic=${full.syntheticTicks} (full == trimmed)`,
    )
    results.push({ strategyId: definition.id, params: { tickOnUpdate }, ...full })
  }
  return results
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

async function buildOne(sel: Selected): Promise<void> {
  // Source day files resolve under the machine's data roots (the proof
  // repoints the roots at the trimmed copies; reset them first).
  pinFeedEnv(FULL_ROOTS)
  const window = windowFromSlug(sel.slug)
  const symbol = symbolFromSlug(sel.slug)
  const timeframe = timeframeFromSlug(sel.slug)
  if (!window || symbol !== 'btc' || (timeframe !== '5m' && timeframe !== '15m')) {
    throw new Error(`${sel.slug}: not a BTC 5m/15m up/down slug`)
  }
  const { row, feedChecks } = await catalogRow(sel.slug, window.startMs)
  if (!row.dataset || !row.assetId0 || !row.assetId1)
    throw new Error(`${sel.slug}: catalog row incomplete`)
  if (row.marketStartMs !== window.startMs) throw new Error(`${sel.slug}: market_start_ms mismatch`)
  const outcome = row.resultId === '0' ? 'UP' : row.resultId === '1' ? 'DOWN' : null
  if (!outcome) throw new Error(`${sel.slug}: unresolved (result_id=${row.resultId})`)
  const tokenIds = { UP: row.assetId0, DOWN: row.assetId1 }
  const source = path.resolve(REPO_ROOT, row.dataset)
  if (row.conversionSizeBytes !== null && statSync(source).size !== row.conversionSizeBytes) {
    throw new Error(
      `${sel.slug}: local file size differs from telonex_market_conversions.size_bytes`,
    )
  }

  const ptbEpoch = gammaPriceToBeatEpochMs(symbol, timeframe)
  let ptbStatus: FixtureManifest['priceToBeat']['status']
  if (row.priceToBeat !== null) ptbStatus = 'fed'
  else if (window.startMs < ptbEpoch) ptbStatus = 'absent_pre_series_epoch'
  else
    throw new Error(`${sel.slug}: post-epoch market without a price to beat; pick another market`)

  const staging = path.join(FIXTURES_DIR, '.staging', sel.slug)
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(path.join(staging, 'telonex-delta'), { recursive: true })

  const telonexRel = `telonex-delta/${sel.slug}.parquet`
  copyFileSync(source, path.join(staging, telonexRel))
  const conditionId = await telonexIdentity(path.join(staging, telonexRel), tokenIds)
  const files: FixtureFile[] = [
    await fileEntry({
      role: 'telonex_delta',
      dir: staging,
      relPath: telonexRel,
      day: null,
      source,
      trim: null,
    }),
  ]
  if (files[0]!.sha256 !== files[0]!.source.sha256)
    throw new Error(`${sel.slug}: copy differs from source`)

  const pair = defaultBinancePairForSymbol(symbol)
  const binance = await trimBinance({ dir: staging, pair, window })
  files.push(...binance.files)
  const chainlinkCoverage = window.startMs >= CRYPTO_PRICES_COVERAGE_FROM_MS
  const assetId = assetIdForSymbol(symbol)
  const chainlink = chainlinkCoverage
    ? await trimChainlink({ dir: staging, assetId, window })
    : null
  if (chainlink) files.push(...chainlink.files)

  const manifest: FixtureManifest = {
    manifestVersion: MANIFEST_VERSION,
    generator: GENERATOR,
    slug: sel.slug,
    timeframe,
    window,
    feeEra: feeEra(window.startMs),
    chainlinkCoverage,
    catalogFeedChecks: feedChecks,
    roles: sel.roles,
    selection: sel.why,
    conditionId,
    tokenIds,
    outcome,
    priceToBeat: {
      value: row.priceToBeat,
      syncedAtMs: row.gammaMetadataSyncedAt ? row.gammaMetadataSyncedAt.getTime() : null,
      status: ptbStatus,
    },
    feeds: {
      lookbackMs: LOOKBACK_MS,
      binance: { pair, tailMs: BINANCE_TAIL_MS, seedAggTradeId: binance.seedAggTradeId },
      chainlink: chainlink
        ? {
            assetId,
            tailMs: CHAINLINK_TAIL_MS,
            seedRoundUs: chainlink.seedRoundUs,
            seedBroadcastUs: chainlink.seedBroadcastUs,
          }
        : null,
    },
    anomalies: await anomalies(path.join(staging, telonexRel), window),
    files,
    proof: [],
  }
  manifest.proof = await prove(staging, manifest)

  writeFileSync(path.join(staging, JOB_FILE), await committedJson(engineJob(manifest), JOB_FILE))
  writeFileSync(path.join(staging, MANIFEST_FILE), await committedJson(manifest, MANIFEST_FILE))
  const dest = fixtureDir(sel.slug)
  rmSync(dest, { recursive: true, force: true })
  renameSync(staging, dest)
  console.log(`[fixtures] ${sel.slug}: ${files.length} files, ${dirBytes(dest)} bytes`)
}

/**
 * `EngineJob` (21 §5) with fixture-relative paths (FX-1a); `native:fixture-job`
 * renders the absolute-path job. Feed day files have no sha256 field in the
 * contract (`FeedFile`), so their sha256 lives in fixture.json.
 * D-PENDING: FX-2 says "the job records each trimmed file's byte size and
 * sha256"; 21 §5 `feedFiles[]` has only `bytes`.
 */
function engineJob(m: FixtureManifest): unknown {
  const modelConfig = JSON.parse(readFileSync(MODEL_CONFIG_FILE, 'utf8')) as unknown
  const input = m.files.find((f) => f.role === 'telonex_delta')!
  return {
    jobSchemaVersion: 1,
    run: {
      strategyId: DEFAULT_STRATEGY_ID,
      inputMode: 'telonex-delta',
      modelConfig,
      candidates: [{ key: 'fixture', index: 0, params: {}, execution: null }],
    },
    market: {
      slug: m.slug,
      // D-PENDING: 15 I-18 takes this from telonex_markets.market_id, which
      // src/db/telonexMarkets.ts does not expose yet; the file's constant
      // `market` column (the same condition id) is used.
      conditionId: m.conditionId,
      window: m.window,
      tokenIds: m.tokenIds,
      outcome: m.outcome,
      rules: { snapshotParserVersion: null, captured: {}, disagreements: 0 },
      gammaPriceToBeat: { priceToBeat: m.priceToBeat.value, syncedAtMs: m.priceToBeat.syncedAtMs },
      feedAvailability: { priceToBeat: { status: m.priceToBeat.status } },
      input: {
        path: input.path,
        bytes: input.bytes,
        sha256: input.sha256,
        format: { name: 'telonex-delta-typed', version: 1 },
      },
      recorderV4: null,
      ownActivity: null,
      feedFiles: m.files
        .filter((f) => f.role !== 'telonex_delta')
        .map((f) => ({
          feed: f.role,
          symbol:
            f.role === 'binance_agg_trades' ? m.feeds.binance.pair : m.feeds.chainlink!.assetId,
          day: f.day,
          path: f.path,
          bytes: f.bytes,
        })),
    },
    outputs: { tracePath: null, traceLevel: 'decisions', ledgerPath: null },
    budget: { wallMs: 120000, threads: 1 },
  }
}

/**
 * JSON as committed: the repo's pre-commit hook runs prettier on staged JSON,
 * so the generator writes prettier's form and a rebuild stays byte-identical.
 */
async function committedJson(value: unknown, name: string): Promise<string> {
  const target = path.join(FIXTURES_DIR, name)
  const options = (await prettier.resolveConfig(target)) ?? {}
  return prettier.format(jsonText(value), { ...options, filepath: target })
}

function dirBytes(dir: string): number {
  let total = 0
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) total += statSync(path.join(e.parentPath, e.name)).size
  }
  return total
}

function committedSlugs(): string[] {
  if (!existsSync(FIXTURES_DIR)) return []
  return readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort()
}

async function check(): Promise<void> {
  let total = 0
  for (const slug of committedSlugs()) {
    const manifest = readManifest(slug)
    await verifyFixtureFiles(slug, manifest)
    const bytes = dirBytes(fixtureDir(slug))
    total += bytes
    console.log(`[fixtures] ${slug}: OK (${manifest.files.length} files, ${bytes} bytes)`)
  }
  for (const f of ['README.md', '.gitignore']) {
    const p = path.join(FIXTURES_DIR, f)
    if (existsSync(p)) total += statSync(p).size
  }
  console.log(
    `[fixtures] total ${total} bytes (${(total / 1024 / 1024).toFixed(2)} MiB, cap 25 MiB)`,
  )
  if (total > FIXTURES_MAX_TOTAL_BYTES)
    throw new Error('fixture total exceeds the 25 MiB cap (FX-2)')
}

// ---------------------------------------------------------------------------
// scan (read-only): candidates per fee era and edge markets
// ---------------------------------------------------------------------------

const SCAN_MIN_IN_WINDOW = 1_000

async function scan(maxBytes: number): Promise<void> {
  const eras: Array<{ id: string; fromMs: number; toMs: number; timeframe: '5m' | '15m' }> = [
    {
      id: 'F1',
      fromMs: Date.parse('2026-02-18T23:45:00Z'),
      toMs: 1_774_828_800_000 - 1,
      timeframe: '15m',
    },
    {
      id: 'F2',
      fromMs: CRYPTO_PRICES_COVERAGE_FROM_MS,
      toMs: 1_778_198_400_000 - 1,
      timeframe: '15m',
    },
    { id: 'F3', fromMs: 1_778_198_400_000, toMs: Number.MAX_SAFE_INTEGER, timeframe: '15m' },
    { id: '5m', fromMs: 0, toMs: Number.MAX_SAFE_INTEGER, timeframe: '5m' },
  ]
  for (const era of eras) {
    const markets = await listEligibleTelonexMarkets({
      symbol: 'btc',
      timeframe: era.timeframe,
      converter: 'delta-typed',
      readFrom: 'local',
      fromMs: era.fromMs,
      toMs: era.toMs,
      limit: 100_000,
      // The catalog has not verified the Binance feed of BTC 5m markets yet
      // (binance_usable IS NULL), so 5m candidates are listed without feed gates.
      ...(era.timeframe === '15m'
        ? {
            requiredFeeds: requiredFeedsFor(
              era.fromMs,
              `btc-updown-${era.timeframe}-${Math.floor(era.fromMs / 1000)}`,
            ),
          }
        : {}),
    })
    const local = markets.flatMap((m) => {
      const p = path.resolve(REPO_ROOT, m.dataset ?? '')
      return existsSync(p) && statSync(p).size <= maxBytes
        ? [{ slug: m.slug, file: p, bytes: statSync(p).size }]
        : []
    })
    console.log(
      `== ${era.id}: ${markets.length} eligible, ${local.length} local files <= ${maxBytes} bytes`,
    )
    // "Active" = at least SCAN_MIN_IN_WINDOW rows inside the window (tiny files
    // are mostly pre-window rows of a market Telonex barely recorded).
    const active: Array<{ line: string; a: FixtureManifest['anomalies'] }> = []
    for (const c of local.sort((x, y) => x.bytes - y.bytes)) {
      const a = await anomalies(c.file, windowFromSlug(c.slug)!)
      if (a.inWindowRows < SCAN_MIN_IN_WINDOW) continue
      const line = `${c.slug} bytes=${c.bytes} rows=${a.rows} inWindow=${a.inWindowRows} localBack=${a.localClockBackwards} exchBack=${a.exchangeClockBackwards} crossed=${a.crossedBookTicks} locked=${a.lockedBookTicks}`
      active.push({ line, a })
    }
    console.log(`  smallest active files (inWindow >= ${SCAN_MIN_IN_WINDOW}):`)
    for (const { line } of active.slice(0, 5)) console.log(`    ${line}`)
    const edges = active
      .filter(({ a }) => a.crossedBookTicks > 0 && a.localClockBackwards > 0)
      .sort((x, y) => y.a.crossedBookTicks - x.a.crossedBookTicks)
    console.log(`  edge candidates (crossed book and local clock backwards): ${edges.length}`)
    for (const { line } of edges.slice(0, 5)) console.log(`    ${line}`)
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  if (i < 0) return undefined
  const v = argv[i + 1]
  if (v === undefined || v.startsWith('--')) throw new Error(`missing value for ${name}`)
  return v
}

async function main(): Promise<void> {
  const [cmd, ...argv] = process.argv.slice(2)
  const known = new Set(['--slug', '--max-bytes'])
  for (const a of argv)
    if (a.startsWith('--') && !known.has(a)) throw new Error(`unknown flag ${a}`)
  const slugFilter = flag(argv, '--slug')?.split(',')
  try {
    if (cmd === 'scan') {
      await scan(Number(flag(argv, '--max-bytes') ?? 600_000))
    } else if (cmd === 'build') {
      const picked = slugFilter ? SELECTION.filter((s) => slugFilter.includes(s.slug)) : SELECTION
      if (slugFilter && picked.length !== slugFilter.length)
        throw new Error('unknown --slug (not in SELECTION)')
      for (const sel of picked) await buildOne(sel)
      if (!slugFilter) {
        // A full build owns the directory: drop fixtures no longer selected.
        for (const slug of committedSlugs()) {
          if (!SELECTION.some((s) => s.slug === slug)) {
            rmSync(fixtureDir(slug), { recursive: true, force: true })
            console.log(`[fixtures] ${slug}: removed (not in SELECTION)`)
          }
        }
      }
      rmSync(path.join(FIXTURES_DIR, '.staging'), { recursive: true, force: true })
      await check()
    } else if (cmd === 'prove') {
      for (const slug of slugFilter ?? committedSlugs()) {
        const manifest = readManifest(slug)
        await verifyFixtureFiles(slug, manifest)
        const proof = await prove(fixtureDir(slug), manifest)
        if (JSON.stringify(proof) !== JSON.stringify(manifest.proof)) {
          throw new Error(
            `${slug}: proof differs from the committed fixture.json (TS changed? regenerate, FX-3)`,
          )
        }
      }
    } else if (cmd === 'check') {
      await check()
    } else {
      throw new Error(
        'usage: fixtures-build.ts scan|build|prove|check [--slug a,b] [--max-bytes N]',
      )
    }
  } finally {
    await closeDb()
  }
}

await main()
