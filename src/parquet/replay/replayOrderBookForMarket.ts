import type { AnyMarketMessage, MarketOrderBooksSnapshot } from '../../market/orderbook/index.js'
import { MarketEngine } from '../../market/MarketEngine.js'
import { decodeMarketChannelFrame } from '../../market/marketChannelDecoder.js'
import { openParquetReaderWithEpermFallback } from '../../cli/helpers/openParquetReader.js'
import { sleep } from '../../utils/sleep.js'
import { toBigInt } from '../../utils/toBigInt.js'
import { MinHeap } from '../../utils/minHeap.js'

type ReplayRow = {
  ingest_seq?: unknown
  ts_local_ms?: unknown
  ts_exchange_ms?: unknown
  event_type?: unknown
  raw_json?: unknown
}

export type ReplayApplyEvent = {
  msg: AnyMarketMessage
  rawJson: string
  market: string
  source: { kind: 'parquet'; filePath: string; ingestSeq: bigint; tsLocalMs?: number }
}

/**
 * Replay parquet WS events and reconstruct order books tick-by-tick.
 *
 * The market is auto-detected from the first decoded event.
 * All assets within that market are replayed (e.g. both tokens).
 */
export async function replayOrderBookForMarket(params: {
  filePaths: string[]
  order?: 'recorded' | 'exchange_time'
  timeDriven?: boolean
  shouldStop?: () => boolean
  onSnapshot: (
    snapshot: MarketOrderBooksSnapshot,
    rawEvent: ReplayApplyEvent,
  ) => void | Promise<void>
}): Promise<void> {
  const filePaths = params.filePaths
  if (filePaths.length === 0)
    throw new Error('[backtest] replayOrderBookForMarket: filePaths is required')

  const order = params.order ?? 'recorded'
  const timeDriven = params.timeDriven ?? false

  const readers = []
  try {
    for (const filePath of filePaths) {
      readers.push(await openParquetReaderWithEpermFallback(filePath))
    }

    const cursors = readers.map((r) => r.getCursor())

    const heap = new MinHeap()
    for (let i = 0; i < cursors.length; i += 1) {
      const row = (await cursors[i]!.next()) as ReplayRow | null
      if (!row) continue
      const tsLocal = toBigInt(row.ts_local_ms, 0n)
      const tsEx = toBigInt(row.ts_exchange_ms, tsLocal)
      const keyTs = order === 'exchange_time' ? tsEx : tsLocal
      const keySeq = toBigInt(row.ingest_seq, 0n)
      heap.push({ fileIdx: i, row, keySeq, keyTs })
    }

    let rawFrame = ''
    let activeMarket: string | undefined
    const eng = new MarketEngine({
      onTick: async (tick) => {
        if (tick.source.kind !== 'parquet') throw new Error('Expected parquet replay source')
        await params.onSnapshot(tick.snapshot, {
          msg: tick.msg,
          rawJson: rawFrame,
          market: tick.msg.market,
          source: tick.source,
        })
      },
    })

    let prevKeyTs: bigint | undefined
    while (true) {
      if (params.shouldStop?.()) break
      const item = heap.pop()
      if (!item) break

      if (timeDriven) {
        if (prevKeyTs !== undefined && item.keyTs >= prevKeyTs) {
          const delta = item.keyTs - prevKeyTs
          const ms = Number(delta > 10_000n ? 10_000n : delta)
          await sleep(ms)
        }
        prevKeyTs = item.keyTs
      }

      const row = item.row
      const rowEventType = typeof row.event_type === 'string' ? row.event_type : undefined
      const rawJson =
        typeof row.raw_json === 'string' ? row.raw_json : JSON.stringify(row.raw_json ?? null)
      const ingestSeq = toBigInt(row.ingest_seq, 0n)
      const filePath = filePaths[item.fileIdx] ?? '(unknown)'
      // Recorder receive time, surfaced on the tick source so backtest feed
      // visibility can use the same clock live uses (the bot's wall clock).
      const tsLocalMs = Number(toBigInt(row.ts_local_ms, 0n))

      // Fast-path skip for non-market-channel types without JSON parse.
      if (
        rowEventType &&
        rowEventType !== 'book' &&
        rowEventType !== 'price_change' &&
        rowEventType !== 'tick_size_change' &&
        rowEventType !== 'last_trade_price'
      ) {
        // skip
      } else {
        const source: ReplayApplyEvent['source'] = {
          kind: 'parquet',
          filePath,
          ingestSeq,
          ...(tsLocalMs > 0 ? { tsLocalMs } : {}),
        }
        rawFrame = rawJson
        const messages = decodeMarketChannelFrame(rawJson)
        activeMarket ??= messages[0]?.market
        const selected = messages.filter((message) => message.market === activeMarket)
        if (selected.length) await eng.handleRaw({ rawJson: JSON.stringify(selected), source })
      }

      const next = (await cursors[item.fileIdx]!.next()) as ReplayRow | null
      if (next) {
        const tsLocal = toBigInt(next.ts_local_ms, 0n)
        const tsEx = toBigInt(next.ts_exchange_ms, tsLocal)
        const keyTs = order === 'exchange_time' ? tsEx : tsLocal
        const keySeq = toBigInt(next.ingest_seq, 0n)
        heap.push({ fileIdx: item.fileIdx, row: next, keySeq, keyTs })
      }
    }
  } finally {
    await Promise.all(readers.map((r) => r.close().catch(() => undefined)))
  }
}
