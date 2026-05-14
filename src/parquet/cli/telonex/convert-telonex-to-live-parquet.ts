import path from 'node:path'
import { promises as fs } from 'node:fs'
import * as parquet from '@dsnp/parquetjs'

import { openParquetReaderWithEpermFallback } from '../../../cli/helpers/openParquetReader.js'
import { rawMarketEventParquetSchema } from '../../io/eventSchema.js'

const DEFAULT_BOOK_INTERVAL = 500

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

// Tracks the last known book state per asset to compute deltas.
// Key: price as number (avoids "1.0" vs "1" string mismatch across snapshots).
// Value: { size as number for comparison; priceStr: original string for emitting }.
type LevelEntry = { size: number; priceStr: string }
type AssetState = {
  bids: Map<number, LevelEntry> // price (number) → { size, priceStr }
  asks: Map<number, LevelEntry>
  ticksSinceBook: number
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
    const lvl = (raw as { element?: TelonexLevel }).element
      ? (raw as { element: TelonexLevel }).element
      : (raw as TelonexLevel)
    if (lvl.price === undefined || lvl.size === undefined) return null
    const price = String(lvl.price)
    const size = String(lvl.size)
    if (!Number.isFinite(Number(price)) || !Number.isFinite(Number(size))) return null
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

function buildBookJson(tick: ParsedTick): string {
  return JSON.stringify({
    event_type: 'book',
    asset_id: tick.assetId,
    market: tick.marketId,
    timestamp: String(tick.tsUs / 1000n),
    hash: '',
    bids: tick.bids,
    asks: tick.asks,
  })
}

type PriceChangeEntry = {
  asset_id: string
  price: string
  size: string
  side: 'BUY' | 'SELL'
  hash: string
  best_bid: string
  best_ask: string
}

function computeDelta(tick: ParsedTick, state: AssetState): PriceChangeEntry[] {
  const changes: PriceChangeEntry[] = []

  // Bids: new or changed levels
  for (const lvl of tick.bids) {
    const p = Number(lvl.price)
    const s = Number(lvl.size)
    if (state.bids.get(p)?.size !== s) {
      changes.push({
        asset_id: tick.assetId,
        price: lvl.price,
        size: lvl.size,
        side: 'BUY',
        hash: '',
        best_bid: '',
        best_ask: '',
      })
    }
  }

  // Bids: removed levels — emit original price string from state to avoid float→string issues
  const newBidPrices = new Set(tick.bids.map((l) => Number(l.price)))
  for (const [price, entry] of state.bids) {
    if (!newBidPrices.has(price)) {
      changes.push({
        asset_id: tick.assetId,
        price: entry.priceStr,
        size: '0',
        side: 'BUY',
        hash: '',
        best_bid: '',
        best_ask: '',
      })
    }
  }

  // Asks: new or changed levels
  for (const lvl of tick.asks) {
    const p = Number(lvl.price)
    const s = Number(lvl.size)
    if (state.asks.get(p)?.size !== s) {
      changes.push({
        asset_id: tick.assetId,
        price: lvl.price,
        size: lvl.size,
        side: 'SELL',
        hash: '',
        best_bid: '',
        best_ask: '',
      })
    }
  }

  // Asks: removed levels — emit original price string from state to avoid float→string issues
  const newAskPrices = new Set(tick.asks.map((l) => Number(l.price)))
  for (const [price, entry] of state.asks) {
    if (!newAskPrices.has(price)) {
      changes.push({
        asset_id: tick.assetId,
        price: entry.priceStr,
        size: '0',
        side: 'SELL',
        hash: '',
        best_bid: '',
        best_ask: '',
      })
    }
  }

  return changes
}

function updateAssetState(state: AssetState, tick: ParsedTick): void {
  state.bids = new Map(
    tick.bids.map((l) => [Number(l.price), { size: Number(l.size), priceStr: l.price }]),
  )
  state.asks = new Map(
    tick.asks.map((l) => [Number(l.price), { size: Number(l.size), priceStr: l.price }]),
  )
}

type OutputRow = {
  ingest_seq: bigint
  ts_local_ms: bigint
  ts_exchange_ms: bigint
  event_type: string
  raw_json: string
}

type BuildStats = {
  rows: OutputRow[]
  bookCount: number
  deltaCount: number
  emptyDeltaCount: number
}

function buildOutputRows(ticks: ParsedTick[], bookInterval: number): BuildStats {
  const rows: OutputRow[] = []
  const stateByAsset = new Map<string, AssetState>()
  let seq = 1n
  let bookCount = 0
  let deltaCount = 0
  let emptyDeltaCount = 0
  let i = 0

  while (i < ticks.length) {
    const tsUs = ticks[i]!.tsUs

    // Collect all ticks at this exact timestamp then split by asset
    const upTicks: ParsedTick[] = []
    const downTicks: ParsedTick[] = []
    while (i < ticks.length && ticks[i]!.tsUs === tsUs) {
      const t = ticks[i]!
      if (t.side === 'up') upTicks.push(t)
      else downTicks.push(t)
      i += 1
    }

    // Up and Down always have the same count per timestamp (verified).
    // Pair Up[k] with Down[k] — each pair is one event (one output row).
    // Books must be per-asset; deltas from both sides of a pair go into one price_change.
    const n = Math.max(upTicks.length, downTicks.length)
    const marketId = (upTicks[0] ?? downTicks[0])!.marketId

    for (let k = 0; k < n; k += 1) {
      const pair = [upTicks[k], downTicks[k]].filter(Boolean) as ParsedTick[]
      const combinedChanges: PriceChangeEntry[] = []
      let maxLocalTsUs = 0n

      for (const tick of pair) {
        if (tick.localTsUs > maxLocalTsUs) maxLocalTsUs = tick.localTsUs

        let state = stateByAsset.get(tick.assetId)

        if (!state || state.ticksSinceBook >= bookInterval) {
          rows.push({
            ingest_seq: seq++,
            ts_local_ms: tick.localTsUs / 1000n,
            ts_exchange_ms: tsUs / 1000n,
            event_type: 'book',
            raw_json: buildBookJson(tick),
          })
          bookCount += 1

          if (!state) {
            state = { bids: new Map(), asks: new Map(), ticksSinceBook: 0 }
            stateByAsset.set(tick.assetId, state)
          }
          updateAssetState(state, tick)
          state.ticksSinceBook = 1
        } else {
          const changes = computeDelta(tick, state)
          updateAssetState(state, tick)
          state.ticksSinceBook += 1

          if (changes.length === 0) {
            emptyDeltaCount += 1
          } else {
            combinedChanges.push(...changes)
          }
        }
      }

      if (combinedChanges.length > 0) {
        rows.push({
          ingest_seq: seq++,
          ts_local_ms: maxLocalTsUs / 1000n,
          ts_exchange_ms: tsUs / 1000n,
          event_type: 'price_change',
          raw_json: JSON.stringify({
            event_type: 'price_change',
            market: marketId,
            timestamp: String(tsUs / 1000n),
            price_changes: combinedChanges,
          }),
        })
        deltaCount += 1
      }
    }
  }

  return { rows, bookCount, deltaCount, emptyDeltaCount }
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
      `[convert-telonex] file=${path.basename(f.filePath)} side=${f.side} loaded=${loaded} dropped=${dropped}`,
    )
  }

  return ticks
}

function buildOutPath(inputDir: string, slug: string | null, explicitOutPath?: string): string {
  if (explicitOutPath) return path.resolve(explicitOutPath)
  const baseName = slug ?? path.basename(path.resolve(inputDir))
  return path.resolve(inputDir, `${baseName}.parquet`)
}

function parseArgs(argv: string[]): {
  inputDir: string
  outPath?: string
  bookInterval: number
} {
  if (argv.length === 0) {
    throw new Error(
      'Usage: tsx src/parquet/cli/telonex/convert-telonex-to-live-parquet.ts <input-directory> [--out <output-file.parquet>] [--book-interval <N>]',
    )
  }

  const inputDir = argv[0]
  if (!inputDir) throw new Error('input directory is required')

  let outPath: string | undefined
  let bookInterval = DEFAULT_BOOK_INTERVAL

  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--out') {
      const v = argv[i + 1]
      if (!v) throw new Error('--out requires a path value')
      outPath = v
      i += 1
    } else if (a === '--book-interval') {
      const v = argv[i + 1]
      if (!v) throw new Error('--book-interval requires a numeric value')
      const n = parseInt(v, 10)
      if (!Number.isFinite(n) || n < 1)
        throw new Error('--book-interval must be a positive integer')
      bookInterval = n
      i += 1
    } else {
      throw new Error(`unknown arg: ${a}`)
    }
  }

  return outPath !== undefined ? { inputDir, outPath, bookInterval } : { inputDir, bookInterval }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2))
  const inputDir = path.resolve(parsed.inputDir)

  const files = await resolveInputFiles(inputDir)
  if (files.length === 0) {
    throw new Error(`[convert-telonex] no book_snapshot_full_*.parquet files found in ${inputDir}`)
  }

  const ticks = await loadTicks(files)
  if (ticks.length === 0) {
    throw new Error('[convert-telonex] no valid rows parsed from input parquet files')
  }

  ticks.sort(cmpTick)

  const slug = ticks.find((t) => t.slug !== null)?.slug ?? null
  const outPath = buildOutPath(inputDir, slug, parsed.outPath)

  const stats = buildOutputRows(ticks, parsed.bookInterval)
  const { rows } = stats
  if (rows.length === 0) {
    throw new Error('[convert-telonex] no output rows produced')
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.unlink(outPath).catch(() => undefined)

  const writer = await parquet.ParquetWriter.openFile(rawMarketEventParquetSchema, outPath)
  try {
    for (const row of rows) {
      await writer.appendRow(row)
    }
  } finally {
    await writer.close()
  }

  console.log(`[convert-telonex] input_dir=${inputDir}`)
  console.log(
    `[convert-telonex] files=${files.length} parsed_ticks=${ticks.length} book_interval=${parsed.bookInterval}`,
  )
  console.log(`[convert-telonex] empty_delta_ticks=${stats.emptyDeltaCount}`)
  console.log(
    `[convert-telonex] rows_written=${rows.length} book=${stats.bookCount} price_change=${stats.deltaCount}`,
  )
  console.log(`[convert-telonex] output=${outPath}`)
}

main().catch((err) => {
  console.error('[convert-telonex] fatal', err)
  process.exit(1)
})
