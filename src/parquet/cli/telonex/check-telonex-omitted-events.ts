import path from 'node:path'
import { promises as fs } from 'node:fs'

import { openParquetReaderWithEpermFallback } from '../../../cli/helpers/openParquetReader.js'

type Side = 'up' | 'down'

type InputFile = {
  filePath: string
  side: Side
}

type OriginalRow = {
  ingest_seq?: unknown
  ts_exchange_ms?: unknown
  event_type?: unknown
  raw_json?: unknown
}

type TelonexLevel = {
  price?: unknown
  size?: unknown
}

type TelonexRow = {
  timestamp_us?: unknown
  local_timestamp_us?: unknown
  asset_id?: unknown
  bids?: unknown
  asks?: unknown
}

type ParsedOriginalEvent = {
  tsMs: bigint
  ingestSeq: bigint
  eventType: 'book' | 'price_change'
  assetId: string
  bestBid: string
  bestAsk: string
  stateHash: string | null
  price: string | null
  size: string | null
  side: string | null
}

type ParsedTelonexEvent = {
  tsMs: bigint
  assetId: string
  bestBid: string
  bestAsk: string
}

type OmittedEvent = {
  rn: number
  event: ParsedOriginalEvent
  occurrence: number
  telonexCountForKey: number
  prevSameAsset: ParsedOriginalEvent | null
  sameTopAsPrevSameAsset: boolean
  sameHashAsPrevSameAsset: boolean
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

function toStringNum(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return String(n)
  }
  return null
}

function parseLevelArray(v: unknown): TelonexLevel[] | null {
  if (v === null || v === undefined) return []
  if (Array.isArray(v)) return v as TelonexLevel[]
  if (v && typeof v === 'object' && Array.isArray((v as { list?: unknown }).list)) {
    return (v as { list: TelonexLevel[] }).list
  }
  return null
}

function unwrapLevel(v: unknown): TelonexLevel | null {
  if (!v || typeof v !== 'object') return null
  if (
    (v as { element?: unknown }).element &&
    typeof (v as { element?: unknown }).element === 'object'
  ) {
    return (v as { element: TelonexLevel }).element
  }
  return v as TelonexLevel
}

function sideFromFilename(filePath: string): Side | null {
  const n = path.basename(filePath).toLowerCase()
  if (n.includes('_up_')) return 'up'
  if (n.includes('_down_')) return 'down'
  return null
}

function eventKey(args: {
  tsMs: bigint
  assetId: string
  bestBid: string
  bestAsk: string
}): string {
  return `${args.tsMs.toString()}|${args.assetId}|${args.bestBid}|${args.bestAsk}`
}

function cmpOriginal(a: ParsedOriginalEvent, b: ParsedOriginalEvent): number {
  if (a.tsMs !== b.tsMs) return a.tsMs < b.tsMs ? -1 : 1
  if (a.ingestSeq !== b.ingestSeq) return a.ingestSeq < b.ingestSeq ? -1 : 1
  if (a.assetId !== b.assetId) return a.assetId < b.assetId ? -1 : 1
  return 0
}

function cmpBigInt(a: bigint, b: bigint): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

function parseBookBest(raw: Record<string, unknown>): { bestBid: string; bestAsk: string } | null {
  const bids = Array.isArray(raw.bids) ? raw.bids : []
  const asks = Array.isArray(raw.asks) ? raw.asks : []

  let maxBid: number | null = null
  for (const lvl of bids) {
    if (!lvl || typeof lvl !== 'object') continue
    const p = toStringNum((lvl as { price?: unknown }).price)
    if (p === null) continue
    const n = Number(p)
    if (!Number.isFinite(n)) continue
    if (maxBid === null || n > maxBid) maxBid = n
  }

  let minAsk: number | null = null
  for (const lvl of asks) {
    if (!lvl || typeof lvl !== 'object') continue
    const p = toStringNum((lvl as { price?: unknown }).price)
    if (p === null) continue
    const n = Number(p)
    if (!Number.isFinite(n)) continue
    if (minAsk === null || n < minAsk) minAsk = n
  }

  return {
    bestBid: String(maxBid ?? 0),
    bestAsk: String(minAsk ?? 1),
  }
}

function parseOriginalRow(row: OriginalRow): ParsedOriginalEvent[] {
  const ingestSeq = parseBigIntLike(row.ingest_seq)
  const tsMs = parseBigIntLike(row.ts_exchange_ms)
  const eventType = row.event_type
  const rawJson = row.raw_json

  if (ingestSeq === null || tsMs === null || typeof eventType !== 'string') return []
  const rawObj = (() => {
    if (typeof rawJson === 'string') {
      try {
        return JSON.parse(rawJson) as Record<string, unknown>
      } catch {
        return null
      }
    }
    if (rawJson && typeof rawJson === 'object') return rawJson as Record<string, unknown>
    return null
  })()
  if (!rawObj) return []

  if (eventType === 'book') {
    const assetId = typeof rawObj.asset_id === 'string' ? rawObj.asset_id : null
    if (!assetId || assetId.trim() === '') return []
    const best = parseBookBest(rawObj)
    if (!best) return []
    return [
      {
        tsMs,
        ingestSeq,
        eventType: 'book',
        assetId,
        bestBid: best.bestBid,
        bestAsk: best.bestAsk,
        stateHash: typeof rawObj.hash === 'string' ? rawObj.hash : null,
        price: null,
        size: null,
        side: null,
      },
    ]
  }

  if (eventType === 'price_change') {
    const pcs = Array.isArray(rawObj.price_changes) ? rawObj.price_changes : []
    const out: ParsedOriginalEvent[] = []
    for (const c of pcs) {
      if (!c || typeof c !== 'object') continue
      const rec = c as Record<string, unknown>
      const assetId = typeof rec.asset_id === 'string' ? rec.asset_id : null
      const bestBid = toStringNum(rec.best_bid)
      const bestAsk = toStringNum(rec.best_ask)
      if (!assetId || bestBid === null || bestAsk === null) continue
      out.push({
        tsMs,
        ingestSeq,
        eventType: 'price_change',
        assetId,
        bestBid,
        bestAsk,
        stateHash: typeof rec.hash === 'string' ? rec.hash : null,
        price: toStringNum(rec.price),
        size: toStringNum(rec.size),
        side: typeof rec.side === 'string' ? rec.side : null,
      })
    }
    return out
  }

  return []
}

function parseTelonexRow(row: TelonexRow): ParsedTelonexEvent | null {
  const tsUs = parseBigIntLike(row.timestamp_us)
  if (tsUs === null) return null
  const tsMs = tsUs / 1000n

  const assetId = typeof row.asset_id === 'string' ? row.asset_id : null
  if (!assetId || assetId.trim() === '') return null

  const bids = parseLevelArray(row.bids) ?? []
  const asks = parseLevelArray(row.asks) ?? []

  const topBidRaw = bids.length > 0 ? toStringNum(unwrapLevel(bids[0])?.price) : null
  const topAskRaw = asks.length > 0 ? toStringNum(unwrapLevel(asks[0])?.price) : null

  return {
    tsMs,
    assetId,
    bestBid: String(topBidRaw !== null ? Number(topBidRaw) : 0),
    bestAsk: String(topAskRaw !== null ? Number(topAskRaw) : 1),
  }
}

async function resolveTelonexFiles(dir: string): Promise<InputFile[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const out: InputFile[] = []

  for (const e of entries) {
    if (!e.isFile()) continue
    if (!e.name.endsWith('.parquet')) continue
    if (!e.name.startsWith('book_snapshot_full_')) continue
    const filePath = path.join(dir, e.name)
    const side = sideFromFilename(filePath)
    if (!side) continue
    out.push({ filePath, side })
  }

  out.sort((a, b) => a.filePath.localeCompare(b.filePath))
  return out
}

async function loadOriginalEvents(filePath: string): Promise<ParsedOriginalEvent[]> {
  const reader = await openParquetReaderWithEpermFallback(filePath)
  const cursor = reader.getCursor()
  const events: ParsedOriginalEvent[] = []
  try {
    while (true) {
      const row = (await cursor.next()) as OriginalRow | null
      if (!row) break
      const parsed = parseOriginalRow(row)
      if (parsed.length > 0) events.push(...parsed)
    }
  } finally {
    await reader.close().catch(() => undefined)
  }
  events.sort(cmpOriginal)
  return events
}

async function loadTelonexEvents(files: InputFile[]): Promise<ParsedTelonexEvent[]> {
  const out: ParsedTelonexEvent[] = []
  for (const f of files) {
    const reader = await openParquetReaderWithEpermFallback(f.filePath)
    const cursor = reader.getCursor()
    let loaded = 0
    try {
      while (true) {
        const row = (await cursor.next()) as TelonexRow | null
        if (!row) break
        const p = parseTelonexRow(row)
        if (!p) continue
        out.push(p)
        loaded += 1
      }
    } finally {
      await reader.close().catch(() => undefined)
    }
    console.log(`[check-telonex-omitted] loaded file=${path.basename(f.filePath)} rows=${loaded}`)
  }
  return out
}

function countTelonexByKey(
  events: ParsedTelonexEvent[],
  minTs: bigint,
  maxTs: bigint,
): Map<string, number> {
  const m = new Map<string, number>()
  for (const e of events) {
    if (cmpBigInt(e.tsMs, minTs) < 0 || cmpBigInt(e.tsMs, maxTs) > 0) continue
    const k = eventKey(e)
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

function summarize(omitted: OmittedEvent[]): void {
  const total = omitted.length
  const byType = new Map<string, number>()
  let sameTopPrev = 0
  let sameHashPrev = 0
  let both = 0

  for (const o of omitted) {
    byType.set(o.event.eventType, (byType.get(o.event.eventType) ?? 0) + 1)
    if (o.sameTopAsPrevSameAsset) sameTopPrev += 1
    if (o.sameHashAsPrevSameAsset) sameHashPrev += 1
    if (o.sameTopAsPrevSameAsset && o.sameHashAsPrevSameAsset) both += 1
  }

  console.log('\n[check-telonex-omitted] summary')
  console.log(`omitted_total=${total}`)
  for (const [k, v] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`omitted_${k}=${v}`)
  }
  console.log(`omitted_same_top_as_prev_same_asset=${sameTopPrev}`)
  console.log(`omitted_same_hash_as_prev_same_asset=${sameHashPrev}`)
  console.log(`omitted_same_top_and_same_hash=${both}`)
}

function printExamples(omitted: OmittedEvent[], limit: number): void {
  const slice = omitted.slice(0, Math.max(0, limit))
  if (slice.length === 0) return
  console.log('\n[check-telonex-omitted] first_omitted_examples')
  for (const x of slice) {
    console.log(
      JSON.stringify(
        {
          rn: x.rn,
          ingestSeq: x.event.ingestSeq.toString(),
          tsMs: x.event.tsMs.toString(),
          eventType: x.event.eventType,
          assetId: x.event.assetId,
          bestBid: x.event.bestBid,
          bestAsk: x.event.bestAsk,
          occurrence: x.occurrence,
          telonexCountForKey: x.telonexCountForKey,
          sameTopAsPrevSameAsset: x.sameTopAsPrevSameAsset,
          sameHashAsPrevSameAsset: x.sameHashAsPrevSameAsset,
          prevSameAsset: x.prevSameAsset
            ? {
                ingestSeq: x.prevSameAsset.ingestSeq.toString(),
                tsMs: x.prevSameAsset.tsMs.toString(),
                eventType: x.prevSameAsset.eventType,
                bestBid: x.prevSameAsset.bestBid,
                bestAsk: x.prevSameAsset.bestAsk,
                stateHash: x.prevSameAsset.stateHash,
                price: x.prevSameAsset.price,
                size: x.prevSameAsset.size,
                side: x.prevSameAsset.side,
              }
            : null,
          event: {
            stateHash: x.event.stateHash,
            price: x.event.price,
            size: x.event.size,
            side: x.event.side,
          },
        },
        null,
        0,
      ),
    )
  }
}

function parseArgs(argv: string[]): { originalFile: string; telonexDir: string; examples: number } {
  if (argv.length < 2) {
    throw new Error(
      'Usage: tsx src/parquet/cli/telonex/check-telonex-omitted-events.ts <original.parquet> <telonex-dir> [--examples N]',
    )
  }
  const originalFile = path.resolve(argv[0] as string)
  const telonexDir = path.resolve(argv[1] as string)
  let examples = 20
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--examples') {
      const v = argv[i + 1]
      if (!v) throw new Error('--examples requires a number')
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0) throw new Error('--examples must be >= 0')
      examples = Math.trunc(n)
      i += 1
    }
  }
  return { originalFile, telonexDir, examples }
}

async function main(): Promise<void> {
  const { originalFile, telonexDir, examples } = parseArgs(process.argv.slice(2))
  const telFiles = await resolveTelonexFiles(telonexDir)
  if (telFiles.length === 0) {
    throw new Error(
      `[check-telonex-omitted] no book_snapshot_full_*.parquet files in ${telonexDir}`,
    )
  }

  console.log(`[check-telonex-omitted] original=${originalFile}`)
  console.log(`[check-telonex-omitted] telonex_dir=${telonexDir}`)
  console.log(`[check-telonex-omitted] telonex_files=${telFiles.length}`)

  const originalEvents = await loadOriginalEvents(originalFile)
  if (originalEvents.length === 0)
    throw new Error('[check-telonex-omitted] no parsed events in original')
  const telonexEvents = await loadTelonexEvents(telFiles)

  const minTs = originalEvents[0]!.tsMs
  const maxTs = originalEvents[originalEvents.length - 1]!.tsMs
  const telCounts = countTelonexByKey(telonexEvents, minTs, maxTs)

  const occByKey = new Map<string, number>()
  const prevByAsset = new Map<string, ParsedOriginalEvent>()
  const omitted: OmittedEvent[] = []

  let rn = 0
  for (const ev of originalEvents) {
    rn += 1
    const k = eventKey(ev)
    const occ = (occByKey.get(k) ?? 0) + 1
    occByKey.set(k, occ)
    const telCount = telCounts.get(k) ?? 0
    const prev = prevByAsset.get(ev.assetId) ?? null

    if (occ > telCount) {
      omitted.push({
        rn,
        event: ev,
        occurrence: occ,
        telonexCountForKey: telCount,
        prevSameAsset: prev,
        sameTopAsPrevSameAsset:
          prev !== null && prev.bestBid === ev.bestBid && prev.bestAsk === ev.bestAsk,
        sameHashAsPrevSameAsset:
          prev !== null &&
          prev.stateHash !== null &&
          ev.stateHash !== null &&
          prev.stateHash === ev.stateHash,
      })
    }
    prevByAsset.set(ev.assetId, ev)
  }

  console.log(`[check-telonex-omitted] original_parsed_events=${originalEvents.length}`)
  console.log(
    `[check-telonex-omitted] telonex_parsed_events_in_window=${[...telCounts.values()].reduce((a, b) => a + b, 0)}`,
  )
  summarize(omitted)
  printExamples(omitted, examples)
}

main().catch((err) => {
  console.error('[check-telonex-omitted] fatal', err)
  process.exit(1)
})
