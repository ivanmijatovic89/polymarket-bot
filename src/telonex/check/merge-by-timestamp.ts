import path from 'node:path'
import { promises as fs } from 'node:fs'

import { openParquetReaderWithEpermFallback } from '../../cli/helpers/openParquetReader.js'

type Row = {
  timestamp_us?: unknown
  local_timestamp_us?: unknown
  asset_id?: unknown
  outcome?: unknown
}

type ParsedRow = {
  timestampUs: bigint
  localTimestampUs: bigint | null
  assetId: string
  outcome: string | null
  file: string
}

type Side = 'up' | 'down'

type InputFile = {
  filePath: string
  side: Side
}

type TimestampSideStats = {
  rows: number
  distinctAssets: Set<string>
}

type TimestampStats = {
  up: TimestampSideStats
  down: TimestampSideStats
}

function parseBigInt(v: unknown): bigint | null {
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

function parseRow(row: Row, file: string): ParsedRow | null {
  const timestampUs = parseBigInt(row.timestamp_us)
  if (timestampUs === null) return null

  const localTimestampUs = parseBigInt(row.local_timestamp_us)
  const assetId = typeof row.asset_id === 'string' ? row.asset_id : null
  if (!assetId || assetId.trim() === '') return null

  return {
    timestampUs,
    localTimestampUs,
    assetId,
    outcome: typeof row.outcome === 'string' ? row.outcome : null,
    file,
  }
}

function sideFromFilename(filePath: string): Side | null {
  const name = path.basename(filePath).toLowerCase()
  if (name.includes('_up_')) return 'up'
  if (name.includes('_down_')) return 'down'
  return null
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

async function readRows(file: InputFile): Promise<ParsedRow[]> {
  const reader = await openParquetReaderWithEpermFallback(file.filePath)
  const cursor = reader.getCursor()
  const rows: ParsedRow[] = []

  try {
    while (true) {
      const row = (await cursor.next()) as Row | null
      if (!row) break
      const parsed = parseRow(row, file.filePath)
      if (!parsed) continue
      rows.push(parsed)
    }
  } finally {
    await reader.close().catch(() => undefined)
  }

  return rows
}

function getOrCreateTimestampStats(map: Map<bigint, TimestampStats>, ts: bigint): TimestampStats {
  const existing = map.get(ts)
  if (existing) return existing
  const fresh: TimestampStats = {
    up: { rows: 0, distinctAssets: new Set<string>() },
    down: { rows: 0, distinctAssets: new Set<string>() },
  }
  map.set(ts, fresh)
  return fresh
}

async function main(): Promise<void> {
  const dirArg = process.argv[2]
  if (!dirArg) {
    console.error(
      'Usage: tsx src/parquet/cli/telonex/check-telonex-merge-by-timestamp.ts <directory>',
    )
    process.exit(2)
  }

  const dir = path.resolve(dirArg)
  const files = await resolveInputFiles(dir)
  if (files.length === 0) {
    console.error(`[check-telonex-merge] No book_snapshot_full_*.parquet files found in: ${dir}`)
    process.exit(2)
  }

  const upFiles = files.filter((f) => f.side === 'up')
  const downFiles = files.filter((f) => f.side === 'down')

  console.log(`[check-telonex-merge] directory=${dir}`)
  console.log(`[check-telonex-merge] up_files=${upFiles.length} down_files=${downFiles.length}`)

  const allRowsBySide: { up: ParsedRow[]; down: ParsedRow[] } = { up: [], down: [] }
  for (const file of files) {
    const rows = await readRows(file)
    allRowsBySide[file.side].push(...rows)
    console.log(
      `[check-telonex-merge] loaded side=${file.side} file=${path.basename(file.filePath)} rows=${rows.length}`,
    )
  }

  const byTimestamp = new Map<bigint, TimestampStats>()
  for (const side of ['up', 'down'] as const) {
    for (const row of allRowsBySide[side]) {
      const stats = getOrCreateTimestampStats(byTimestamp, row.timestampUs)
      const sideStats = stats[side]
      sideStats.rows += 1
      sideStats.distinctAssets.add(row.assetId)
    }
  }

  let bothSides = 0
  let upOnly = 0
  let downOnly = 0
  let mismatchedRowCounts = 0
  let mismatchedDistinctAssets = 0

  const examplesUpOnly: string[] = []
  const examplesDownOnly: string[] = []
  const examplesRowMismatch: string[] = []

  const sortedTimestamps = [...byTimestamp.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

  for (const ts of sortedTimestamps) {
    const stats = byTimestamp.get(ts)!
    const upRows = stats.up.rows
    const downRows = stats.down.rows
    const upAssets = stats.up.distinctAssets.size
    const downAssets = stats.down.distinctAssets.size

    if (upRows > 0 && downRows > 0) {
      bothSides += 1
      if (upRows !== downRows) {
        mismatchedRowCounts += 1
        if (examplesRowMismatch.length < 10) {
          examplesRowMismatch.push(`ts=${ts.toString()} up_rows=${upRows} down_rows=${downRows}`)
        }
      }
      if (upAssets !== downAssets) mismatchedDistinctAssets += 1
    } else if (upRows > 0) {
      upOnly += 1
      if (examplesUpOnly.length < 10) examplesUpOnly.push(ts.toString())
    } else if (downRows > 0) {
      downOnly += 1
      if (examplesDownOnly.length < 10) examplesDownOnly.push(ts.toString())
    }
  }

  const canTimestampMergeStrict =
    upOnly === 0 && downOnly === 0 && mismatchedRowCounts === 0 && mismatchedDistinctAssets === 0
  const canTimestampMergeLoose = upOnly === 0 && downOnly === 0

  const totalUpRows = allRowsBySide.up.length
  const totalDownRows = allRowsBySide.down.length

  console.log('\n[check-telonex-merge] summary')
  console.log(`total_timestamps=${sortedTimestamps.length}`)
  console.log(`both_sides_timestamps=${bothSides}`)
  console.log(`up_only_timestamps=${upOnly}`)
  console.log(`down_only_timestamps=${downOnly}`)
  console.log(`mismatched_row_counts_at_same_timestamp=${mismatchedRowCounts}`)
  console.log(`mismatched_distinct_asset_counts_at_same_timestamp=${mismatchedDistinctAssets}`)
  console.log(`total_up_rows=${totalUpRows}`)
  console.log(`total_down_rows=${totalDownRows}`)
  console.log(`timestamp_merge_safe_loose=${canTimestampMergeLoose}`)
  console.log(`timestamp_merge_safe_strict=${canTimestampMergeStrict}`)

  if (examplesUpOnly.length > 0) {
    console.log('\n[check-telonex-merge] up_only_examples')
    for (const e of examplesUpOnly) console.log(e)
  }

  if (examplesDownOnly.length > 0) {
    console.log('\n[check-telonex-merge] down_only_examples')
    for (const e of examplesDownOnly) console.log(e)
  }

  if (examplesRowMismatch.length > 0) {
    console.log('\n[check-telonex-merge] row_mismatch_examples')
    for (const e of examplesRowMismatch) console.log(e)
  }
}

main().catch((err) => {
  console.error('[check-telonex-merge] fatal', err)
  process.exit(1)
})
