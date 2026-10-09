// Selects and freezes a bench set manifest (16 §13.1): `smoke-50` (50 BTC 15m
// markets stratified by row count) or `heavy-1` (btc-updown-15m-1780925400).
//
//   npx tsx scripts/native/bench-select-set.ts --set smoke-50 --to-ms 1758067200000
//   npx tsx scripts/native/bench-select-set.ts --set heavy-1
//
// Market selection goes only through `listEligibleTelonexMarkets`
// (src/db/telonexMarkets.ts, CLAUDE.md eligibility rule): BTC 15m,
// delta-typed, readFrom local, resolved, from the eligibility floor up to
// the pinned `--to-ms` cutoff. Read-only: MySQL reads through that module,
// file reads under the data root (01 §8.1 H2). A market whose local size
// differs from the conversion's recorded size is excluded and listed (D64).
//
// smoke-50: the eligible universe is sorted by (row count, slug), cut into 50
// strata of (nearly) equal count, and the stratum's median market is taken,
// so the set spans the row-count distribution from the 1st to the 99th
// percentile. Rows come from each file's Parquet footer.
//
// The manifest pins the workload: `engine-exerciser.rs` (30 §18: no params)
// with the ts-compat default ModelConfig (native/contract/model-configs).
// It refuses to overwrite an existing manifest: sets are frozen once
// committed (16 §13.1).

import '../../src/config/env.js'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { parquetMetadata } from 'hyparquet'
import { closeDb } from '../../src/db/index.js'
import { listEligibleTelonexMarkets, type Market } from '../../src/db/telonexMarkets.js'
import { TELONEX_DATASET_ELIGIBLE_FROM_MS } from '../../src/config/telonex.js'
import { parseBenchSet } from '../../native/bench/harness/manifest.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const HEAVY_1 = 'btc-updown-15m-1780925400'
const STRATA = 50
const STRATEGY = { id: 'engine-exerciser.rs', params: {} }
const MODEL_CONFIG_FILE = 'native/contract/model-configs/ts-compat-default.json'

function sha256File(p: string): string {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex')
}

/** Row count from the Parquet footer (reads only the file's tail). */
function parquetRows(p: string): number {
  const fd = fs.openSync(p, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const tail = Buffer.alloc(8)
    fs.readSync(fd, tail, 0, 8, size - 8)
    if (tail.toString('latin1', 4) !== 'PAR1') throw new Error(`${p}: not a Parquet file`)
    const footerLen = tail.readUInt32LE(0)
    const buf = Buffer.alloc(footerLen + 8)
    fs.readSync(fd, buf, 0, buf.length, size - buf.length)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)
    return Number(parquetMetadata(ab).num_rows)
  } finally {
    fs.closeSync(fd)
  }
}

/** `events/telonex/delta-typed/btc/15m/<slug>.parquet` (src/telonex/localOutputPath.ts layout). */
function relFile(m: Market): string {
  return `events/telonex/delta-typed/${m.symbol}/${m.timeframe}/${m.slug}.parquet`
}

interface Picked {
  slug: string
  sha256: string
  bytes: number
  file: string
  rows: number
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: {
      set: { type: 'string' },
      'to-ms': { type: 'string' },
      'data-root': { type: 'string', default: path.join(REPO_ROOT, 'data') },
      out: { type: 'string' },
    },
  })
  const set = values.set
  if (set !== 'smoke-50' && set !== 'heavy-1') throw new Error('--set smoke-50 | heavy-1')
  const dataRoot = path.resolve(values['data-root'])
  const out = path.resolve(values.out ?? path.join(REPO_ROOT, `native/bench/sets/${set}.json`))
  if (fs.existsSync(out)) throw new Error(`${out} exists: bench sets are frozen once committed`)
  const modelConfig = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, MODEL_CONFIG_FILE), 'utf8'),
  ) as Record<string, unknown>

  let toMs: number | undefined
  if (set === 'smoke-50') {
    if (values['to-ms'] === undefined || !/^[0-9]+$/.test(values['to-ms']))
      throw new Error('smoke-50 needs a pinned --to-ms cutoff (ms)')
    toMs = Number(values['to-ms'])
  }
  const universe = await listEligibleTelonexMarkets({
    symbol: 'btc',
    timeframe: '15m',
    converter: 'delta-typed',
    readFrom: 'local',
    ...(set === 'heavy-1' ? { slugs: [HEAVY_1], fromMs: 0 } : { toMs: toMs! }),
    limit: 1_000_000,
  })
  console.log(`${universe.length} eligible markets`)
  const excluded: Array<{ slug: string; reason: string }> = []
  const rows: Array<{ m: Market; file: string; bytes: number; rows: number }> = []
  for (const m of universe) {
    const file = relFile(m)
    if (
      m.dataset !== null &&
      m.dataset !== `data/${file}` &&
      m.dataset !== path.join(dataRoot, file)
    ) {
      throw new Error(`${m.slug}: local_path ${m.dataset} is not the canonical ${file}`)
    }
    const abs = path.join(dataRoot, file)
    const st = fs.statSync(abs, { throwIfNoEntry: false })
    if (!st?.isFile()) {
      excluded.push({ slug: m.slug, reason: 'no local file' })
      continue
    }
    if (m.conversionSizeBytes !== null && st.size !== m.conversionSizeBytes) {
      excluded.push({
        slug: m.slug,
        reason: `local size ${st.size} differs from conversion size ${m.conversionSizeBytes} (D64)`,
      })
      continue
    }
    rows.push({ m, file, bytes: st.size, rows: parquetRows(abs) })
  }
  rows.sort((a, b) => a.rows - b.rows || (a.m.slug < b.m.slug ? -1 : 1))
  const chosen =
    set === 'heavy-1'
      ? rows
      : Array.from({ length: STRATA }, (_, k) => {
          const lo = Math.floor((k * rows.length) / STRATA)
          const hi = Math.floor(((k + 1) * rows.length) / STRATA)
          return rows[Math.floor((lo + hi - 1) / 2)]!
        })
  if (set === 'heavy-1' && chosen.length !== 1)
    throw new Error(`${HEAVY_1} is not eligible locally`)
  const markets: Picked[] = chosen
    .map((c) => ({
      slug: c.m.slug,
      sha256: sha256File(path.join(dataRoot, c.file)),
      bytes: c.bytes,
      file: c.file,
      rows: c.rows,
    }))
    .sort((a, b) => (a.slug < b.slug ? -1 : 1))
  const totalRows = rows.reduce((n, r) => n + r.rows, 0)
  const manifest = {
    name: set,
    description:
      set === 'smoke-50'
        ? '50 BTC 15m markets stratified by row count: per-commit A/B and determinism suite (16 §13.1)'
        : 'heavy-1: per-market phase profile, same market as the Codex profile (16 §13.1)',
    selection: {
      tool: 'scripts/native/bench-select-set.ts',
      query:
        'listEligibleTelonexMarkets {symbol btc, timeframe 15m, converter delta-typed, readFrom local, resolvedOnly}',
      fromMs: set === 'heavy-1' ? 0 : TELONEX_DATASET_ELIGIBLE_FROM_MS,
      toMs: toMs ?? null,
      eligible: universe.length,
      usable: rows.length,
      excluded,
      ...(set === 'smoke-50'
        ? {
            method: `sort by (rows, slug); ${STRATA} equal-count strata; each stratum's median market`,
            universeRows: {
              min: rows[0]?.rows ?? 0,
              median: rows[Math.floor(rows.length / 2)]?.rows ?? 0,
              max: rows[rows.length - 1]?.rows ?? 0,
              mean: rows.length === 0 ? 0 : Math.round(totalRows / rows.length),
            },
          }
        : {}),
      workload: `${STRATEGY.id} (30 §18, no params) with ${MODEL_CONFIG_FILE}`,
      selectedAt: new Date().toISOString(),
    },
    inputMode: 'telonex-delta',
    strategy: STRATEGY,
    modelConfig,
    markets,
  }
  const text = `${JSON.stringify(manifest, null, 2)}\n`
  parseBenchSet(text, out, set) // the driver's own validation
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, text)
  const sel = markets.reduce((n, m) => n + m.bytes, 0)
  console.log(
    `wrote ${out}: ${markets.length} markets, ${(sel / 1e6).toFixed(1)} MB, rows ${Math.min(...markets.map((m) => m.rows))}–${Math.max(...markets.map((m) => m.rows))}; excluded ${excluded.length}`,
  )
}

main()
  .then(() => closeDb())
  .catch(async (e: unknown) => {
    console.error(e)
    await closeDb()
    process.exit(1)
  })
