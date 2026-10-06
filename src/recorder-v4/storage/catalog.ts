import { parse } from 'dotenv'
import { RecorderCliError } from '../cliError.js'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { downloadMarket, readRemoteManifest } from './archive.js'
import type { DownloadedMarket } from './archive.js'
import type { BlobStore, R2BlobStoreOptions } from './blobStore.js'
import type { MarketManifest } from './manifest.js'
import type { RecorderTimeframe } from '../types.js'

export type CatalogFilter = {
  prefix: string
  timeframe?: RecorderTimeframe
  fromMs?: number
  toMs?: number
}
export type CatalogEntry = { manifestKey: string; manifest: MarketManifest }

export { validateArchivePrefix } from './namespace.js'
import { validateArchivePrefix } from './namespace.js'

export function matchesCatalogFilter(manifest: MarketManifest, filter: CatalogFilter): boolean {
  return (
    (!filter.timeframe || manifest.market.timeframe === filter.timeframe) &&
    (filter.fromMs === undefined || manifest.market.startMs >= filter.fromMs) &&
    (filter.toMs === undefined || manifest.market.startMs < filter.toMs)
  )
}

/** A manifest is the commit marker. Unpublished event uploads and resolution files are excluded. */
export async function* listRecordedMarkets(
  store: BlobStore,
  filter: CatalogFilter,
): AsyncGenerator<CatalogEntry> {
  const prefix = `${validateArchivePrefix(filter.prefix)}/`
  for await (const key of store.list(prefix)) {
    if (!key.startsWith(prefix) || !/\/manifest-[a-f0-9]{64}\.json$/.test(key)) continue
    // V4 has one layout; the selected prefix may be an isolated validation namespace.
    const parts = key.slice(prefix.length).split('/')
    // Child namespaces (including validation) are selected explicitly, never mixed into production.
    if (parts.length > 5) continue
    if (parts.length !== 5)
      throw new Error('Catalog manifest has an unsupported archive directory layout')
    const marketDirectory = parts[2]!
    const slug = /^btc-updown-(5m|15m)-(\d+)$/.exec(marketDirectory)
    if (!slug) throw new Error('Catalog manifest has an unsupported market directory')
    if (parts[0] !== 'btc' || parts[1] !== slug[1])
      throw new Error('Catalog symbol or duration directory does not match its market slug')
    if (filter.timeframe && slug[1] !== filter.timeframe) continue
    const startMs = Number(slug[2]) * 1000
    if (filter.fromMs !== undefined && startMs < filter.fromMs) continue
    if (filter.toMs !== undefined && startMs >= filter.toMs) continue
    const { manifest } = await readRemoteManifest(store, key)
    if (manifest.archiveLayout !== 'symbol-timeframe')
      throw new Error('Catalog directory layout does not match its manifest archiveLayout')
    if (manifest.market.slug !== marketDirectory)
      throw new Error('Catalog manifest does not match its market directory')
    if (matchesCatalogFilter(manifest, filter)) yield { manifestKey: key, manifest }
  }
}

export type CatalogDownloadReport = { downloaded: number; failed: number }

/** Sequential streaming downloads bound memory and open files; failed packages never become valid caches. */
export async function downloadRecordedMarkets(
  store: BlobStore,
  entries: AsyncIterable<CatalogEntry>,
  output: string,
  callbacks: {
    onDownloaded?: (entry: CatalogEntry, downloaded: DownloadedMarket) => void
    onError?: (entry: CatalogEntry, error: unknown) => void
  } = {},
): Promise<CatalogDownloadReport> {
  const result = { downloaded: 0, failed: 0 }
  for await (const entry of entries) {
    try {
      const downloaded = await downloadMarket(store, entry.manifestKey, output)
      callbacks.onDownloaded?.(entry, downloaded)
      result.downloaded++
    } catch (error) {
      result.failed++
      callbacks.onError?.(entry, error)
    }
  }
  return result
}

export type CatalogArgs = {
  command: 'list' | 'download'
  envFile: string
  prefix: string | null
  timeframe: RecorderTimeframe | null
  fromMs: number | null
  toMs: number | null
  output: string | null
  manifest: string | null
}

function utcDate(value: string, name: string): number {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value))
    throw new RecorderCliError(`${name} must be a UTC date or ISO timestamp ending in Z`)
  const timestamp = Date.parse(value)
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value.slice(0, 10)
  )
    throw new RecorderCliError(`Invalid ${name} date`)
  return timestamp
}

export function parseCatalogArgs(argv: string[]): CatalogArgs {
  const command = argv[0]
  if (command !== 'list' && command !== 'download')
    throw new RecorderCliError('Expected list or download subcommand')
  const known = new Set([
    '--env-file',
    '--prefix',
    '--timeframe',
    '--from',
    '--to',
    '--output',
    '--manifest',
  ])
  const options = new Map<string, string>()
  for (let i = 1; i < argv.length; i++) {
    const name = argv[i]!
    if (!known.has(name)) throw new RecorderCliError('Unknown catalog option')
    if (options.has(name)) throw new RecorderCliError(`Duplicate ${name} option`)
    const value = argv[++i]
    if (!value || value.startsWith('--')) throw new RecorderCliError(`Missing value for ${name}`)
    options.set(name, value)
  }
  const timeframe = options.get('--timeframe') ?? null
  if (timeframe !== null && timeframe !== '5m' && timeframe !== '15m')
    throw new RecorderCliError('Timeframe must be 5m or 15m')
  const fromMs = options.has('--from') ? utcDate(options.get('--from')!, '--from') : null
  const toMs = options.has('--to') ? utcDate(options.get('--to')!, '--to') : null
  if (fromMs !== null && toMs !== null && fromMs >= toMs)
    throw new RecorderCliError('--from must be before --to')
  const output = options.get('--output') ?? null
  if (command === 'download' && !output)
    throw new RecorderCliError('Download requires an explicit --output cache directory')
  if (command === 'list' && output)
    throw new RecorderCliError('--output is only supported by download')
  const manifest = options.get('--manifest') ?? null
  if (manifest && (timeframe || fromMs !== null || toMs !== null))
    throw new RecorderCliError('--manifest cannot be combined with timeframe or date filters')
  const prefix = options.get('--prefix') ?? null
  if (prefix) validateArchivePrefix(prefix)
  return {
    command,
    envFile: path.resolve(options.get('--env-file') ?? '.env.recorder-v4'),
    prefix,
    timeframe,
    fromMs,
    toMs,
    output: output ? path.resolve(output) : null,
    manifest,
  }
}

export async function loadCatalogConfig(
  args: CatalogArgs,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ r2: R2BlobStoreOptions; filter: CatalogFilter; manifestKey: string | null }> {
  // Selected R2 values only; no wallet or trading configuration is initialized or exported.
  let contents: Buffer
  try {
    contents = await readFile(args.envFile)
  } catch {
    throw new RecorderCliError(
      'Cannot read the archive configuration file; select a readable file with --env-file',
    )
  }
  const values = parse(contents)
  const get = (key: string) => (env[key] ?? values[key])?.trim()
  const required = (key: string) => {
    const value = get(key)
    if (!value) throw new RecorderCliError(`Missing ${key} in explicit archive configuration`)
    return value
  }
  const endpoint = required('R2_ENDPOINT')
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new RecorderCliError('Invalid R2_ENDPOINT')
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new RecorderCliError(
      'R2_ENDPOINT must be an HTTPS origin without credentials, path or query',
    )
  const bucket = required('R2_BUCKET')
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))
    throw new RecorderCliError('Invalid R2_BUCKET')
  const prefix = validateArchivePrefix(args.prefix ?? get('RECORDER_R2_PREFIX') ?? 'recorder-v4')
  let manifestKey = args.manifest
  if (manifestKey?.startsWith('r2://')) {
    let manifestUrl: URL
    try {
      manifestUrl = new URL(manifestKey)
    } catch {
      throw new RecorderCliError('Invalid R2 manifest URL')
    }
    if (
      manifestUrl.hostname !== bucket ||
      manifestUrl.username ||
      manifestUrl.password ||
      manifestUrl.search ||
      manifestUrl.hash
    )
      throw new RecorderCliError(
        'Manifest URL must use the configured R2 bucket without credentials or query',
      )
    manifestKey = decodeURIComponent(manifestUrl.pathname.slice(1))
  }
  if (
    manifestKey &&
    (!manifestKey.startsWith(`${prefix}/`) ||
      !/\/manifest-[a-f0-9]{64}\.json$/.test(manifestKey) ||
      manifestKey.split('/').includes('..'))
  )
    throw new RecorderCliError(
      'Manifest key must be a committed manifest under the selected prefix',
    )
  return {
    r2: {
      endpoint,
      bucket,
      accessKeyId: required('R2_ACCESS_KEY_ID'),
      secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
    },
    filter: {
      prefix,
      ...(args.timeframe ? { timeframe: args.timeframe } : {}),
      ...(args.fromMs !== null ? { fromMs: args.fromMs } : {}),
      ...(args.toMs !== null ? { toMs: args.toMs } : {}),
    },
    manifestKey,
  }
}

export const CATALOG_HELP = `Recorder v4 archive catalog and verified downloads (no R2 mutations).
Usage: npm run record:v4:data -- list|download [options]
  --env-file FILE       Explicit R2 configuration (default .env.recorder-v4)
  --prefix PREFIX       Archive prefix (default RECORDER_R2_PREFIX or recorder-v4)
  --timeframe 5m|15m    Optional BTC market timeframe
  --from UTC            Inclusive market opening date/time, e.g. 2026-10-01
  --to UTC              Exclusive market opening date/time, e.g. 2026-11-01
  --manifest KEY        One exact manifest key or r2://bucket/key instead of filters
  --output DIRECTORY    Required worker cache destination for download
  --help                Show this help without reading credentials
Dates are UTC; timestamps must end in Z. Downloads are sequential and verify content.
`
