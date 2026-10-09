/**
 * native:bench:sets — select the frozen native bench sets (native/spec/16 §13.1).
 *
 *   npm run native:bench:sets -- [--set smoke-50|heavy-1|all] [--force] [--dry-run]
 *   npm run native:bench:sets -- --set smoke-50|heavy-1 --name <new-name>   # a replacement set
 *   npm run native:bench:sets -- --verify        # re-hash the files of committed manifests
 *
 * Read-only on MySQL: the universe comes from `listEligibleTelonexSlugs` and the
 * token maps from `getMarketsBySlugs` (CLAUDE.md eligibility rule). Writes only
 * native/bench/sets/<name>.json. A manifest is frozen once committed (16 §13.1):
 * a committed one (tracked by git) is never overwritten, not even with --force;
 * a replacement selection is written under a new name with --name. --force only
 * replaces a manifest that was never committed. --verify reports any source
 * file whose sha256 or size changed (that invalidates comparisons).
 *
 * smoke-50: the eligible BTC 15m telonex delta-typed markets up to the pinned
 * cutoff whose file exists under data/events/telonex (the local_path
 * convention of src/telonex/localOutputPath.ts), sorted by (row count, slug)
 * and cut into 50 equal-count strata; each stratum contributes the market with
 * the smallest sha256("smoke-50|" + slug). Deterministic for a given universe.
 */
import '../../src/config/env.js'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { asyncBufferFromFile, parquetMetadataAsync } from 'hyparquet'
import { closeDb } from '../../src/db/index.js'
import { getMarketsBySlugs, listEligibleTelonexSlugs } from '../../src/db/telonexMarkets.js'
import { localOutputPath } from '../../src/telonex/localOutputPath.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const setsDir = path.join(repoRoot, 'native/bench/sets')

/** Upper bound on market_start_ms of the universe (inclusive), pinned for reproducibility. */
const CUTOFF_ISO = '2026-10-01T00:00:00Z'
const SYMBOL = 'btc'
const TIMEFRAME = '15m'
const CONVERTER = 'delta-typed'
const SMOKE_STRATA = 50
const HEAVY_SLUG = 'btc-updown-15m-1780925400'
const STRATEGY = 'engine-exerciser'
const MODEL_CONFIG = 'native/contract/model-configs/ts-compat-default.json'
const FOOTER_CONCURRENCY = 32

type SetName = 'smoke-50' | 'heavy-1'

type ManifestMarket = {
  slug: string
  file: string
  bytes: number
  sha256: string
  rows: number
  tokens: { up: string; down: string }
}

type Manifest = {
  benchSetVersion: 1
  name: string
  description: string
  createdAt: string
  inputMode: 'telonex-delta'
  format: { name: 'telonex-delta-typed'; version: 1 }
  symbol: string
  timeframe: string
  strategy: string
  params: Record<string, never>
  modelConfig: { path: string; sha256: string }
  selection: Record<string, unknown>
  totals: { markets: number; bytes: number; rows: number }
  markets: ManifestMarket[]
}

function parseArgs(argv: string[]) {
  let set: 'all' | SetName = 'all'
  let name: string | undefined
  let force = false
  let dryRun = false
  let verify = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--set') {
      const v = argv[++i]
      if (v !== 'all' && v !== 'smoke-50' && v !== 'heavy-1') {
        throw new Error(`--set must be smoke-50, heavy-1 or all (got ${v})`)
      }
      set = v
    } else if (a === '--name') {
      const v = argv[++i]
      if (v === undefined || !/^[a-z0-9][a-z0-9-]*$/.test(v)) {
        throw new Error(`--name must be a plain set name such as smoke-50-20261101 (got ${v})`)
      }
      name = v
    } else if (a === '--force') force = true
    else if (a === '--dry-run') dryRun = true
    else if (a === '--verify') verify = true
    else throw new Error(`unknown argument ${a}`)
  }
  if (name !== undefined && set === 'all') {
    throw new Error('--name needs a single --set (smoke-50 or heavy-1)')
  }
  return { set, name, force, dryRun, verify }
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    createReadStream(file)
      .on('data', (c) => hash.update(c))
      .on('error', reject)
      .on('end', () => resolve())
  })
  return hash.digest('hex')
}

async function footerRows(file: string): Promise<number> {
  const meta = await parquetMetadataAsync(await asyncBufferFromFile(file))
  return Number(meta.num_rows)
}

async function mapLimit<T, R>(items: T[], limit: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await f(items[i] as T)
    }
  })
  await Promise.all(workers)
  return out
}

function relFile(slug: string): string {
  return localOutputPath({ converter: CONVERTER, symbol: SYMBOL, timeframe: TIMEFRAME, slug })
    .relative
}

async function describeMarkets(slugs: string[]): Promise<ManifestMarket[]> {
  const rows = await getMarketsBySlugs(slugs, { converter: CONVERTER, readFrom: 'local' })
  const bySlug = new Map(rows.map((r) => [r.slug, r]))
  return mapLimit(slugs, 8, async (slug) => {
    const m = bySlug.get(slug)
    if (!m) throw new Error(`${slug}: not eligible under converter ${CONVERTER}/local`)
    const file = relFile(slug)
    if (m.dataset !== file) {
      throw new Error(`${slug}: DB local_path ${m.dataset} != canonical ${file}`)
    }
    const labels = [m.outcome0, m.outcome1]
    const ids = [m.assetId0, m.assetId1]
    const up = ids[labels.indexOf('Up')]
    const down = ids[labels.indexOf('Down')]
    if (!up || !down) throw new Error(`${slug}: no Up/Down token map (${labels.join(',')})`)
    const abs = path.join(repoRoot, file)
    const stat = await fs.stat(abs)
    return {
      slug,
      file,
      bytes: stat.size,
      sha256: await sha256File(abs),
      rows: await footerRows(abs),
      tokens: { up, down },
    }
  })
}

async function modelConfigRef() {
  const abs = path.join(repoRoot, MODEL_CONFIG)
  return { path: MODEL_CONFIG, sha256: await sha256File(abs) }
}

function totals(markets: ManifestMarket[]) {
  return {
    markets: markets.length,
    bytes: markets.reduce((s, m) => s + m.bytes, 0),
    rows: markets.reduce((s, m) => s + m.rows, 0),
  }
}

/** Whether a file is tracked by git (a committed, frozen manifest). */
function isTracked(file: string): boolean {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', path.relative(repoRoot, file)], {
      cwd: repoRoot,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

function base(name: SetName, description: string) {
  return {
    benchSetVersion: 1 as const,
    name,
    description,
    createdAt: new Date().toISOString(),
    inputMode: 'telonex-delta' as const,
    format: { name: 'telonex-delta-typed' as const, version: 1 as const },
    symbol: SYMBOL,
    timeframe: TIMEFRAME,
    strategy: STRATEGY,
    params: {},
  }
}

async function buildSmoke(): Promise<Manifest> {
  const toMs = Date.parse(CUTOFF_ISO)
  const query = {
    symbol: SYMBOL,
    timeframe: TIMEFRAME,
    converter: CONVERTER,
    readFrom: 'local',
    toMs,
  } as const
  const eligible = await listEligibleTelonexSlugs(query)
  const local = eligible.filter((s) => existsSync(path.join(repoRoot, relFile(s))))
  console.log(`[bench-sets] eligible ${eligible.length}, present locally ${local.length}`)
  let done = 0
  const unreadable: Array<{ slug: string; error: string }> = []
  const scanned = await mapLimit(local, FOOTER_CONCURRENCY, async (slug) => {
    if (++done % 5000 === 0) console.log(`[bench-sets] footers ${done}/${local.length}`)
    try {
      return { slug, rows: await footerRows(path.join(repoRoot, relFile(slug))) }
    } catch (e) {
      // Recorded in the manifest, never silently dropped (R14).
      unreadable.push({ slug, error: (e as Error).message })
      return null
    }
  })
  const counted = scanned.filter((c): c is { slug: string; rows: number } => c !== null)
  unreadable.sort((a, b) => (a.slug < b.slug ? -1 : 1))
  for (const u of unreadable) console.log(`[bench-sets] unreadable footer: ${u.slug}: ${u.error}`)
  counted.sort((a, b) => a.rows - b.rows || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
  const n = counted.length
  if (n < SMOKE_STRATA) throw new Error(`universe too small: ${n}`)
  const key = (slug: string) => createHash('sha256').update(`smoke-50|${slug}`).digest('hex')
  const picked: string[] = []
  const strata: Array<{ rowsMin: number; rowsMax: number; size: number }> = []
  for (let k = 0; k < SMOKE_STRATA; k++) {
    const lo = Math.floor((k * n) / SMOKE_STRATA)
    const hi = Math.floor(((k + 1) * n) / SMOKE_STRATA)
    const stratum = counted.slice(lo, hi)
    let best = stratum[0]!
    for (const c of stratum) if (key(c.slug) < key(best.slug)) best = c
    picked.push(best.slug)
    strata.push({
      rowsMin: stratum[0]!.rows,
      rowsMax: stratum[stratum.length - 1]!.rows,
      size: hi - lo,
    })
  }
  const markets = await describeMarkets(picked)
  const rows = counted.map((c) => c.rows)
  return {
    ...base(
      'smoke-50',
      '50 BTC 15m telonex-delta markets stratified by row count (16 §13.1): per-commit A/B and determinism suite.',
    ),
    modelConfig: await modelConfigRef(),
    selection: {
      tool: 'scripts/native/bench-sets.ts',
      source: 'listEligibleTelonexSlugs',
      query: { ...query, toIso: CUTOFF_ISO },
      eligible: eligible.length,
      presentLocally: local.length,
      unreadableFooter: unreadable,
      universe: n,
      method:
        'sort by (rows, slug); 50 equal-count strata; per stratum the slug with the smallest sha256("smoke-50|" + slug)',
      universeRows: { min: rows[0], median: rows[Math.floor(n / 2)], max: rows[n - 1] },
      strata,
    },
    totals: totals(markets),
    markets,
  }
}

async function buildHeavy(): Promise<Manifest> {
  const eligible = await listEligibleTelonexSlugs({
    symbol: SYMBOL,
    timeframe: TIMEFRAME,
    converter: CONVERTER,
    readFrom: 'local',
    slugs: [HEAVY_SLUG],
  })
  if (eligible.length !== 1) throw new Error(`${HEAVY_SLUG} is not eligible`)
  const markets = await describeMarkets([HEAVY_SLUG])
  return {
    ...base(
      'heavy-1',
      'The heavy market btc-updown-15m-1780925400 (16 §13.1): per-market phase profile, same market as the Codex profile.',
    ),
    modelConfig: await modelConfigRef(),
    selection: {
      tool: 'scripts/native/bench-sets.ts',
      source: 'listEligibleTelonexSlugs',
      query: { symbol: SYMBOL, timeframe: TIMEFRAME, converter: CONVERTER, readFrom: 'local' },
      method: 'fixed slug (16 §13.1)',
    },
    totals: totals(markets),
    markets,
  }
}

async function verify(): Promise<number> {
  let bad = 0
  for (const f of (await fs.readdir(setsDir)).filter((x) => x.endsWith('.json')).sort()) {
    const m = JSON.parse(await fs.readFile(path.join(setsDir, f), 'utf8')) as Manifest
    for (const mk of m.markets) {
      const abs = path.join(repoRoot, mk.file)
      if (!existsSync(abs)) {
        console.log(`[verify] ${m.name} ${mk.slug}: MISSING ${mk.file}`)
        bad++
        continue
      }
      const size = (await fs.stat(abs)).size
      const sha = await sha256File(abs)
      if (size !== mk.bytes || sha !== mk.sha256) {
        console.log(`[verify] ${m.name} ${mk.slug}: CHANGED (bytes ${size}, sha256 ${sha})`)
        bad++
      }
    }
    console.log(`[verify] ${m.name}: ${m.markets.length} markets checked`)
  }
  return bad
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.verify) {
    const bad = await verify()
    if (bad > 0) throw new Error(`${bad} source file(s) missing or changed`)
    return
  }
  const wanted: SetName[] = args.set === 'all' ? ['smoke-50', 'heavy-1'] : [args.set]
  for (const kind of wanted) {
    const name = args.name ?? kind
    const out = path.join(setsDir, `${name}.json`)
    if (existsSync(out) && !args.dryRun) {
      if (isTracked(out)) {
        throw new Error(
          `${out} is committed and frozen (16 §13.1); write a replacement under a new name with --name`,
        )
      }
      if (!args.force) {
        throw new Error(`${out} exists (not committed yet); pass --force to replace it`)
      }
    }
    const built = kind === 'smoke-50' ? await buildSmoke() : await buildHeavy()
    const manifest: Manifest =
      name === kind
        ? built
        : { ...built, name, description: `${built.description} Replacement selection of ${kind}.` }
    const t = manifest.totals
    console.log(`[bench-sets] ${name}: ${t.markets} markets, ${t.rows} rows, ${t.bytes} bytes`)
    if (!args.dryRun) {
      await fs.mkdir(setsDir, { recursive: true })
      await fs.writeFile(out, JSON.stringify(manifest, null, 2) + '\n')
      console.log(`[bench-sets] wrote ${path.relative(repoRoot, out)}`)
    }
  }
}

try {
  await main()
} catch (e) {
  console.error(`[bench-sets] ${(e as Error).message}`)
  process.exitCode = 1
} finally {
  await closeDb()
}
