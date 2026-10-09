// Bench set manifests (16 §13.1): `native/bench/sets/<name>.json`.
//
// A manifest pins everything a comparison depends on, and every field is
// required (R14):
//
//   {
//     "name": "smoke-50",
//     "description": "…",                                         // optional
//     "selection": { … },                                           // optional provenance
//     "inputMode": "telonex-delta",
//     "strategy": { "id": "engine-exerciser.v2.rs", "params": {} },
//     "modelConfig": { … },                                         // ModelConfig v1 (21 §6)
//     "markets": [
//       { "slug": "btc-updown-15m-1780925400", "sha256": "<64 hex>", "bytes": 6444733,
//         "file": "events/telonex/delta-typed/btc/15m/btc-updown-15m-1780925400.parquet",
//         "rows": 449314 },                                         // rows optional
//       …
//     ]
//   }
//
// `file` is relative to the data root (`--data-root`, default
// `<repository root>/data`, 01 §6 M1 step 1). The manifest order is the
// result index `idx` of 16 §13.7. Unknown keys are errors.

export interface BenchMarket {
  /** Position in the manifest; the `idx` that deterministic digests sort by. */
  idx: number
  slug: string
  /** sha256 of the v1 source file, lowercase hex. */
  sha256: string
  /** Source file size in bytes. */
  bytes: number
  /** Data-root-relative source path. */
  file: string
  /** Row count, when the manifest records it (selection provenance). */
  rows: number | null
}

export interface BenchSet {
  name: string
  inputMode: string
  strategy: { id: string; params: Record<string, unknown> }
  modelConfig: Record<string, unknown>
  markets: BenchMarket[]
}

export class ManifestError extends Error {
  constructor(source: string, message: string) {
    super(`${source}: ${message}`)
    this.name = 'ManifestError'
  }
}

const SLUG = /^[a-z0-9]+-updown-(5m|15m)-[1-9][0-9]*$/
const SHA256 = /^[0-9a-f]{64}$/
const TOP_KEYS = new Set([
  'name',
  'description',
  'selection',
  'inputMode',
  'strategy',
  'modelConfig',
  'markets',
])
const MARKET_KEYS = new Set(['slug', 'sha256', 'bytes', 'file', 'rows'])

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function unknownKeys(o: Record<string, unknown>, allowed: ReadonlySet<string>): string[] {
  return Object.keys(o).filter((k) => !allowed.has(k))
}

const isCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

/** A normalized relative path with no `.`/`..` segments that names `<slug>.parquet`. */
function validRelativeFile(file: string, slug: string): boolean {
  if (file.startsWith('/') || file.includes('\\')) return false
  const parts = file.split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return false
  return parts[parts.length - 1] === `${slug}.parquet`
}

function parseMarket(raw: unknown, idx: number, source: string): BenchMarket {
  const where = `markets[${idx}]`
  if (!isObject(raw)) {
    throw new ManifestError(
      source,
      `${where}: expected an object with slug, sha256, bytes and file (bare slugs carry no source identity, 16 §13.1)`,
    )
  }
  const extra = unknownKeys(raw, MARKET_KEYS)
  if (extra.length > 0)
    throw new ManifestError(source, `${where}: unknown key(s) ${extra.join(', ')}`)
  const { slug, sha256, bytes, file, rows } = raw
  if (typeof slug !== 'string' || !SLUG.test(slug)) {
    throw new ManifestError(source, `${where}: invalid slug ${JSON.stringify(slug)}`)
  }
  if (typeof sha256 !== 'string' || !SHA256.test(sha256)) {
    throw new ManifestError(
      source,
      `${where} (${slug}): sha256 must be 64 lowercase hex characters`,
    )
  }
  if (!isCount(bytes) || bytes === 0) {
    throw new ManifestError(source, `${where} (${slug}): bytes must be a positive integer`)
  }
  if (typeof file !== 'string' || !validRelativeFile(file, slug)) {
    throw new ManifestError(
      source,
      `${where} (${slug}): file must be a normalized data-root-relative path ending in ${slug}.parquet`,
    )
  }
  if (rows !== undefined && !isCount(rows)) {
    throw new ManifestError(source, `${where} (${slug}): rows must be a non-negative integer`)
  }
  return { idx, slug, sha256, bytes, file, rows: rows ?? null }
}

function parseStrategy(raw: unknown, source: string): BenchSet['strategy'] {
  if (!isObject(raw)) {
    throw new ManifestError(source, '"strategy" must be an object { "id", "params" }')
  }
  const extra = unknownKeys(raw, new Set(['id', 'params']))
  if (extra.length > 0)
    throw new ManifestError(source, `strategy: unknown key(s) ${extra.join(', ')}`)
  if (typeof raw.id !== 'string' || raw.id === '') {
    throw new ManifestError(source, 'strategy.id must be a non-empty string')
  }
  if (!isObject(raw.params)) {
    throw new ManifestError(source, 'strategy.params must be an object (use {} for none)')
  }
  return { id: raw.id, params: raw.params }
}

/**
 * Parses a bench set manifest. `fileStem` is the manifest's file name
 * without `.json`; the `name` must equal it so a renamed copy cannot
 * masquerade as another set.
 */
export function parseBenchSet(text: string, source: string, fileStem: string): BenchSet {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new ManifestError(source, `not JSON: ${(e as Error).message}`)
  }
  if (!isObject(raw)) throw new ManifestError(source, 'top level must be an object')
  const extra = unknownKeys(raw, TOP_KEYS)
  if (extra.length > 0) throw new ManifestError(source, `unknown key(s) ${extra.join(', ')}`)
  const { name, inputMode, modelConfig } = raw
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    throw new ManifestError(source, `invalid or missing set name ${JSON.stringify(name)}`)
  }
  if (name !== fileStem) {
    throw new ManifestError(source, `set name "${name}" differs from the file name "${fileStem}"`)
  }
  if (typeof inputMode !== 'string' || inputMode === '') {
    throw new ManifestError(source, '"inputMode" must be a non-empty string')
  }
  if (!isObject(modelConfig)) {
    throw new ManifestError(source, '"modelConfig" must be an object (ModelConfig v1, 21 §6)')
  }
  if (!Array.isArray(raw.markets) || raw.markets.length === 0) {
    throw new ManifestError(source, '"markets" must be a non-empty array')
  }
  const markets = raw.markets.map((m, i) => parseMarket(m, i, source))
  const seen = new Set<string>()
  for (const m of markets) {
    if (seen.has(m.slug)) throw new ManifestError(source, `duplicate slug ${m.slug}`)
    seen.add(m.slug)
  }
  return {
    name,
    inputMode,
    strategy: parseStrategy(raw.strategy, source),
    modelConfig,
    markets,
  }
}
