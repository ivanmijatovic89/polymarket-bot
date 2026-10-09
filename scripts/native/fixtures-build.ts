/**
 * Committed fixture markets generator (native/spec/60 §12 FX-1, FX-1a, FX-2,
 * FX-2a, FX-3, FX-5).
 *
 *   npm run native:fixtures:build -- scan [--max-bytes N] [--data-root DIR]    # read-only candidate scan
 *   npm run native:fixtures:build -- build [--slug a,b | --prune] [--data-root DIR]  # (re)build + prove
 *   npm run native:fixtures:build -- prove [--slug a,b] [--data-root DIR]      # re-run the proof on committed fixtures
 *   npm run native:fixtures:build -- check                                      # offline integrity check (CI)
 *   npm run native:fixtures:build -- jobs                                       # rewrite job.json from fixture.json
 *
 * `--data-root` defaults to `<repository root>/data` (01 §6 M1 step 1).
 *
 * `build` materializes `native/fixtures/markets/<slug>/` for every market of
 * SELECTION: the telonex-delta file (copied byte for byte, the canonical
 * input), the Binance and Chainlink day files trimmed per FX-2
 * (`fixtures-feeds.ts`), `job.json` (an `EngineJob`, 21 §5, for the engine
 * exerciser, fixture-relative paths) and `fixture.json` (GF-2 header,
 * provenance, bytes and sha256 of every file, the price to beat, anomaly
 * counters and the proof). The proof (`prove`) checks the trimmed rows
 * against their sources and the TS loaders, then runs the TS engine
 * (`fixtures-oracle.ts`, one child per run under the OR-7 environment) on the
 * full and on the trimmed feed inputs; the fixture is installed only when
 * everything is identical (FX-2). Without TechnicalIndicators (FX-2a).
 *
 * Reads: dataset files under the data root (read-only) and `telonex_markets`
 * through src/db/telonexMarkets.ts only (CLAUDE.md eligibility rule). Writes
 * only under native/fixtures/markets/ and the OS temp dir (oracle requests).
 * Never writes MySQL, Redis or R2, and never runs `npm run backtest`.
 */
import '../../src/config/env.js'
import { spawn, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as z from 'zod'
import { closeDb } from '../../src/db/index.js'
import {
  listEligibleTelonexMarkets,
  summarizeTelonexEligibility,
  type Market,
} from '../../src/db/telonexMarkets.js'
import { sqlQuote } from '../../src/utils/duckdb.js'
import { defaultBinancePairForSymbol } from '../../src/binance/paths.js'
import {
  CRYPTO_PRICES_COVERAGE_FROM_MS,
  assetIdForSymbol,
} from '../../src/telonex/cryptoPrices/paths.js'
import { gammaPriceToBeatEpochMs } from '../../src/polymarket/gammaEventMetadata.js'
import {
  symbolFromSlug,
  timeframeFromSlug,
  windowFromSlug,
} from '../../src/polymarket/upDownSlugWindow.js'
import { replayTelonexDeltaParquetForMarket } from '../../src/parquet/replay/replayTelonexDeltaParquetForMarket.js'
import type { ExternalFeedsRequestConfig } from '../../src/strategy/plugins/ExternalFeedsRequestPlugin.js'
import {
  ENGINE_PATHS_FILE,
  OR2_FALLBACK_ENGINE_PATHS,
  OR7_KNOBS,
  parseEnginePathsFile,
} from './oracle-env-audit.js'
import {
  FIXTURES_DIR,
  FIXTURES_MAX_TOTAL_BYTES,
  FixtureProofRunSchema,
  GENERATED_ENTRIES,
  GENERATOR,
  JOB_FILE,
  MANIFEST_FILE,
  MANIFEST_VERSION,
  REPO_ROOT,
  committedJob,
  committedJson,
  committedSlugs,
  fixtureDir,
  generatorSha256,
  jsonText,
  readManifest,
  readModelConfig,
  verifyFixtureFiles,
  type FixtureFile,
  type FixtureManifest,
  type FixtureProofRun,
} from './fixtures-lib.js'
import {
  BINANCE_TAIL_MS,
  CHAINLINK_TAIL_MS,
  LOOKBACK_MS,
  dataFeedRoots,
  fileEntry,
  fixtureFeedRoots,
  rows,
  sourceLabel,
  trimBinance,
  trimChainlink,
  verifyTrimmedFeeds,
  type FeedRoots,
} from './fixtures-feeds.js'

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
    why: 'Edge market: the most crossed-or-locked book ticks (15 §8 crossedBookTicks, 587; 574 of them strictly crossed) among the scanned F2/F3 files up to 600 KB with local time stepping backwards (8 steps, 15 §8 localClockBackwards). Found by `scan --max-bytes 600000`.',
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

function num(v: unknown): number {
  if (typeof v === 'bigint') {
    const n = Number(v)
    if (!Number.isSafeInteger(n)) throw new Error(`integer out of safe range: ${v}`)
    return n
  }
  if (typeof v === 'number') return v
  throw new Error(`expected a number, got ${typeof v}`)
}

function git(args: string[]): string {
  const r = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`)
  return r.stdout.trim()
}

/** The Telonex dataset path of a catalog row under the data root (`dataset` is `data/…`, repo-relative). */
function telonexSource(dataRoot: string, dataset: string): string {
  if (!dataset.startsWith('data/')) {
    throw new Error(
      `telonex dataset path ${dataset} is not under data/; cannot map it to --data-root`,
    )
  }
  return path.join(dataRoot, dataset.slice('data/'.length))
}

// ---------------------------------------------------------------------------
// Oracle pin and tree (60 OR-1, OR-3, FX-3)
// ---------------------------------------------------------------------------

/** OR-1: the origin/main commit last merged into this branch. */
function currentPin(): string {
  return git(['merge-base', 'HEAD', 'origin/main'])
}

function enginePaths(): string[] {
  const file = path.join(REPO_ROOT, ENGINE_PATHS_FILE)
  return existsSync(file)
    ? parseEnginePathsFile(readFileSync(file, 'utf8'))
    : [...OR2_FALLBACK_ENGINE_PATHS]
}

/** Engine-path files that differ between two commits (OR-2 paths). */
function engineDiff(from: string, to: string): string[] {
  const out = git(['diff', '--name-only', from, to, '--', ...enginePaths()])
  return out === '' ? [] : out.split('\n')
}

/**
 * OR-3: the TS engine paths at HEAD equal the pin and the working tree is
 * clean there, so the proof hashes belong to the pin. (No oracle allowlist
 * file exists on this branch yet; when it does, its entries are tolerated.)
 */
function assertOracleTree(pin: string): void {
  const allowFile = path.join(REPO_ROOT, 'native/parity/oracle-allowlist.txt')
  const allowed = existsSync(allowFile)
    ? new Set(parseEnginePathsFile(readFileSync(allowFile, 'utf8')))
    : new Set<string>()
  const changed = engineDiff(pin, 'HEAD').filter((f) => !allowed.has(f))
  if (changed.length > 0) {
    throw new Error(`OR-3: engine paths differ from the pin ${pin}: ${changed.join(', ')}`)
  }
  const dirty = git(['status', '--porcelain', '--', ...enginePaths()])
  if (dirty !== '') throw new Error(`OR-3: engine paths have uncommitted changes:\n${dirty}`)
}

// ---------------------------------------------------------------------------
// OR-7 environment of the oracle children
// ---------------------------------------------------------------------------

const ConstantLatency = z.object({ kind: z.literal('constant'), ms: z.number().int().min(0) })
/** The ModelConfig fields the TS oracle reads through env knobs (the job embeds the whole file). */
const OracleModelConfig = z.object({
  capital: z.object({ startingCapitalUsdc: z.string().regex(/^[0-9]+(\.[0-9]+)?$/) }),
  execution: z.object({
    compatLatency: z.object({ delayMs: z.number().int().min(0), jitterMs: z.number().min(0) }),
  }),
  feeds: z.object({
    binance: z.object({ latency: ConstantLatency }),
    chainlink: z.object({ latency: ConstantLatency, maxGapMs: z.number().int().min(0) }),
    priceToBeat: z.object({ latency: ConstantLatency }),
  }),
  runner: z.object({ maxEventsPerDrain: z.number().int().min(1) }),
})
type OracleModelConfig = z.infer<typeof OracleModelConfig>

/** OR-7 knobs left unset: TA only (FX-2a, no TA in fixtures). */
const UNSET_KNOBS = new Set([
  'BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS',
  'BACKTEST_TECH_IND_TIMEOUT_MS',
  'BACKTEST_TECH_IND_POLL_MS',
])

/** Every OR-7 knob (plus D63's latency pair) from the committed ts-compat ModelConfig. */
function oracleKnobs(mc: OracleModelConfig): Record<string, string> {
  const knobs: Record<string, string> = {
    BACKTEST_BINANCE_FEED_LATENCY_MS: String(mc.feeds.binance.latency.ms),
    BACKTEST_BINANCE_FEED_LOOKBACK_MS: String(LOOKBACK_MS),
    BACKTEST_RTDS_CHAINLINK_LATENCY_MS: String(mc.feeds.chainlink.latency.ms),
    BACKTEST_RTDS_CHAINLINK_LOOKBACK_MS: String(LOOKBACK_MS),
    BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS: String(mc.feeds.chainlink.maxGapMs),
    BACKTEST_PRICE_TO_BEAT_LATENCY_MS: String(mc.feeds.priceToBeat.latency.ms),
    MAX_EVENTS_PER_DRAIN: String(mc.runner.maxEventsPerDrain),
    // OR-7 cell value; not a ModelConfig field.
    WEB_UI_ORDERBOOK_LEVELS: '10',
    // D63: the env equals the job (jitter 0 in every ts-compat cell, OR-6).
    BACKTEST_LATENCY_DELAY: String(mc.execution.compatLatency.delayMs),
    BACKTEST_LATENCY_JITTER: '0',
  }
  for (const k of OR7_KNOBS) {
    if (!(k.name in knobs) && !UNSET_KNOBS.has(k.name)) {
      throw new Error(`OR-7 knob ${k.name} has no fixture-oracle value; extend oracleKnobs()`)
    }
  }
  return knobs
}

let oracleTmp: string | undefined
let oracleSeq = 0

/** Runs one TS oracle child (fixtures-oracle.ts) with the OR-7 environment. */
async function runOracle(args: {
  manifest: ManifestDraft
  telonexFile: string
  roots: FeedRoots
  strategyId: string
  tickOnUpdate: boolean
  mc: OracleModelConfig
  knobs: Record<string, string>
}): Promise<FixtureProofRun> {
  oracleTmp ??= mkdtempSync(path.join(os.tmpdir(), 'pmb-fixtures-oracle-'))
  oracleSeq += 1
  const requestFile = path.join(oracleTmp, `request-${oracleSeq}.json`)
  const outFile = path.join(oracleTmp, `result-${oracleSeq}.json`)
  const m = args.manifest
  writeFileSync(
    requestFile,
    JSON.stringify({
      telonexFile: args.telonexFile,
      slug: m.slug,
      tokenIds: m.tokenIds,
      outcome: m.outcome,
      window: m.window,
      priceToBeat: { value: m.priceToBeat.value, syncedAtMs: m.priceToBeat.syncedAtMs },
      strategyId: args.strategyId,
      tickOnUpdate: args.tickOnUpdate,
      startingCapital: Number(args.mc.capital.startingCapitalUsdc),
      latency: { delayMs: args.mc.execution.compatLatency.delayMs, jitterMs: 0 },
      outFile,
    }),
  )
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    TZ: 'UTC',
    BINANCE_DATA_BASE_DIR: args.roots.binance,
    TELONEX_CRYPTO_PRICES_BASE_DIR: args.roots.chainlink,
    ...args.knobs,
  }
  const tsx = path.join(REPO_ROOT, 'node_modules/.bin/tsx')
  const child = spawn(tsx, ['scripts/native/fixtures-oracle.ts', requestFile], {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-4000)
  })
  const code = await new Promise<number | null>((resolve) => child.on('close', resolve))
  if (code !== 0) throw new Error(`oracle child failed (exit ${code}):\n${stderr}`)
  return FixtureProofRunSchema.parse(JSON.parse(readFileSync(outFile, 'utf8')))
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

/**
 * Counters of 15 §8 on the Telonex file. `crossedBookTicks` uses the spec
 * definition: ticks after which at least one token's book is crossed or
 * locked (best bid >= best ask). `strictlyCrossedTicks` (bid > ask) and
 * `lockedTicks` (bid == ask, with no token crossed) split it.
 */
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
      else if (l) locked += 1
    },
  })
  return {
    rows: num(r![0]),
    inWindowRows: num(r![1]),
    localClockBackwards: num(r![2]),
    exchangeClockBackwards: num(r![3]),
    crossedBookTicks: crossed + locked,
    strictlyCrossedTicks: crossed,
    lockedTicks: locked,
  }
}

// ---------------------------------------------------------------------------
// FX-2 proof
// ---------------------------------------------------------------------------

type ManifestDraft = Omit<FixtureManifest, 'header' | 'proof'>

/**
 * Runs the FX-2 proof for one fixture directory; throws on any difference:
 * the trimmed rows against their sources and the TS loaders
 * (`verifyTrimmedFeeds`), then the TS engine on full vs trimmed day files,
 * each variant with `tickOnUpdate` false and true.
 */
async function prove(
  dir: string,
  m: ManifestDraft,
  dataRoot: string,
): Promise<FixtureManifest['proof']> {
  const mc = OracleModelConfig.parse(readModelConfig())
  const knobs = oracleKnobs(mc)
  const fullRoots = dataFeedRoots(dataRoot)
  const feedSeries = await verifyTrimmedFeeds({
    dir,
    files: m.files,
    sourceRoots: fullRoots,
    pair: m.feeds.binance.pair,
    chainlinkAssetId: m.feeds.chainlink?.assetId ?? null,
    window: m.window,
    maxGapMs: mc.feeds.chainlink.maxGapMs,
  })
  const input = m.files.find((f) => f.role === 'telonex_delta')
  if (!input) throw new Error(`${m.slug}: no telonex_delta file`)
  const telonexFile = path.join(dir, input.path)
  const strategyId = m.chainlinkCoverage ? 'feedsParityProbe.v1' : 'fixtures-feed-probe.binance-ptb'
  const runs: FixtureProofRun[] = []
  for (const tickOnUpdate of [false, true]) {
    const common = { manifest: m, telonexFile, strategyId, tickOnUpdate, mc, knobs }
    const [full, trimmed] = await Promise.all([
      runOracle({ ...common, roots: fullRoots }),
      runOracle({ ...common, roots: fixtureFeedRoots(dir) }),
    ])
    if (jsonText(full) !== jsonText(trimmed)) {
      throw new Error(
        `${m.slug}: FX-2 proof failed (tickOnUpdate=${tickOnUpdate}): full ${JSON.stringify(full)} != trimmed ${JSON.stringify(trimmed)}`,
      )
    }
    console.log(
      `[fixtures] ${m.slug} proof ${strategyId} tickOnUpdate=${tickOnUpdate}: ` +
        `trace ${full.traceSha256.slice(0, 16)} lines=${full.traceLines} synthetic=${full.syntheticTicks} (full == trimmed)`,
    )
    runs.push(full)
  }
  return { oracleKnobs: knobs, feedSeries, runs }
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

/** Top-level entries of an existing fixture directory that the generator does not own. */
function foreignEntries(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((e) => !GENERATED_ENTRIES.includes(e))
    .sort()
}

function assertOnlyGenerated(dir: string): void {
  const foreign = foreignEntries(dir)
  if (foreign.length > 0) {
    throw new Error(
      `${dir} holds entries the generator does not own (${foreign.join(', ')}); ` +
        'they may be stale once the inputs change: move them away first',
    )
  }
}

/** Replaces only the generated entries of `dest` with those of `staging`. */
function install(staging: string, dest: string): void {
  assertOnlyGenerated(dest)
  mkdirSync(dest, { recursive: true })
  for (const e of GENERATED_ENTRIES) rmSync(path.join(dest, e), { recursive: true, force: true })
  for (const e of readdirSync(staging)) {
    if (!GENERATED_ENTRIES.includes(e)) throw new Error(`staging produced unexpected entry ${e}`)
    renameSync(path.join(staging, e), path.join(dest, e))
  }
  rmSync(staging, { recursive: true, force: true })
}

/** GF-2 content = the manifest without its header; `contentPin` moves only when the content changes. */
function contentPinFor(slug: string, draft: Omit<FixtureManifest, 'header'>, pin: string): string {
  const file = path.join(fixtureDir(slug), MANIFEST_FILE)
  if (!existsSync(file)) return pin
  const old = JSON.parse(readFileSync(file, 'utf8')) as { header?: { contentPin?: unknown } }
  const oldContent = { ...old } as Record<string, unknown>
  delete oldContent.header
  return jsonText(oldContent) === jsonText(draft) && typeof old.header?.contentPin === 'string'
    ? old.header.contentPin
    : pin
}

async function buildOne(sel: Selected, dataRoot: string, pin: string): Promise<void> {
  assertOnlyGenerated(fixtureDir(sel.slug))
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
  const source = telonexSource(dataRoot, row.dataset)
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
  // D-PENDING: 15 I-18 / 21 §4 take the condition id from
  // telonex_markets.market_id, which src/db/telonexMarkets.ts does not expose
  // yet (crossStreamNeeds); until then the file's constant `market` column is
  // used, so nothing cross-checks the file against the catalog here.
  const conditionId = await telonexIdentity(path.join(staging, telonexRel), tokenIds)
  const files: FixtureFile[] = [
    await fileEntry({
      role: 'telonex_delta',
      dir: staging,
      relPath: telonexRel,
      day: null,
      source,
      sourceLabel: sourceLabel(dataRoot, source),
      trim: null,
    }),
  ]
  if (files[0]!.sha256 !== files[0]!.source.sha256)
    throw new Error(`${sel.slug}: copy differs from source`)

  const pair = defaultBinancePairForSymbol(symbol)
  const binance = await trimBinance({ dir: staging, dataRoot, pair, window })
  files.push(...binance.files)
  const chainlinkCoverage = window.startMs >= CRYPTO_PRICES_COVERAGE_FROM_MS
  const assetId = assetIdForSymbol(symbol)
  const chainlink = chainlinkCoverage
    ? await trimChainlink({ dir: staging, dataRoot, assetId, window })
    : null
  if (chainlink) files.push(...chainlink.files)

  const draft: ManifestDraft = {
    manifestVersion: MANIFEST_VERSION,
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
  }
  const content = { ...draft, proof: await prove(staging, draft, dataRoot) }
  const manifest: FixtureManifest = {
    header: {
      contentPin: contentPinFor(sel.slug, content, pin),
      generator: GENERATOR,
      generatorSha256: generatorSha256(),
    },
    ...content,
  }

  writeFileSync(path.join(staging, JOB_FILE), await committedJson(committedJob(manifest), JOB_FILE))
  writeFileSync(path.join(staging, MANIFEST_FILE), await committedJson(manifest, MANIFEST_FILE))
  install(staging, fixtureDir(sel.slug))
  console.log(
    `[fixtures] ${sel.slug}: ${files.length} files, ${dirBytes(fixtureDir(sel.slug))} bytes, contentPin ${manifest.header.contentPin.slice(0, 8)}`,
  )
}

function dirBytes(dir: string): number {
  let total = 0
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) total += statSync(path.join(e.parentPath, e.name)).size
  }
  return total
}

// ---------------------------------------------------------------------------
// check (offline) and jobs
// ---------------------------------------------------------------------------

/**
 * Offline integrity check (CI): manifest shape, every listed file's bytes and
 * sha256, no unlisted or foreign file, job.json equal to the job rendered
 * from fixture.json and the current model config, the generator unchanged
 * since the build (GF-2 `generatorSha256`), and the 25 MiB cap.
 */
async function check(): Promise<void> {
  const slugs = committedSlugs()
  if (slugs.length === 0) throw new Error(`no fixture markets under ${FIXTURES_DIR}`)
  const generator = generatorSha256()
  let total = 0
  for (const slug of slugs) {
    const manifest = readManifest(slug)
    await verifyFixtureFiles(slug, manifest)
    const jobFile = path.join(fixtureDir(slug), JOB_FILE)
    if (!existsSync(jobFile)) throw new Error(`${slug}: ${JOB_FILE} is missing`)
    if (readFileSync(jobFile, 'utf8') !== (await committedJson(committedJob(manifest), JOB_FILE))) {
      throw new Error(
        `${slug}: ${JOB_FILE} differs from the job rendered from ${MANIFEST_FILE} and the model config (run \`jobs\`)`,
      )
    }
    if (manifest.header.generatorSha256 !== generator) {
      throw new Error(
        `${slug}: generator changed since this fixture was built (generatorSha256 ${manifest.header.generatorSha256.slice(0, 16)} != ${generator.slice(0, 16)}); run \`build\``,
      )
    }
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

/** Rewrites every job.json from its fixture.json and the current model config (no DB, no data). */
async function jobs(): Promise<void> {
  for (const slug of committedSlugs()) {
    const manifest = readManifest(slug)
    writeFileSync(
      path.join(fixtureDir(slug), JOB_FILE),
      await committedJson(committedJob(manifest), JOB_FILE),
    )
    console.log(`[fixtures] ${slug}: ${JOB_FILE} written`)
  }
}

// ---------------------------------------------------------------------------
// scan (read-only): candidates per fee era and edge markets
// ---------------------------------------------------------------------------

const SCAN_MIN_IN_WINDOW = 1_000

async function scan(maxBytes: number, dataRoot: string): Promise<void> {
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
      if (!m.dataset) return []
      const p = telonexSource(dataRoot, m.dataset)
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
      const line = `${c.slug} bytes=${c.bytes} rows=${a.rows} inWindow=${a.inWindowRows} localBack=${a.localClockBackwards} exchBack=${a.exchangeClockBackwards} crossedOrLocked=${a.crossedBookTicks} strictlyCrossed=${a.strictlyCrossedTicks} locked=${a.lockedTicks}`
      active.push({ line, a })
    }
    console.log(`  smallest active files (inWindow >= ${SCAN_MIN_IN_WINDOW}):`)
    for (const { line } of active.slice(0, 5)) console.log(`    ${line}`)
    const edges = active
      .filter(({ a }) => a.crossedBookTicks > 0 && a.localClockBackwards > 0)
      .sort((x, y) => y.a.crossedBookTicks - x.a.crossedBookTicks)
    console.log(
      `  edge candidates (crossed or locked book and local clock backwards): ${edges.length}`,
    )
    for (const { line } of edges.slice(0, 5)) console.log(`    ${line}`)
  }
}

// ---------------------------------------------------------------------------
// CLI (R14: unknown subcommands, flags, positionals, repeats and values fail)
// ---------------------------------------------------------------------------

const USAGE = [
  'usage: fixtures-build.ts <subcommand> [flags]',
  '  scan  [--max-bytes N] [--data-root DIR]',
  '  build [--slug a,b | --prune] [--data-root DIR]',
  '  prove [--slug a,b] [--data-root DIR]',
  '  check',
  '  jobs',
].join('\n')

const SUBCOMMANDS: Record<string, { values: string[]; switches: string[] }> = {
  scan: { values: ['--max-bytes', '--data-root'], switches: [] },
  build: { values: ['--slug', '--data-root'], switches: ['--prune'] },
  prove: { values: ['--slug', '--data-root'], switches: [] },
  check: { values: [], switches: [] },
  jobs: { values: [], switches: [] },
}

export type Cli = { cmd: string; values: Map<string, string>; switches: Set<string> }

export function parseCli(argv: string[]): Cli {
  const [cmd, ...rest] = argv
  const spec = cmd === undefined ? undefined : SUBCOMMANDS[cmd]
  if (!cmd || !spec) throw new Error(`unknown or missing subcommand ${cmd ?? ''}\n${USAGE}`)
  const values = new Map<string, string>()
  const switches = new Set<string>()
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]!
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}\n${USAGE}`)
    if (values.has(a) || switches.has(a)) throw new Error(`${a} given twice`)
    if (spec.switches.includes(a)) {
      switches.add(a)
    } else if (spec.values.includes(a)) {
      const v = rest[i + 1]
      if (v === undefined || v.startsWith('--')) throw new Error(`missing value for ${a}`)
      values.set(a, v)
      i += 1
    } else {
      throw new Error(`${a} is not a flag of ${cmd}\n${USAGE}`)
    }
  }
  return { cmd, values, switches }
}

function parseMaxBytes(v: string | undefined): number {
  if (v === undefined) return 600_000
  const n = Number(v)
  if (!/^[1-9][0-9]*$/.test(v) || !Number.isSafeInteger(n)) {
    throw new Error(`--max-bytes must be a positive integer, got ${v}`)
  }
  return n
}

function parseDataRoot(v: string | undefined): string {
  const dir = path.resolve(v ?? path.join(REPO_ROOT, 'data'))
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`--data-root ${dir} is not a directory`)
  }
  return dir
}

function parseSlugs(v: string | undefined, known: string[], what: string): string[] | undefined {
  if (v === undefined) return undefined
  const slugs = v.split(',')
  if (new Set(slugs).size !== slugs.length) throw new Error('--slug lists a slug twice')
  const unknown = slugs.filter((s) => !known.includes(s))
  if (unknown.length > 0) throw new Error(`--slug: not ${what}: ${unknown.join(', ')}`)
  return slugs
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2))
  try {
    if (cli.cmd === 'scan') {
      const dataRoot = parseDataRoot(cli.values.get('--data-root'))
      console.log(`[fixtures] data root ${dataRoot}`)
      await scan(parseMaxBytes(cli.values.get('--max-bytes')), dataRoot)
    } else if (cli.cmd === 'build') {
      const slugs = parseSlugs(
        cli.values.get('--slug'),
        SELECTION.map((s) => s.slug),
        'in SELECTION',
      )
      const prune = cli.switches.has('--prune')
      if (slugs && prune) throw new Error('--prune applies to a full build only (no --slug)')
      const dataRoot = parseDataRoot(cli.values.get('--data-root'))
      const stale = committedSlugs().filter((s) => !SELECTION.some((x) => x.slug === s))
      if (!slugs && stale.length > 0 && !prune) {
        throw new Error(`committed fixtures not in SELECTION: ${stale.join(', ')}; pass --prune`)
      }
      for (const s of stale) assertOnlyGenerated(fixtureDir(s))
      const pin = currentPin()
      assertOracleTree(pin)
      console.log(`[fixtures] data root ${dataRoot}, oracle pin ${pin}`)
      for (const sel of slugs ? SELECTION.filter((s) => slugs.includes(s.slug)) : SELECTION) {
        await buildOne(sel, dataRoot, pin)
      }
      if (!slugs && prune) {
        for (const s of stale) {
          rmSync(fixtureDir(s), { recursive: true, force: true })
          console.log(`[fixtures] ${s}: removed (not in SELECTION, --prune)`)
        }
      }
      rmSync(path.join(FIXTURES_DIR, '.staging'), { recursive: true, force: true })
      await check()
    } else if (cli.cmd === 'prove') {
      const slugs =
        parseSlugs(cli.values.get('--slug'), committedSlugs(), 'a committed fixture') ??
        committedSlugs()
      const dataRoot = parseDataRoot(cli.values.get('--data-root'))
      const pin = currentPin()
      assertOracleTree(pin)
      console.log(`[fixtures] data root ${dataRoot}, oracle pin ${pin}`)
      for (const slug of slugs) {
        const manifest = readManifest(slug)
        await verifyFixtureFiles(slug, manifest)
        const { header, proof: committed, ...draft } = manifest
        const proof = await prove(fixtureDir(slug), draft, dataRoot)
        if (jsonText(proof) !== jsonText(committed)) {
          const changed = header.contentPin === pin ? [] : engineDiff(header.contentPin, pin)
          throw new Error(
            `${slug}: proof content differs from the committed fixture.json (FX-3: regenerate with \`build\`). ` +
              `contentPin ${header.contentPin}, current pin ${pin}; engine paths changed between them: ` +
              `${changed.length > 0 ? changed.join(', ') : 'none'}`,
          )
        }
        console.log(
          header.contentPin === pin
            ? `[fixtures] ${slug}: proof matches (contentPin ${pin.slice(0, 8)})`
            : `[fixtures] ${slug}: proof matches; content unchanged since contentPin ${header.contentPin.slice(0, 8)} (pin now ${pin.slice(0, 8)})`,
        )
        if (header.generatorSha256 !== generatorSha256()) {
          console.log(`[fixtures] ${slug}: note: generator changed since the build (check fails)`)
        }
      }
    } else if (cli.cmd === 'check') {
      await check()
    } else if (cli.cmd === 'jobs') {
      await jobs()
    }
  } finally {
    if (oracleTmp) rmSync(oracleTmp, { recursive: true, force: true })
    await closeDb()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await main()
}
