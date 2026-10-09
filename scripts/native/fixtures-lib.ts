/**
 * Shared pieces of the committed fixture markets (native/spec/60 §12):
 * layout, the per-fixture manifest schema, job rendering and the integrity
 * checks used by the generator (`fixtures-build.ts`) and the job renderer
 * (`fixture-job.ts`).
 *
 * This module never touches MySQL, Redis, R2 or the environment.
 */
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import * as prettier from 'prettier'
import * as z from 'zod'

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
export const FIXTURES_DIR = path.join(REPO_ROOT, 'native', 'fixtures', 'markets')
/** FX-2: total committed fixture size cap. */
export const FIXTURES_MAX_TOTAL_BYTES = 25 * 1024 * 1024

export const JOB_FILE = 'job.json'
export const MANIFEST_FILE = 'fixture.json'
export const MANIFEST_VERSION = 2

/**
 * Top-level entries of `<slug>/` that the generator writes and may replace.
 * Anything else in a fixture directory (e.g. FX-1 traces, snapshots or
 * digests added by later tooling) is not the generator's: `build` refuses to
 * touch a directory holding such entries, and `check` reports them.
 */
export const GENERATED_ENTRIES: readonly string[] = [
  'binance',
  'chainlink',
  JOB_FILE,
  MANIFEST_FILE,
  'telonex-delta',
]

/** Recorded in the GF-2 header; `check` fails when these files changed after the last build. */
export const GENERATOR = 'scripts/native/fixtures-build.ts'
export const GENERATOR_FILES: readonly string[] = [
  'scripts/native/fixtures-build.ts',
  'scripts/native/fixtures-feeds.ts',
  'scripts/native/fixtures-lib.ts',
  'scripts/native/fixtures-oracle.ts',
]

/** Model config every fixture job carries (21 §6; committed ts-compat default). */
export const MODEL_CONFIG_FILE = path.join(
  REPO_ROOT,
  'native/contract/model-configs/ts-compat-default.json',
)

// D-PENDING: 60 §5.1 names the Rust exerciser `engine-exerciser.rs`, while the
// contract fixture native/contract/fixtures/jobs/valid/telonex-delta-ts-compat.json
// uses `engine-exerciser.v2.rs`. The spec id is used; `native:fixture-job --strategy-id` overrides.
export const DEFAULT_STRATEGY_ID = 'engine-exerciser.rs'
/** Strategies that request no feeds (60 §5.1, 30 §18): their jobs never carry feed fields (14 §6.2). */
export const NO_FEED_STRATEGY_IDS: ReadonlySet<string> = new Set([DEFAULT_STRATEGY_ID])

// ---------------------------------------------------------------------------
// Manifest schema (fixture.json)
// ---------------------------------------------------------------------------

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/)
const SafeInt = z.number().int().refine(Number.isSafeInteger, 'not a safe integer')
const NonNegInt = SafeInt.refine((n) => n >= 0, 'negative')

/** Parquet annotations of one column as `parquet_schema()` reports them. */
const ParquetAnnotation = z.strictObject({
  convertedType: z.string().nullable(),
  logicalType: z.string().nullable(),
})

export const FixtureFileSchema = z.strictObject({
  /** `telonex_delta` = the market input; the others are feed day files (21 §5 `feedFiles[].feed`). */
  role: z.enum(['telonex_delta', 'binance_agg_trades', 'chainlink_crypto_prices']),
  /** Fixture-relative POSIX path. */
  path: z.string().regex(/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/),
  bytes: NonNegInt,
  sha256: Sha256,
  rows: NonNegInt,
  /** UTC day of a feed day file, null for the market input. */
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  /** Where the bytes came from (`data/…` = relative to the data root), with the source's own size, sha256 and rows. */
  source: z.strictObject({ path: z.string(), bytes: NonNegInt, sha256: Sha256, rows: NonNegInt }),
  /** FX-2 trim bookkeeping for feed files; null for the copied market input. */
  trim: z
    .strictObject({
      membershipRows: NonNegInt,
      /** The seed row (F-14 / F-22) is in this day file. */
      holdsSeed: z.boolean(),
      /**
       * Parquet annotations that differ from the source (the trimmed copy is
       * written by DuckDB). Column names, order, physical and DuckDB logical
       * types always equal the source; only converted/logical annotations may
       * differ, and every difference is listed here.
       */
      annotationDifferences: z.array(
        z.strictObject({
          column: z.string(),
          source: ParquetAnnotation,
          trimmed: ParquetAnnotation,
        }),
      ),
    })
    .nullable(),
})
export type FixtureFile = z.infer<typeof FixtureFileSchema>

export const FixtureProofRunSchema = z.strictObject({
  strategyId: z.string(),
  params: z.record(z.string(), z.unknown()),
  /** sha256 of the TS trace lines (full inputs == trimmed inputs, else the build fails). */
  traceSha256: Sha256,
  traceLines: NonNegInt,
  ticks: NonNegInt,
  syntheticTicks: NonNegInt,
  outputSha256: Sha256,
})
export type FixtureProofRun = z.infer<typeof FixtureProofRunSchema>

/** TS loader output (`load*Series`) on the full and on the trimmed day files, which must be identical. */
export const FeedSeriesDigestSchema = z.strictObject({
  feed: z.enum(['binance_agg_trades', 'chainlink_crypto_prices']),
  length: NonNegInt,
  /** Same length as the sum of the trimmed day files' rows (no extra or missing row). */
  sha256: Sha256,
})
export type FeedSeriesDigest = z.infer<typeof FeedSeriesDigestSchema>

export const FixtureManifestSchema = z.strictObject({
  /** GF-2 header (D69 shape): `contentPin` = oracle pin (60 OR-1) at which the content last changed. */
  header: z.strictObject({
    contentPin: z.string().regex(/^[0-9a-f]{40}$/),
    generator: z.literal(GENERATOR),
    generatorSha256: Sha256,
  }),
  manifestVersion: z.literal(MANIFEST_VERSION),
  slug: z.string().regex(/^btc-updown-(5m|15m)-[0-9]{10}$/),
  timeframe: z.enum(['5m', '15m']),
  window: z.strictObject({ startMs: SafeInt, endMs: SafeInt }),
  feeEra: z.enum(['F0', 'F1', 'F2', 'F3']),
  chainlinkCoverage: z.boolean(),
  /** `telonex_markets.{binance,chainlink}_usable` for the feeds the fixture carries. */
  catalogFeedChecks: z.strictObject({
    binance: z.enum(['usable', 'unverified', 'not_required']),
    chainlink: z.enum(['usable', 'unverified', 'not_required']),
  }),
  roles: z.array(z.string()),
  selection: z.string(),
  conditionId: z.string().regex(/^0x[0-9a-f]{64}$/),
  tokenIds: z.strictObject({ UP: z.string().min(1), DOWN: z.string().min(1) }),
  outcome: z.enum(['UP', 'DOWN']),
  priceToBeat: z.strictObject({
    /** `telonex_markets.price_to_beat` read through src/db/telonexMarkets.ts. */
    value: z.number().nullable(),
    syncedAtMs: SafeInt.nullable(),
    status: z.enum(['fed', 'absent_pre_series_epoch']),
  }),
  feeds: z.strictObject({
    lookbackMs: SafeInt,
    binance: z.strictObject({
      pair: z.string(),
      tailMs: SafeInt,
      seedAggTradeId: SafeInt.nullable(),
    }),
    chainlink: z
      .strictObject({
        assetId: z.string(),
        tailMs: SafeInt,
        seedRoundUs: SafeInt.nullable(),
        seedBroadcastUs: SafeInt.nullable(),
      })
      .nullable(),
  }),
  anomalies: z.strictObject({
    rows: NonNegInt,
    inWindowRows: NonNegInt,
    localClockBackwards: NonNegInt,
    exchangeClockBackwards: NonNegInt,
    /** 15 §8 `crossedBookTicks`: ticks after which a token's book is crossed or locked (bid >= ask). */
    crossedBookTicks: NonNegInt,
    /** Split of `crossedBookTicks` (not spec counters): bid > ask, and bid == ask. */
    strictlyCrossedTicks: NonNegInt,
    lockedTicks: NonNegInt,
  }),
  files: z.array(FixtureFileSchema).min(1),
  proof: z.strictObject({
    /** OR-7 knobs the TS oracle children ran with (data roots excluded: they differ per run). */
    oracleKnobs: z.record(z.string(), z.string()),
    feedSeries: z.array(FeedSeriesDigestSchema),
    runs: z.array(FixtureProofRunSchema),
  }),
})
export type FixtureManifest = z.infer<typeof FixtureManifestSchema>

// ---------------------------------------------------------------------------
// Files and hashing
// ---------------------------------------------------------------------------

export function fixtureDir(slug: string): string {
  return path.join(FIXTURES_DIR, slug)
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** sha256 over `<path>\0<sha256 of the file>\n` of every generator file, in GENERATOR_FILES order. */
export function generatorSha256(): string {
  const hash = createHash('sha256')
  for (const rel of GENERATOR_FILES) {
    const text = readFileSync(path.join(REPO_ROOT, rel))
    hash.update(`${rel}\0${createHash('sha256').update(text).digest('hex')}\n`)
  }
  return hash.digest('hex')
}

/** Committed fixture slugs: every non-dot directory under FIXTURES_DIR. */
export function committedSlugs(): string[] {
  if (!existsSync(FIXTURES_DIR)) return []
  return readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort()
}

export function readManifest(slug: string): FixtureManifest {
  const file = path.join(fixtureDir(slug), MANIFEST_FILE)
  if (!existsSync(file)) throw new Error(`unknown fixture market ${slug} (no ${file})`)
  const result = FixtureManifestSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')))
  if (!result.success) {
    throw new Error(`${file}: invalid manifest: ${z.prettifyError(result.error)}`)
  }
  if (result.data.slug !== slug) throw new Error(`${file}: slug ${result.data.slug} != ${slug}`)
  return result.data
}

/** Every regular file under `dir`, as sorted fixture-relative POSIX paths. */
export function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => !e.isDirectory())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .sort()
}

/**
 * Fails loudly (R14) when a committed file's size or sha256 differs from its
 * manifest entry, when a listed file is missing, or when the directory holds a
 * file that is neither listed nor job.json/fixture.json.
 */
export async function verifyFixtureFiles(slug: string, manifest: FixtureManifest): Promise<void> {
  const dir = fixtureDir(slug)
  const listed = new Set(manifest.files.map((f) => f.path))
  if (listed.size !== manifest.files.length) throw new Error(`${slug}: duplicate file entries`)
  const extra = listFiles(dir).filter(
    (p) => !listed.has(p) && p !== JOB_FILE && p !== MANIFEST_FILE,
  )
  if (extra.length > 0) {
    throw new Error(`${slug}: files not listed in ${MANIFEST_FILE}: ${extra.join(', ')}`)
  }
  for (const f of manifest.files) {
    const abs = path.join(dir, f.path)
    if (!existsSync(abs)) throw new Error(`${slug}: ${f.path} is listed but missing`)
    const bytes = statSync(abs).size
    if (bytes !== f.bytes) {
      throw new Error(`${slug}: ${f.path} has ${bytes} bytes, manifest says ${f.bytes}`)
    }
    const sha = await sha256File(abs)
    if (sha !== f.sha256) {
      throw new Error(`${slug}: ${f.path} sha256 ${sha} != manifest ${f.sha256}`)
    }
  }
}

// ---------------------------------------------------------------------------
// JSON text
// ---------------------------------------------------------------------------

/** Deep copy with object keys sorted (GF-2); arrays keep their order. */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value).sort()) {
      out[k] = sortKeysDeep((value as Record<string, unknown>)[k])
    }
    return out
  }
  return value
}

/** Deterministic JSON file text: sorted keys, 2-space indent, trailing newline. */
export function jsonText(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`
}

/**
 * JSON as committed: the repo's pre-commit hook runs prettier on staged JSON,
 * so the generator writes prettier's form and a rebuild stays byte-identical.
 */
export async function committedJson(value: unknown, name: string): Promise<string> {
  const target = path.join(FIXTURES_DIR, name)
  const options = (await prettier.resolveConfig(target)) ?? {}
  return prettier.format(jsonText(value), { ...options, filepath: target })
}

// ---------------------------------------------------------------------------
// Jobs (21 §5)
// ---------------------------------------------------------------------------

/** Which feeds the job's strategy requests; decides the feed fields of the job (14 §6.2, 21 §5.1, §9). */
export type FeedSelection = { binance: boolean; chainlink: boolean; priceToBeat: boolean }
export const NO_FEEDS: FeedSelection = { binance: false, chainlink: false, priceToBeat: false }
export const ALL_FEEDS: FeedSelection = { binance: true, chainlink: true, priceToBeat: true }

const FEED_NAMES: Record<string, keyof FeedSelection> = {
  binance: 'binance',
  chainlink: 'chainlink',
  'price-to-beat': 'priceToBeat',
}

/** `none`, `all`, or a comma list of `binance`, `chainlink`, `price-to-beat` (each at most once). */
export function parseFeeds(value: string): FeedSelection {
  if (value === 'none') return { ...NO_FEEDS }
  if (value === 'all') return { ...ALL_FEEDS }
  const out = { ...NO_FEEDS }
  for (const name of value.split(',')) {
    const key = FEED_NAMES[name]
    if (!key) {
      throw new Error(
        `--feeds: unknown feed "${name}" (none | all | comma list of binance, chainlink, price-to-beat)`,
      )
    }
    if (out[key]) throw new Error(`--feeds: "${name}" given twice`)
    out[key] = true
  }
  return out
}

export function readModelConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(MODEL_CONFIG_FILE, 'utf8')) as Record<string, unknown>
}

/**
 * `EngineJob` (21 §5) of a fixture market. With `baseDir` null the paths stay
 * fixture-relative (the committed job.json, FX-1a); otherwise they resolve
 * against it (the absolute-path job of `native:fixture-job`).
 *
 * Feed fields follow the producer contract for the strategy's requests:
 * without price-to-beat, `gammaPriceToBeat` is absent and
 * `feedAvailability.priceToBeat` is null (14 §6.2, 21 §5.1); `feedFiles`
 * holds the day files of the requested feeds only (21 §9 step 3). A
 * Chainlink request on a market before coverage yields no Chainlink day file
 * (14 F-20 day set is empty there; the engine reports `pre_coverage`, F-19).
 *
 * Feed day files have no sha256 in the job: 14 §4.1 and 21 §5 (`FeedFile`)
 * own the job shape and define none, so under 00 §3.1 they win over the
 * FX-2 sentence "the job records each trimmed file's byte size and sha256".
 * For fixtures, each day file's sha256 lives in fixture.json and is verified
 * by `native:fixture-job` and `native:fixtures:build -- check` before use.
 */
export function renderJob(
  m: FixtureManifest,
  opts: {
    strategyId: string
    params: Record<string, unknown>
    feeds: FeedSelection
    baseDir: string | null
    modelConfig: Record<string, unknown>
  },
): Record<string, unknown> {
  const requests = opts.feeds.binance || opts.feeds.chainlink || opts.feeds.priceToBeat
  if (requests && NO_FEED_STRATEGY_IDS.has(opts.strategyId)) {
    throw new Error(`${opts.strategyId} requests no feeds (60 §5.1, 30 §18); use --feeds none`)
  }
  const at = (p: string): string => (opts.baseDir === null ? p : path.resolve(opts.baseDir, p))
  const input = m.files.find((f) => f.role === 'telonex_delta')
  if (!input) throw new Error(`${m.slug}: manifest has no telonex_delta file`)
  const feedFiles = m.files
    .filter(
      (f) =>
        (f.role === 'binance_agg_trades' && opts.feeds.binance) ||
        (f.role === 'chainlink_crypto_prices' && opts.feeds.chainlink),
    )
    .map((f) => {
      const symbol =
        f.role === 'binance_agg_trades' ? m.feeds.binance.pair : m.feeds.chainlink?.assetId
      if (!symbol || !f.day) throw new Error(`${m.slug}: ${f.path}: feed file without symbol/day`)
      return { feed: f.role, symbol, day: f.day, path: at(f.path), bytes: f.bytes }
    })
  const market: Record<string, unknown> = {
    slug: m.slug,
    // D-PENDING: 15 I-18 / 21 §4 take this from telonex_markets.market_id,
    // which src/db/telonexMarkets.ts does not expose yet; the generator uses
    // the file's constant `market` column (the same condition id).
    conditionId: m.conditionId,
    window: m.window,
    tokenIds: m.tokenIds,
    outcome: m.outcome,
    rules: { snapshotParserVersion: null, captured: {}, disagreements: 0 },
    feedAvailability: {
      priceToBeat: opts.feeds.priceToBeat ? { status: m.priceToBeat.status } : null,
    },
    input: {
      path: at(input.path),
      bytes: input.bytes,
      sha256: input.sha256,
      format: { name: 'telonex-delta-typed', version: 1 },
    },
    recorderV4: null,
    ownActivity: null,
    feedFiles,
  }
  if (opts.feeds.priceToBeat) {
    market.gammaPriceToBeat = {
      priceToBeat: m.priceToBeat.value,
      syncedAtMs: m.priceToBeat.syncedAtMs,
    }
  }
  return {
    jobSchemaVersion: 1,
    run: {
      strategyId: opts.strategyId,
      inputMode: 'telonex-delta',
      modelConfig: opts.modelConfig,
      candidates: [{ key: 'fixture', index: 0, params: opts.params, execution: null }],
    },
    market,
    outputs: { tracePath: null, traceLevel: 'decisions', ledgerPath: null },
    budget: { wallMs: 120000, threads: 1 },
  }
}

/** The committed job.json: the engine exerciser (no params, no feeds), fixture-relative paths. */
export function committedJob(m: FixtureManifest): Record<string, unknown> {
  return renderJob(m, {
    strategyId: DEFAULT_STRATEGY_ID,
    params: {},
    feeds: NO_FEEDS,
    baseDir: null,
    modelConfig: readModelConfig(),
  })
}
