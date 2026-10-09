// Bench set manifests (16 §13.1): `native/bench/sets/<name>.json`.
//
// Expected shape (the fields the L1 driver needs; other keys are kept in the
// manifest bytes, whose sha256 is recorded, and are not interpreted here):
//
//   {
//     "name": "smoke-50",
//     "strategy": { "id": "engine-exerciser", "params": {} },   // or "strategyId" + "params"
//     "modelConfig": { ... },                                     // optional
//     "markets": [
//       { "slug": "btc-updown-15m-1780925400", "sha256": "<64 hex>", "bytes": 6444733,
//         "file": "events/telonex/delta-typed/btc/15m/btc-updown-15m-1780925400.parquet" },
//       ...
//     ]
//   }
//
// A market may also be a bare slug string (no source identity). The manifest
// order is the result index `idx` of 16 §13.7.

export interface BenchMarket {
  /** Position in the manifest; the `idx` that deterministic digests sort by. */
  idx: number
  slug: string
  /** sha256 of the v1 source file, lowercase hex, when the manifest pins it. */
  sha256: string | null
  /** Source file size in bytes, when the manifest pins it. */
  bytes: number | null
  /** Data-root-relative source path, when the manifest gives one. */
  file: string | null
}

export interface BenchSet {
  name: string
  strategyId: string | null
  params: Record<string, unknown> | null
  modelConfig: Record<string, unknown> | null
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

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseMarket(raw: unknown, idx: number, source: string): BenchMarket {
  const where = `markets[${idx}]`
  if (typeof raw === 'string') {
    if (!SLUG.test(raw))
      throw new ManifestError(source, `${where}: invalid slug ${JSON.stringify(raw)}`)
    return { idx, slug: raw, sha256: null, bytes: null, file: null }
  }
  if (!isObject(raw)) throw new ManifestError(source, `${where}: expected a slug or an object`)
  const { slug, sha256, bytes, file } = raw
  if (typeof slug !== 'string' || !SLUG.test(slug)) {
    throw new ManifestError(source, `${where}: invalid slug ${JSON.stringify(slug)}`)
  }
  if (
    sha256 !== undefined &&
    sha256 !== null &&
    (typeof sha256 !== 'string' || !SHA256.test(sha256))
  ) {
    throw new ManifestError(
      source,
      `${where} (${slug}): sha256 must be 64 lowercase hex characters`,
    )
  }
  if (
    bytes !== undefined &&
    bytes !== null &&
    (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0)
  ) {
    throw new ManifestError(source, `${where} (${slug}): bytes must be a non-negative integer`)
  }
  if (file !== undefined && file !== null && (typeof file !== 'string' || file === '')) {
    throw new ManifestError(source, `${where} (${slug}): file must be a non-empty string`)
  }
  return {
    idx,
    slug,
    sha256: typeof sha256 === 'string' ? sha256 : null,
    bytes: typeof bytes === 'number' ? bytes : null,
    file: typeof file === 'string' ? file : null,
  }
}

function parseStrategy(
  m: Record<string, unknown>,
  source: string,
): { strategyId: string | null; params: Record<string, unknown> | null } {
  const { strategy, strategyId, params } = m
  if (strategy !== undefined && strategyId !== undefined) {
    throw new ManifestError(source, 'give either "strategy" or "strategyId", not both')
  }
  let id: unknown = strategyId
  let p: unknown = params
  if (typeof strategy === 'string') {
    id = strategy
  } else if (isObject(strategy)) {
    if (params !== undefined) {
      throw new ManifestError(
        source,
        '"params" belongs inside "strategy" when "strategy" is an object',
      )
    }
    id = strategy.id
    p = strategy.params
  } else if (strategy !== undefined && strategy !== null) {
    throw new ManifestError(source, '"strategy" must be a string or an object')
  }
  if (id !== undefined && id !== null && (typeof id !== 'string' || id === '')) {
    throw new ManifestError(source, 'strategy id must be a non-empty string')
  }
  if (p !== undefined && p !== null && !isObject(p)) {
    throw new ManifestError(source, 'strategy params must be an object')
  }
  return {
    strategyId: typeof id === 'string' ? id : null,
    params: isObject(p) ? p : null,
  }
}

/**
 * Parses a bench set manifest. `fallbackName` (the file stem) is used when
 * the manifest has no `name`; a `name` that differs from it is an error so
 * a renamed copy cannot masquerade as another set.
 */
export function parseBenchSet(text: string, source: string, fallbackName: string): BenchSet {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new ManifestError(source, `not JSON: ${(e as Error).message}`)
  }
  if (!isObject(raw)) throw new ManifestError(source, 'top level must be an object')
  const name = raw.name ?? fallbackName
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    throw new ManifestError(source, `invalid set name ${JSON.stringify(name)}`)
  }
  if (raw.name !== undefined && name !== fallbackName) {
    throw new ManifestError(
      source,
      `set name "${name}" differs from the file name "${fallbackName}"`,
    )
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
  const mc = raw.modelConfig
  if (mc !== undefined && mc !== null && !isObject(mc)) {
    throw new ManifestError(source, '"modelConfig" must be an object')
  }
  return {
    name,
    ...parseStrategy(raw, source),
    modelConfig: isObject(mc) ? mc : null,
    markets,
  }
}
