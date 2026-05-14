import type {
  AnyMarketMessage,
  BookMessage,
  MarketOrderBooksSnapshot,
} from '../../market/orderbook/index.js'
import { MarketEngine } from '../../market/MarketEngine.js'
import { openParquetReaderWithEpermFallback } from '../../cli/helpers/openParquetReader.js'
import { toBigInt } from '../../utils/toBigInt.js'

type Source = { kind: 'parquet'; filePath: string; ingestSeq: bigint }

type ReplayApplyEvent = {
  msg: AnyMarketMessage
  rawJson: string
  market: string
  source: Source
}

type PairedRow = {
  ingest_seq?: unknown
  event_type?: unknown
  ts_exchange_ms?: unknown
  market?: unknown
  up_asset_id?: unknown
  down_asset_id?: unknown
  up_bids?: unknown
  up_asks?: unknown
  down_bids?: unknown
  down_asks?: unknown
}

function parseLevelsEncoded(raw: unknown): { price: string; size: string }[] {
  if (typeof raw !== 'string' || raw === '') return []
  const parts = raw.split(';')
  const out: { price: string; size: string }[] = []
  for (const part of parts) {
    if (!part) continue
    const at = part.indexOf('@')
    if (at <= 0 || at >= part.length - 1) continue
    const price = part.slice(0, at)
    const size = part.slice(at + 1)
    out.push({ price, size })
  }
  return out
}

function buildBookMessageFromTyped(args: {
  market: string
  tsMs: bigint
  assetId: unknown
  bidsEncoded: unknown
  asksEncoded: unknown
}): BookMessage | null {
  const assetId = typeof args.assetId === 'string' ? args.assetId : null
  if (!assetId || assetId.trim() === '') return null
  return {
    market: args.market,
    asset_id: assetId,
    bids: parseLevelsEncoded(args.bidsEncoded),
    asks: parseLevelsEncoded(args.asksEncoded),
    timestamp: args.tsMs.toString(),
    event_type: 'book',
    hash: '',
  }
}

export async function replayTelonexPairedParquetForMarket(params: {
  filePath: string
  shouldStop?: () => boolean
  onSnapshot: (
    snapshot: MarketOrderBooksSnapshot,
    rawEvent: ReplayApplyEvent,
  ) => void | Promise<void>
}): Promise<void> {
  const reader = await openParquetReaderWithEpermFallback(params.filePath)
  const cursor = reader.getCursor()
  const eng = new MarketEngine()

  try {
    while (true) {
      if (params.shouldStop?.()) break
      const row = (await cursor.next()) as PairedRow | null
      if (!row) break
      if (row.event_type !== 'orderbook_pair') continue

      const baseSeq = toBigInt(row.ingest_seq, 0n)
      const typedMarket = typeof row.market === 'string' ? row.market : null
      const typedTsMs = toBigInt(row.ts_exchange_ms, -1n)
      if (!typedMarket || typedMarket.trim() === '' || typedTsMs < 0n) continue
      const upMsg = buildBookMessageFromTyped({
        market: typedMarket,
        tsMs: typedTsMs,
        assetId: row.up_asset_id,
        bidsEncoded: row.up_bids,
        asksEncoded: row.up_asks,
      })
      const downMsg = buildBookMessageFromTyped({
        market: typedMarket,
        tsMs: typedTsMs,
        assetId: row.down_asset_id,
        bidsEncoded: row.down_bids,
        asksEncoded: row.down_asks,
      })
      if (!upMsg || !downMsg) continue

      const downSource: Source = {
        kind: 'parquet',
        filePath: params.filePath,
        ingestSeq: baseSeq * 2n + 2n,
      }

      eng.getOrderBookEngine().applyAny(upMsg)
      eng.getOrderBookEngine().applyAny(downMsg)

      await params.onSnapshot(eng.snapshot(), {
        msg: downMsg,
        rawJson: '',
        market: downMsg.market,
        source: downSource,
      })
    }
  } finally {
    await reader.close().catch(() => undefined)
  }
}
