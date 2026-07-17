import type {
  AnyMarketMessage,
  BookMessage,
  MarketOrderBooksSnapshot,
  PriceChange,
  PriceChangeMessage,
} from '../../market/orderbook/index.js'
import { MarketEngine } from '../../market/MarketEngine.js'
import { openParquetReaderWithEpermFallback } from '../../cli/helpers/openParquetReader.js'
import { toBigInt } from '../../utils/toBigInt.js'

type Source = { kind: 'parquet'; filePath: string; ingestSeq: bigint; tsLocalMs?: number }

type ReplayApplyEvent = {
  msg: AnyMarketMessage
  rawJson: string
  market: string
  source: Source
}

type TypedDeltaRow = {
  ingest_seq?: unknown
  event_type?: unknown
  ts_exchange_ms?: unknown
  ts_local_ms?: unknown
  market?: unknown
  asset0_id?: unknown
  asset1_id?: unknown
  asset_index?: unknown
  bid_prices?: unknown
  bid_sizes?: unknown
  ask_prices?: unknown
  ask_sizes?: unknown
  change_asset_indexes?: unknown
  change_side_codes?: unknown
  change_prices?: unknown
  change_sizes?: unknown
}

type DecodedTypedEvent = { msg: AnyMarketMessage; market: string }

function repeatedValues(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : []
}

function stringValue(raw: unknown): string | null {
  if (typeof raw === 'string') return raw
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  if (typeof raw === 'bigint') return raw.toString()
  if (raw && typeof raw === 'object' && 'toString' in raw) {
    // @dsnp/parquetjs may surface UTF8 values as Buffer.
    const s = String(raw)
    return s.length > 0 ? s : null
  }
  return null
}

function assetIdForIndex(row: TypedDeltaRow, index: number): string | null {
  if (index === 0 && typeof row.asset0_id === 'string' && row.asset0_id.trim() !== '') {
    return row.asset0_id
  }
  if (index === 1 && typeof row.asset1_id === 'string' && row.asset1_id.trim() !== '') {
    return row.asset1_id
  }
  return null
}

function sideForCode(raw: unknown): 'BUY' | 'SELL' | null {
  const code = Number(raw)
  if (code === 0) return 'BUY'
  if (code === 1) return 'SELL'
  return null
}

function buildBookSide(
  pricesRaw: unknown,
  sizesRaw: unknown,
): Array<{ price: string; size: string }> {
  const prices = repeatedValues(pricesRaw)
  const sizes = repeatedValues(sizesRaw)
  const n = Math.min(prices.length, sizes.length)
  const levels: Array<{ price: string; size: string }> = []
  for (let i = 0; i < n; i += 1) {
    const price = stringValue(prices[i])
    const size = stringValue(sizes[i])
    if (price === null || size === null) continue
    levels.push({ price, size })
  }
  return levels
}

function buildEventFromTyped(row: TypedDeltaRow): DecodedTypedEvent | null {
  const market = typeof row.market === 'string' && row.market.trim() !== '' ? row.market : null
  const tsMs = toBigInt(row.ts_exchange_ms, -1n)
  if (!market || tsMs < 0n) return null
  const timestamp = String(tsMs)

  if (row.event_type === 'book') {
    const assetIndex = Number(row.asset_index)
    const assetId = Number.isInteger(assetIndex) ? assetIdForIndex(row, assetIndex) : null
    if (!assetId) return null
    const msg: BookMessage = {
      event_type: 'book',
      market,
      asset_id: assetId,
      bids: buildBookSide(row.bid_prices, row.bid_sizes),
      asks: buildBookSide(row.ask_prices, row.ask_sizes),
      timestamp,
      hash: '',
    }
    return { msg, market }
  }

  if (row.event_type === 'price_change') {
    const changes: PriceChange[] = []
    const assetIndexes = repeatedValues(row.change_asset_indexes)
    const sideCodes = repeatedValues(row.change_side_codes)
    const prices = repeatedValues(row.change_prices)
    const sizes = repeatedValues(row.change_sizes)
    const n = Math.min(assetIndexes.length, sideCodes.length, prices.length, sizes.length)
    for (let i = 0; i < n; i += 1) {
      const assetIndex = Number(assetIndexes[i])
      const assetId = Number.isInteger(assetIndex) ? assetIdForIndex(row, assetIndex) : null
      const side = sideForCode(sideCodes[i])
      const price = stringValue(prices[i])
      const size = stringValue(sizes[i])
      if (!assetId || side === null || price === null || size === null) continue
      changes.push({
        asset_id: assetId,
        side,
        price,
        size,
        hash: '',
        best_bid: '',
        best_ask: '',
      })
    }
    if (changes.length === 0) return null
    const msg: PriceChangeMessage = {
      event_type: 'price_change',
      market,
      price_changes: changes,
      timestamp,
    }
    return { msg, market }
  }

  return null
}

export async function replayTelonexDeltaParquetForMarket(params: {
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
      const row = (await cursor.next()) as TypedDeltaRow | null
      if (!row) break

      const event = buildEventFromTyped(row)
      if (!event) continue

      // Telonex's recorder receive time — the replay stand-in for the bot's
      // wall clock; backtest feed visibility keys off it (see EngineSource).
      const tsLocalMs = Number(toBigInt(row.ts_local_ms, 0n))
      const source: Source = {
        kind: 'parquet',
        filePath: params.filePath,
        ingestSeq: toBigInt(row.ingest_seq, 0n),
        ...(tsLocalMs > 0 ? { tsLocalMs } : {}),
      }
      eng.getOrderBookEngine().applyAny(event.msg)

      await params.onSnapshot(eng.snapshot(), {
        msg: event.msg,
        rawJson: '',
        market: event.market,
        source,
      })
    }
  } finally {
    await reader.close().catch(() => undefined)
  }
}
