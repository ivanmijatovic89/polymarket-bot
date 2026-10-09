/**
 * Shared pieces of the committed fixture markets (native/spec/60 §12):
 * layout, the per-fixture manifest shape and the byte/sha256 checks used by
 * the generator (`fixtures-build.ts`) and the job renderer (`fixture-job.ts`).
 *
 * This module never touches MySQL, Redis or R2.
 */
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
export const FIXTURES_DIR = path.join(REPO_ROOT, 'native', 'fixtures', 'markets')
/** FX-2: total committed fixture size cap. */
export const FIXTURES_MAX_TOTAL_BYTES = 25 * 1024 * 1024

export const JOB_FILE = 'job.json'
export const MANIFEST_FILE = 'fixture.json'
export const MANIFEST_VERSION = 1

/** One committed input file of a fixture (paths are fixture-relative, POSIX). */
export type FixtureFile = {
  /** `telonex_delta` = the market input; the others are feed day files (21 §5 `feedFiles[].feed`). */
  role: 'telonex_delta' | 'binance_agg_trades' | 'chainlink_crypto_prices'
  path: string
  bytes: number
  sha256: string
  rows: number
  /** UTC day of a feed day file, null for the market input. */
  day: string | null
  /** Where the bytes came from (repo-relative), with the source's own size and sha256. */
  source: { path: string; bytes: number; sha256: string; rows: number }
  /** FX-2 trim bookkeeping for feed files; null for the copied market input. */
  trim: null | {
    membershipRows: number
    /** The seed row (F-14 / F-22) is in this day file. */
    holdsSeed: boolean
  }
}

export type FixtureProofRun = {
  strategyId: string
  params: Record<string, unknown>
  /** sha256 of the TS trace lines (full inputs == trimmed inputs, else the build fails). */
  traceSha256: string
  traceLines: number
  ticks: number
  syntheticTicks: number
  outputSha256: string
}

export type FixtureManifest = {
  manifestVersion: number
  generator: string
  slug: string
  timeframe: '5m' | '15m'
  window: { startMs: number; endMs: number }
  feeEra: 'F0' | 'F1' | 'F2' | 'F3'
  chainlinkCoverage: boolean
  /** `telonex_markets.{binance,chainlink}_usable` for the feeds the fixture carries. */
  catalogFeedChecks: Record<'binance' | 'chainlink', 'usable' | 'unverified' | 'not_required'>
  roles: string[]
  selection: string
  conditionId: string
  tokenIds: { UP: string; DOWN: string }
  outcome: 'UP' | 'DOWN'
  priceToBeat: {
    /** `telonex_markets.price_to_beat` read through src/db/telonexMarkets.ts. */
    value: number | null
    syncedAtMs: number | null
    status: 'fed' | 'absent_pre_series_epoch'
  }
  feeds: {
    lookbackMs: number
    binance: { pair: string; tailMs: number; seedAggTradeId: number | null }
    chainlink: null | {
      assetId: string
      tailMs: number
      seedRoundUs: number | null
      seedBroadcastUs: number | null
    }
  }
  anomalies: {
    rows: number
    inWindowRows: number
    localClockBackwards: number
    exchangeClockBackwards: number
    crossedBookTicks: number
    lockedBookTicks: number
  }
  files: FixtureFile[]
  proof: FixtureProofRun[]
}

export function fixtureDir(slug: string): string {
  return path.join(FIXTURES_DIR, slug)
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export function readManifest(slug: string): FixtureManifest {
  const file = path.join(fixtureDir(slug), MANIFEST_FILE)
  if (!existsSync(file)) throw new Error(`unknown fixture market ${slug} (no ${file})`)
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as FixtureManifest
  if (parsed.manifestVersion !== MANIFEST_VERSION || parsed.slug !== slug) {
    throw new Error(`${file}: unexpected manifestVersion or slug`)
  }
  return parsed
}

/** Fails loudly (R14) when a committed file's size or sha256 differs from its manifest entry. */
export async function verifyFixtureFiles(slug: string, manifest: FixtureManifest): Promise<void> {
  const dir = fixtureDir(slug)
  for (const f of manifest.files) {
    const abs = path.join(dir, f.path)
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

/** Deterministic JSON file text: 2-space indent, trailing newline, key order as constructed. */
export function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}
