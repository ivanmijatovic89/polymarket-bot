/**
 * Shared row-parsing helpers for Telonex book_snapshot_full parquet files.
 * Used by both the paired and delta converters.
 */
import path from 'node:path'
import * as parquet from '@dsnp/parquetjs'
import { DuckDBInstance } from '@duckdb/node-api'
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
    if (v && typeof v === 'object' && (v as { list?: unknown }).list === null) return []
    if (v && typeof v === 'object' && Array.isArray((v as { list?: unknown }).list)) {
      return (v as { list: unknown[] }).list
    }
    if (v && typeof v === 'object' && Array.isArray((v as { items?: unknown }).items)) {
      return (v as { items: unknown[] }).items
    }
    return null
  })()
  if (!arr) return null

  const out: NormalizedLevel[] = []
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') return null
    const lvl = (raw as { element?: TelonexLevel }).element
      ? (raw as { element: TelonexLevel }).element
      : (raw as { entries?: TelonexLevel }).entries
        ? (raw as { entries: TelonexLevel }).entries
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

  const bidsRaw = parseLevelArray(row.bids)
  if (bidsRaw === null) return null
  const asksRaw = parseLevelArray(row.asks)
  if (asksRaw === null) return null
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
export type StreamStats = { filesRead: number; loaded: number; dropped: number }

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

function sqlString(v: string): string {
  return `'${v.replaceAll("'", "''")}'`
}

function parseDuckRow(row: unknown[], filePath: string, side: Side): ParsedTick | null {
  return parseRow(
    {
      timestamp_us: row[0],
      local_timestamp_us: row[1],
      market_id: row[2],
      slug: row[3],
      asset_id: row[4],
      bids: row[5],
      asks: row[6],
    },
    filePath,
    side,
  )
}

export async function streamSortedTickGroupsFromInputs(
  inputs: Array<{ filePath: string; side: Side }>,
  onGroup: (group: ParsedTick[]) => void | Promise<void>,
): Promise<StreamStats> {
  const stats: StreamStats = { filesRead: inputs.length, loaded: 0, dropped: 0 }
  const duckDb = await DuckDBInstance.create(':memory:')
  const conn = await duckDb.connect()

  const selects = await Promise.all(
    inputs.map(async (input, fileIdx) => {
      const describe = await conn.run(
        `DESCRIBE SELECT * FROM read_parquet(${sqlString(input.filePath)})`,
      )
      const columns = new Set<string>()
      for (let c = 0; c < describe.chunkCount; c += 1) {
        for (const row of describe.getChunk(c).getRows()) {
          if (typeof row[0] === 'string') columns.add(row[0])
        }
      }
      const slugProjection = columns.has('slug') ? 'slug' : 'CAST(NULL AS VARCHAR) AS slug'
      return `
      SELECT
        timestamp_us,
        local_timestamp_us,
        market_id,
        ${slugProjection},
        asset_id,
        bids,
        asks,
        ${sqlString(input.filePath)} AS __file_path,
        ${sqlString(input.side)} AS __side,
        ${fileIdx} AS __file_idx
      FROM read_parquet(${sqlString(input.filePath)})
    `
    }),
  )
  const result = await conn.run(`
    ${selects.join('\nUNION ALL\n')}
    ORDER BY timestamp_us, local_timestamp_us, asset_id, __side, __file_idx
  `)

  let currentTs: bigint | null = null
  let group: ParsedTick[] = []

  const flush = async (): Promise<void> => {
    if (group.length === 0) return
    await onGroup(group)
    group = []
  }

  for (let c = 0; c < result.chunkCount; c += 1) {
    const rows = result.getChunk(c).getRows()
    for (const row of rows) {
      const filePath = String(row[7])
      const side = row[8] === 'up' ? 'up' : row[8] === 'down' ? 'down' : null
      if (!side) {
        stats.dropped += 1
        continue
      }
      const tick = parseDuckRow(row, filePath, side)
      if (!tick) {
        stats.dropped += 1
        continue
      }
      stats.loaded += 1
      if (currentTs !== null && tick.tsUs !== currentTs) {
        await flush()
      }
      currentTs = tick.tsUs
      group.push(tick)
    }
  }

  await flush()
  return stats
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
