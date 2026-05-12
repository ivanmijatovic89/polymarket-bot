import path from 'node:path'
import { promises as fs } from 'node:fs'
import * as parquet from '@dsnp/parquetjs'

import { openParquetReaderWithEpermFallback } from '../../../cli/helpers/openParquetReader.js'
import { pairedOrderbookParquetSchema } from '../../io/eventSchema.js'

type Side = 'up' | 'down'

type InputFile = {
  filePath: string
  side: Side
}

type TelonexLevel = {
  price?: unknown
  size?: unknown
}

type TelonexRow = {
  timestamp_us?: unknown
  local_timestamp_us?: unknown
  market_id?: unknown
  slug?: unknown
  asset_id?: unknown
  bids?: unknown
  asks?: unknown
}

type NormalizedLevel = {
  price: string
  size: string
}

type ParsedTick = {
  tsUs: bigint
  localTsUs: bigint
  marketId: string
  slug: string | null
  assetId: string
  bids: NormalizedLevel[]
  asks: NormalizedLevel[]
  side: Side
  filePath: string
}

type PairFrame = {
  tsUs: bigint
  localTsUs: bigint
  marketId: string
  slug: string | null
  up: ParsedTick
  down: ParsedTick
}

type PairedOrderbookRow = {
  ingest_seq: bigint
  ts_local_ms: bigint
  ts_exchange_ms?: bigint
  event_type: 'orderbook_pair'
  market: string
  slug?: string
  up_asset_id: string
  down_asset_id: string
  up_bids: string
  up_asks: string
  down_bids: string
  down_asks: string
}

function sideFromFilename(filePath: string): Side | null {
  const name = path.basename(filePath).toLowerCase()
  if (name.includes('_up_')) return 'up'
  if (name.includes('_down_')) return 'down'
  return null
}

function parseBigIntLike(v: unknown): bigint | null {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v))
  if (typeof v === 'string' && v.trim() !== '') {
    try {
      return BigInt(v)
    } catch {
      return null
    }
  }
  return null
}

function parseLevelArray(v: unknown): NormalizedLevel[] | null {
  if (v === null || v === undefined) return []
  const arr = (() => {
    if (Array.isArray(v)) return v
    if (v && typeof v === 'object' && Array.isArray((v as { list?: unknown }).list)) {
      return (v as { list: unknown[] }).list
    }
    return null
  })()
  if (!arr) return null

  const out: NormalizedLevel[] = []
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') return null
    const lvl = (
      raw as {
        element?: TelonexLevel
      }
    ).element
      ? (raw as { element: TelonexLevel }).element
      : (raw as TelonexLevel)
    if (lvl.price === undefined || lvl.size === undefined) return null
    const price = String(lvl.price)
    const size = String(lvl.size)
    const priceNum = Number(price)
    const sizeNum = Number(size)
    if (!Number.isFinite(priceNum) || !Number.isFinite(sizeNum)) return null
    out.push({ price, size })
  }
  return out
}

function normalizeBookSides(args: { bids: NormalizedLevel[]; asks: NormalizedLevel[] }): {
  bids: NormalizedLevel[]
  asks: NormalizedLevel[]
} {
  const bids = [...args.bids].sort((a, b) => Number(b.price) - Number(a.price))
  const asks = [...args.asks].sort((a, b) => Number(a.price) - Number(b.price))
  return { bids, asks }
}

function parseRow(row: TelonexRow, filePath: string, side: Side): ParsedTick | null {
  const tsUs = parseBigIntLike(row.timestamp_us)
  if (tsUs === null) return null

  const localTsUs = parseBigIntLike(row.local_timestamp_us)
  if (localTsUs === null) return null

  const marketId = typeof row.market_id === 'string' ? row.market_id : null
  if (!marketId || marketId.trim() === '') return null

  const assetId = typeof row.asset_id === 'string' ? row.asset_id : null
  if (!assetId || assetId.trim() === '') return null

  const bidsRaw = parseLevelArray(row.bids) ?? []
  const asksRaw = parseLevelArray(row.asks) ?? []

  const norm = normalizeBookSides({ bids: bidsRaw, asks: asksRaw })

  return {
    tsUs,
    localTsUs,
    marketId,
    slug: typeof row.slug === 'string' ? row.slug : null,
    assetId,
    bids: norm.bids,
    asks: norm.asks,
    side,
    filePath,
  }
}

function cmpTick(a: ParsedTick, b: ParsedTick): number {
  if (a.tsUs !== b.tsUs) return a.tsUs < b.tsUs ? -1 : 1
  if (a.localTsUs !== b.localTsUs) return a.localTsUs < b.localTsUs ? -1 : 1
  if (a.assetId !== b.assetId) return a.assetId < b.assetId ? -1 : 1
  if (a.side !== b.side) return a.side === 'up' ? -1 : 1
  if (a.filePath !== b.filePath) return a.filePath < b.filePath ? -1 : 1
  return 0
}

function encodeLevels(levels: NormalizedLevel[]): string {
  if (levels.length === 0) return ''
  let out = ''
  for (let i = 0; i < levels.length; i += 1) {
    const lvl = levels[i]!
    if (i > 0) out += ';'
    out += `${lvl.price}@${lvl.size}`
  }
  return out
}

function buildOutPath(inputDir: string, explicitOutPath?: string): string {
  if (explicitOutPath) return path.resolve(explicitOutPath)
  const baseName = path.basename(path.resolve(inputDir))
  return path.resolve(inputDir, `${baseName}-merged-backtest.parquet`)
}

async function resolveInputFiles(dir: string): Promise<InputFile[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const out: InputFile[] = []

  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.endsWith('.parquet')) continue
    if (!entry.name.startsWith('book_snapshot_full_')) continue

    const filePath = path.join(dir, entry.name)
    const side = sideFromFilename(filePath)
    if (!side) continue
    out.push({ filePath, side })
  }

  out.sort((a, b) => a.filePath.localeCompare(b.filePath))
  return out
}

async function loadTicks(files: InputFile[]): Promise<ParsedTick[]> {
  const ticks: ParsedTick[] = []

  for (const f of files) {
    const reader = await openParquetReaderWithEpermFallback(f.filePath)
    const cursor = reader.getCursor()
    let loaded = 0
    let dropped = 0

    try {
       
      while (true) {
        const row = (await cursor.next()) as TelonexRow | null
        if (!row) break
        const p = parseRow(row, f.filePath, f.side)
        if (!p) {
          dropped += 1
          continue
        }
        ticks.push(p)
        loaded += 1
      }
    } finally {
      await reader.close().catch(() => undefined)
    }

    console.log(
      `[merge-telonex] file=${path.basename(f.filePath)} side=${f.side} loaded=${loaded} dropped=${dropped}`,
    )
  }

  return ticks
}

function buildPairedFrames(ticks: ParsedTick[]): PairFrame[] {
  const out: PairFrame[] = []
  let i = 0
  let lastUp: ParsedTick | undefined
  let lastDown: ParsedTick | undefined

  while (i < ticks.length) {
    const tsUs = ticks[i]!.tsUs
    const group: ParsedTick[] = []
    while (i < ticks.length && ticks[i]!.tsUs === tsUs) {
      group.push(ticks[i]!)
      i += 1
    }
    group.sort((a, b) => cmpTick(a, b))
    const up = group.filter((x) => x.side === 'up')
    const down = group.filter((x) => x.side === 'down')
    const n = Math.max(up.length, down.length)

    for (let k = 0; k < n; k += 1) {
      const upTick = up[k] ?? lastUp
      const downTick = down[k] ?? lastDown
      if (up[k]) lastUp = up[k]
      if (down[k]) lastDown = down[k]
      if (!upTick || !downTick) continue

      const localTsUs =
        upTick.localTsUs > downTick.localTsUs ? upTick.localTsUs : downTick.localTsUs
      out.push({
        tsUs,
        localTsUs,
        marketId: upTick.marketId,
        slug: upTick.slug ?? downTick.slug,
        up: upTick,
        down: downTick,
      })
    }
  }

  return out
}

function parseArgs(argv: string[]): { inputDir: string; outPath?: string } {
  if (argv.length === 0) {
    throw new Error(
      'Usage: tsx src/parquet/cli/telonex/merge-telonex-to-backtest-parquet.ts <input-directory> [--out <output-file.parquet>]',
    )
  }

  const inputDir = argv[0]
  if (!inputDir) {
    throw new Error('input directory is required')
  }

  let outPath: string | undefined
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--out') {
      const v = argv[i + 1]
      if (!v) throw new Error('--out requires a path value')
      outPath = v
      i += 1
    } else {
      throw new Error(`unknown arg: ${a}`)
    }
  }

  return outPath ? { inputDir, outPath } : { inputDir }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2))
  const inputDir = path.resolve(parsed.inputDir)
  const outPath = buildOutPath(inputDir, parsed.outPath)

  const files = await resolveInputFiles(inputDir)
  if (files.length === 0) {
    throw new Error(`[merge-telonex] no book_snapshot_full_*.parquet files found in ${inputDir}`)
  }

  const ticks = await loadTicks(files)
  if (ticks.length === 0) {
    throw new Error('[merge-telonex] no valid rows parsed from input parquet files')
  }

  ticks.sort(cmpTick)
  const frames = buildPairedFrames(ticks)
  if (frames.length === 0) {
    throw new Error('[merge-telonex] no paired frames produced')
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.unlink(outPath).catch(() => undefined)

  const writer = await parquet.ParquetWriter.openFile(pairedOrderbookParquetSchema, outPath)

  let rowsWritten = 0n
  try {
    for (let i = 0; i < frames.length; i += 1) {
      const f = frames[i]
      if (!f) continue

      const row: PairedOrderbookRow = {
        ingest_seq: BigInt(i + 1),
        ts_local_ms: f.localTsUs / 1000n,
        ts_exchange_ms: f.tsUs / 1000n,
        event_type: 'orderbook_pair',
        market: f.marketId,
        ...(f.slug ? { slug: f.slug } : {}),
        up_asset_id: f.up.assetId,
        down_asset_id: f.down.assetId,
        up_bids: encodeLevels(f.up.bids),
        up_asks: encodeLevels(f.up.asks),
        down_bids: encodeLevels(f.down.bids),
        down_asks: encodeLevels(f.down.asks),
      }
      await writer.appendRow(row)
      rowsWritten += 1n
    }
  } finally {
    await writer.close()
  }

  console.log(`[merge-telonex] input_dir=${inputDir}`)
  console.log(
    `[merge-telonex] files=${files.length} parsed_ticks=${ticks.length} paired_frames=${frames.length}`,
  )
  console.log(`[merge-telonex] output=${outPath} rows_written=${rowsWritten.toString()}`)
}

main().catch((err) => {
  console.error('[merge-telonex] fatal', err)
  process.exit(1)
})
