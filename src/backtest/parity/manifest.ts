import {
  createReadStream,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { FeatureCoverageRow, FeedCoverage, GenericCoverage } from './coverage.js'
import type { MarketVerdict } from './matchers.js'

/**
 * Parity run manifest (native/spec/60-verification.md HR-7, OR-1, OR-3,
 * VP-2): the exact command, oracle pin, engine commit, binary sha256,
 * `modelConfigSha256`, market-set sha256 and input file identities, plus the
 * per-market verdicts and coverage. `native:parity:summary` renders the
 * PARITY.md matrix status from manifests (§15.2).
 */

export const MANIFEST_FORMAT = 'pmb-parity-manifest'
export const MANIFEST_VERSION = 1

export type FileIdentity = { path: string; bytes: number; sha256: string }

export type MarketEntry = {
  slug: string
  inputs: { market: FileIdentity | null; feedFiles: FileIdentity[]; missing: string[] }
  ts: {
    ok: boolean
    durationMs: number
    error?: string
    traceSha256?: string
    trace?: string
    /** OR-12 trace cache outcome, when a cache is used. */
    cache?: 'hit' | 'miss'
    cacheKey?: string
  }
  /** OR-9 re-run: byte-identical decompressed TS traces. */
  repeat?: { identical: boolean }
  rust?: { ok: boolean; durationMs: number; error?: string; trace?: string }
  diff?: {
    equal: boolean
    gating: boolean
    failures: number
    autoClasses: Record<string, number>
    sequenceDivergence: number | null
    firstFailure: string | null
  }
  verdict: MarketVerdict | null
  openRustBug?: boolean
  coverage?: { generic: GenericCoverage; feeds?: FeedCoverage; exerciser?: string[] }
}

export type ParityManifest = {
  format: typeof MANIFEST_FORMAT
  version: typeof MANIFEST_VERSION
  command: string
  createdAt: string
  /** OR-8: the wall-clock time the run resolved its inputs (provenance only). */
  asOfMs: number
  cell: {
    name: string
    file: string
    sha256: string
    gating: boolean
    traceLevel: string
    profile: string
    tsStrategy: unknown
    rustStrategyId: string
    params: unknown
  }
  /** True only when every gating condition holds (cell gating, OR-3, fixed diff rules, full set, Rust side present). */
  gating: boolean
  nonGatingReasons: string[]
  oracle: {
    pin: string
    head: string
    oracleTreeClean: boolean
    workingTreeClean: boolean
    changedEnginePaths: string[]
    disallowed: string[]
    oracleEnv: Record<string, string>
    oracleEnvSha256: string
  }
  exerciserScheduleVersion: number | null
  traceFormat: string
  diffRulesVersion: number
  tolerance: number | null
  modelConfigSha256: string
  marketSet: { name: string; file: string; sha256: string; size: number; selected: number }
  /** The canonical binary (VP-7) and its `describe` identity (20 §5.1). */
  rust: { bin: string; sha256: string; binary: unknown } | null
  markets: MarketEntry[]
  totals: Totals
  coverage: {
    exerciser: FeatureCoverageRow[] | null
  }
}

export type Totals = {
  markets: number
  identical: number
  identicalPatched: number
  classified: number
  masked: number
  unclassified: number
  excluded: number
  tsFailed: number
  pending: number
}

export function computeTotals(markets: readonly MarketEntry[]): Totals {
  const t: Totals = {
    markets: markets.length,
    identical: 0,
    identicalPatched: 0,
    classified: 0,
    masked: 0,
    unclassified: 0,
    excluded: 0,
    tsFailed: 0,
    pending: 0,
  }
  for (const m of markets) {
    if (!m.ts.ok) t.tsFailed++
    const v = m.verdict?.verdict
    if (v === undefined) t.pending++
    else if (v === 'identical') t.identical++
    else if (v === 'identical-patched') t.identicalPatched++
    else if (v === 'classified') t.classified++
    else if (v === 'masked') t.masked++
    else if (v === 'unclassified') t.unclassified++
    else t.excluded++
  }
  return t
}

/** Write JSON atomically (tmp → rename), HR-7. */
export function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n')
  renameSync(tmp, file)
}

export async function fileSha256(file: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    createReadStream(file)
      .on('data', (c) => hash.update(c))
      .on('end', () => resolve())
      .on('error', reject)
  })
  return hash.digest('hex')
}

const identityCache = new Map<string, Promise<FileIdentity>>()

/** Size and sha256 of an input file (MS-5), memoized per path for one process. */
export function fileIdentity(file: string): Promise<FileIdentity> {
  let p = identityCache.get(file)
  if (!p) {
    p = fileSha256(file).then((sha256) => ({ path: file, bytes: statSync(file).size, sha256 }))
    identityCache.set(file, p)
  }
  return p
}

export function readManifest(file: string): ParityManifest {
  const m = JSON.parse(readFileSync(file, 'utf8')) as ParityManifest
  if (m.format !== MANIFEST_FORMAT || m.version !== MANIFEST_VERSION)
    throw new Error(`${file}: not a ${MANIFEST_FORMAT} v${MANIFEST_VERSION} manifest`)
  return m
}

/**
 * Render the PARITY.md matrix status and the evidence tables from manifests
 * (60 §3.1 item 2, §15.2). Numbers come only from the manifests; each table
 * names the manifest sha256 it was rendered from.
 */
export function renderSummary(
  items: ReadonlyArray<{ file: string; sha256: string; manifest: ParityManifest }>,
): string {
  const lines: string[] = []
  lines.push(
    '| Cell | Markets | Identical | Identical (patched) | Classified | Masked | Unclassified | Excluded | Manifest |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---|',
  )
  for (const { file, sha256, manifest: m } of items) {
    const t = m.totals
    const gating = m.gating ? '' : ' (non-gating)'
    lines.push(
      `| ${m.cell.name}${gating} | ${t.markets} | ${t.identical} | ${t.identicalPatched} | ${t.classified} | ${t.masked} | ${t.unclassified} | ${t.excluded} | ${path.basename(file)} \`${sha256.slice(0, 12)}\` |`,
    )
  }
  for (const { sha256, manifest: m } of items) {
    lines.push('', `### ${m.cell.name}`, '')
    lines.push(`- manifest sha256: \`${sha256}\``)
    lines.push(
      `- oracle pin: \`${m.oracle.pin}\`, engine commit: \`${m.oracle.head}\`, oracleTreeClean: ${m.oracle.oracleTreeClean}`,
    )
    lines.push(
      `- set ${m.marketSet.name}: ${m.marketSet.selected} of ${m.marketSet.size} markets, sha256 \`${m.marketSet.sha256}\``,
    )
    lines.push(
      `- modelConfigSha256: \`${m.modelConfigSha256}\`; oracleEnvSha256: \`${m.oracle.oracleEnvSha256}\``,
    )
    lines.push(
      `- rust: ${m.rust ? `\`${m.rust.sha256}\`` : 'not run'}; trace ${m.traceFormat}; diff rules v${m.diffRulesVersion}${m.tolerance !== null ? ` (tolerance ${m.tolerance}, non-gating)` : ''}`,
    )
    if (m.nonGatingReasons.length > 0) lines.push(`- non-gating: ${m.nonGatingReasons.join('; ')}`)
    const t = m.totals
    if (t.tsFailed > 0) lines.push(`- TS failures: ${t.tsFailed}`)
    if (t.pending > 0) lines.push(`- markets without a verdict (no Rust side): ${t.pending}`)
    const feeds = m.markets
      .map((x) => x.coverage?.feeds)
      .filter((f): f is FeedCoverage => f !== undefined)
    if (feeds.length > 0) {
      const sum = (k: keyof Omit<FeedCoverage, 'plugins'>) => feeds.reduce((s, f) => s + f[k], 0)
      lines.push('', '| Feed coverage | Ticks |', '|---|---:|')
      lines.push(`| all ticks | ${sum('ticks')} |`)
      lines.push(`| binance visible | ${sum('binanceTicks')} |`)
      lines.push(`| chainlink visible | ${sum('chainlinkTicks')} |`)
      lines.push(`| price to beat visible | ${sum('priceToBeatTicks')} |`)
      lines.push(`| synthetic binance_agg_trade | ${sum('syntheticBinance')} |`)
      lines.push(`| synthetic chainlink_round | ${sum('syntheticChainlink')} |`)
      const pluginIds = [...new Set(feeds.flatMap((f) => Object.keys(f.plugins)))].sort()
      for (const id of pluginIds)
        lines.push(
          `| plugin ${id} present | ${feeds.reduce((s, f) => s + (f.plugins[id] ?? 0), 0)} |`,
        )
    }
    if (m.coverage.exerciser) {
      lines.push(
        '',
        '| Exerciser feature | Class | Markets | Share | Pass |',
        '|---|---|---:|---:|---|',
      )
      for (const r of m.coverage.exerciser)
        lines.push(
          `| ${r.feature} | ${r.class} | ${r.markets} | ${(r.share * 100).toFixed(1)}% | ${r.pass ? 'yes' : 'NO'} |`,
        )
    }
  }
  return lines.join('\n') + '\n'
}
