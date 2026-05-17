/**
 * Shared row-parsing helpers for Telonex book_snapshot_full parquet files.
 * Used by both the paired and delta converters.
 */
import path from 'node:path'
import * as parquet from '@dsnp/parquetjs'
import { openParquetReaderWithEpermFallback } from '../../cli/helpers/openParquetReader.js'
import type { Side } from './types.js'

export type TelonexLevel = { price?: unknown; size?: unknown }

export type TelonexRow = {
  timestamp_us?: unknown
  local_timestamp_us?: unknown
  market_id?: unknown
  slug?: unknown
  asset_id?: unknown
  bids?: unknown
  asks?: unknown
}

export type NormalizedLevel = { price: string; size: string }

export type ParsedTick = {
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

export function parseBigIntLike(v: unknown): bigint | null {
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

export function parseLevelArray(v: unknown): NormalizedLevel[] | null {
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
    const priceNum = Number(price)
    const sizeNum = Number(size)
    if (!Number.isFinite(priceNum) || !Number.isFinite(sizeNum)) return null
    out.push({ price, size })
  }
  return out
}

export function normalizeBookSides(args: { bids: NormalizedLevel[]; asks: NormalizedLevel[] }): {
  bids: NormalizedLevel[]
  asks: NormalizedLevel[]
} {
  const bids = [...args.bids].sort((a, b) => Number(b.price) - Number(a.price))
  const asks = [...args.asks].sort((a, b) => Number(a.price) - Number(b.price))
  return { bids, asks }
}

export function parseRow(row: TelonexRow, filePath: string, side: Side): ParsedTick | null {
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

export function cmpTick(a: ParsedTick, b: ParsedTick): number {
  if (a.tsUs !== b.tsUs) return a.tsUs < b.tsUs ? -1 : 1
  if (a.localTsUs !== b.localTsUs) return a.localTsUs < b.localTsUs ? -1 : 1
  if (a.assetId !== b.assetId) return a.assetId < b.assetId ? -1 : 1
  if (a.side !== b.side) return a.side === 'up' ? -1 : 1
  if (a.filePath !== b.filePath) return a.filePath < b.filePath ? -1 : 1
  return 0
}

export function encodeLevels(levels: NormalizedLevel[]): string {
  if (levels.length === 0) return ''
  let out = ''
  for (let i = 0; i < levels.length; i += 1) {
    const lvl = levels[i]!
    if (i > 0) out += ';'
    out += `${lvl.price}@${lvl.size}`
  }
  return out
}

export type LoadStats = { loaded: number; dropped: number }

export async function loadTicksFromFile(
  filePath: string,
  side: Side,
): Promise<{ ticks: ParsedTick[]; stats: LoadStats }> {
  const reader = await openParquetReaderWithEpermFallback(filePath)
  const cursor = reader.getCursor()
  const ticks: ParsedTick[] = []
  let loaded = 0
  let dropped = 0
  try {
    while (true) {
      const row = (await cursor.next()) as TelonexRow | null
      if (!row) break
      const p = parseRow(row, filePath, side)
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
  return { ticks, stats: { loaded, dropped } }
}

/**
 * Helper used by writers: open a parquet writer to `outputPath`, ensuring
 * parent directory exists and any stale file at the target is removed.
 */
export async function openOutputWriter<TSchema extends parquet.ParquetSchema>(
  schema: TSchema,
  outputPath: string,
): Promise<parquet.ParquetWriter> {
  const { promises: fs } = await import('node:fs')
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.unlink(outputPath).catch(() => undefined)
  return parquet.ParquetWriter.openFile(schema, outputPath)
}
