import { createParquetReplaySource } from '../ingest/replay/parquetReplaySource.js'
import { createMarketEventHandler } from '../engine/marketEventHandler.js'
import { installProcessCrashHandlers, installSignalHandlers } from '../utils/runtime.js'
import * as parquet from '@dsnp/parquetjs'
import { MarketOrderBookEngine } from '../orderbook/OrderBookEngine.js'
import type {
  AnyMarketMessage,
  BookMessage,
  LastTradePriceMessage,
  PriceChangeMessage,
  TickSizeChangeMessage,
} from '../orderbook/OrderBookEngine.js'
import type { MarketOrderBooksSnapshot } from '../orderbook/OrderBookEngine.js'

installProcessCrashHandlers({ prefix: 'backtest' })

function parseOrderValue(raw: string | undefined): 'recorded' | 'exchange_time' {
  if (raw === 'recorded' || raw === 'exchange_time') return raw
  return 'recorded'
}

type BacktestMode = 'raw' | 'orderbook'

function parseModeValue(raw: string | undefined): BacktestMode {
  if (raw === 'orderbook') return 'orderbook'
  return 'raw'
}

function parseArgs(argv: string[]): {
  filePaths: string[]
  mode: BacktestMode
  order: 'recorded' | 'exchange_time'
  timeDriven: boolean
} {
  const filePaths: string[] = []
  let order: 'recorded' | 'exchange_time' = 'recorded'
  let timeDriven = false
  let mode: BacktestMode = 'raw'

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (!a) continue

    if (a === '--mode') {
      mode = parseModeValue(argv[i + 1])
      i += 1
      continue
    }
    if (a === '--order') {
      order = parseOrderValue(argv[i + 1])
      i += 1 // consume value
      continue
    }
    if (a === '--time-driven' || a === '--realtime') {
      timeDriven = true
      continue
    }
    if (a.startsWith('-')) {
      // Unknown flag: ignore for now.
      continue
    }

    filePaths.push(a)
  }

  return { filePaths, mode, order, timeDriven }
}

type ReplayRow = {
  ingest_seq?: unknown
  ts_local_ms?: unknown
  ts_exchange_ms?: unknown
  event_type?: unknown
  raw_json?: unknown
}

function toBigInt(v: unknown, fallback: bigint): bigint {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v))
  if (typeof v === 'string' && v.trim() !== '') {
    try {
      return BigInt(v)
    } catch {
      return fallback
    }
  }
  return fallback
}

type HeapItem = {
  fileIdx: number
  row: ReplayRow
  keySeq: bigint
  keyTs: bigint
}

function less(a: HeapItem, b: HeapItem): boolean {
  // Requirement: sort by ingest_seq (tick-by-tick replay).
  if (a.keySeq !== b.keySeq) return a.keySeq < b.keySeq
  if (a.keyTs !== b.keyTs) return a.keyTs < b.keyTs
  return a.fileIdx < b.fileIdx
}

class MinHeap {
  private readonly arr: HeapItem[] = []

  size(): number {
    return this.arr.length
  }

  push(x: HeapItem): void {
    this.arr.push(x)
    this.bubbleUp(this.arr.length - 1)
  }

  pop(): HeapItem | undefined {
    const n = this.arr.length
    if (n === 0) return undefined
    const top = this.arr[0]
    const last = this.arr.pop()
    if (last && n > 1) {
      this.arr[0] = last
      this.bubbleDown(0)
    }
    return top
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const p = Math.floor((i - 1) / 2)
      const parent = this.arr[p]
      const cur = this.arr[i]
      if (!parent || !cur) return
      if (!less(cur, parent)) return
      this.arr[p] = cur
      this.arr[i] = parent
      i = p
    }
  }

  private bubbleDown(i: number): void {
    const n = this.arr.length
    while (true) {
      const l = i * 2 + 1
      const r = i * 2 + 2
      let smallest = i
      if (l < n && less(this.arr[l]!, this.arr[smallest]!)) smallest = l
      if (r < n && less(this.arr[r]!, this.arr[smallest]!)) smallest = r
      if (smallest === i) return
      const tmp = this.arr[i]!
      this.arr[i] = this.arr[smallest]!
      this.arr[smallest] = tmp
      i = smallest
    }
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((r) => setTimeout(r, ms))
}

function parseWsJson(rawJson: string): unknown {
  try {
    return JSON.parse(rawJson)
  } catch {
    return null
  }
}

function asRecord(x: unknown): Record<string, unknown> | null {
  if (!x || typeof x !== 'object') return null
  return x as Record<string, unknown>
}

type ReplayApplyEvent = { msg: AnyMarketMessage; rawJson: string; market: string }

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

  const readers = await Promise.all(filePaths.map((p) => parquet.ParquetReader.openFile(p)))
  try {
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

    let activeMarket: string | undefined

    const marketEngine = new MarketOrderBookEngine()

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
        const obj = parseWsJson(rawJson)
        const rec = asRecord(obj)
        if (rec) {
          const eventType =
            (typeof rec.event_type === 'string' ? rec.event_type : rowEventType) ?? 'unknown'

          // Ignore synthetic markers recorded by record-live.ts.
          if (
            eventType === 'disconnect' ||
            eventType === 'window_end' ||
            eventType === 'writer_lag_disconnect'
          ) {
            // ignore
          } else {
            const m = rec.market
            const market = typeof m === 'string' ? m : undefined
            if (market) {
              if (!activeMarket) activeMarket = market
              if (activeMarket !== market) {
                // Files are expected to be single-market, but be defensive.
                // Ignore other-market rows.
              } else {
                // Decode a message and apply it to the market-level engine (which manages all assets).
                let msg: AnyMarketMessage | null = null
                if (eventType === 'book') msg = rec as unknown as BookMessage
                else if (eventType === 'price_change') msg = rec as unknown as PriceChangeMessage
                else if (eventType === 'tick_size_change')
                  msg = rec as unknown as TickSizeChangeMessage
                else if (eventType === 'last_trade_price')
                  msg = rec as unknown as LastTradePriceMessage

                if (msg) {
                  marketEngine.applyAny(msg)
                  await params.onSnapshot(marketEngine.snapshot(), {
                    msg,
                    rawJson,
                    market: activeMarket,
                  })
                }
              }
            }
          }
        }
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

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const parsed = parseArgs(args)
  const filePaths = parsed.filePaths
  if (filePaths.length === 0) {
    console.error(
      'Usage:\n' +
        '  Raw replay (existing):\n' +
        '    tsx src/scripts/backtest.ts <file1.parquet> [file2.parquet ...] [--order recorded|exchange_time] [--time-driven]\n' +
        '  Orderbook replay:\n' +
        '    tsx src/scripts/backtest.ts --mode orderbook <file1.parquet> [file2.parquet ...] [--order recorded|exchange_time]',
    )
    process.exit(2)
  }

  if (parsed.mode === 'orderbook') {
    console.log(`[backtest] mode=orderbook files=${filePaths.length}`)
    console.log(`[backtest] order=${parsed.order}`)

    let shouldStop = false
    const shutdown = (signal: 'SIGINT' | 'SIGTERM'): void => {
      console.log(`[backtest] ${signal} received, stopping...`)
      shouldStop = true
    }
    installSignalHandlers({ onSignal: shutdown })

    let events = 0
    const byType = new Map<string, number>()

    await replayOrderBookForMarket({
      filePaths,
      order: parsed.order,
      shouldStop: () => shouldStop,
      onSnapshot: (snap, raw) => {
        if (shouldStop) return
        events += 1
        byType.set(raw.msg.event_type, (byType.get(raw.msg.event_type) ?? 0) + 1)
        // Keep console reasonably quiet: print a summary every 100 events.
        if (events % 100 === 0) {
          console.log('[orderbook]', {
            n: events,
            ts: snap.timestamp,
            market: snap.market,
            assets: Object.keys(snap.byAssetId).length,
          })
        }

        // For debugging/inspection: on each `book` snapshot, print the full order book (all levels).
        if (raw.msg.event_type === 'book') {
          console.log('[orderbook:full]', {
            n: events,
            ts: snap.timestamp,
            market: snap.market,
            byAssetId: snap.byAssetId,
          })
        }
      },
    })

    console.log('[backtest] orderbook summary', {
      events,
      byType: Object.fromEntries([...byType.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    })
    return
  }

  const order = parsed.order
  const timeDriven = parsed.timeDriven

  console.log(`[backtest] files=${filePaths.length}`)
  console.log(`[backtest] order=${order}`)
  console.log(`[backtest] timeDriven=${timeDriven}`)

  const handler = createMarketEventHandler()

  let doneResolve: (() => void) | undefined
  const done = new Promise<void>((resolve) => {
    doneResolve = resolve
  })

  const source = createParquetReplaySource({ filePaths, order, timeDriven })

  source.onEvent((ev) => {
    handler.handle(ev)
  })

  source.onStatus((s) => {
    if (s.kind === 'connected') {
      console.log(`[backtest] started (${s.info ?? 'parquet'})`)
      return
    }
    if (s.kind === 'disconnected') {
      console.log(`[backtest] finished (${s.info ?? 'done'})`)
      doneResolve?.()
      return
    }
    if (s.kind === 'reconnecting') {
      // replay source doesn't reconnect, but keep this for interface parity
      console.log(`[backtest] reconnecting in ${s.delayMs}ms (${s.info ?? ''})`)
    }
  })

  const shutdown = (signal: 'SIGINT' | 'SIGTERM'): void => {
    console.log(`[backtest] ${signal} received, stopping...`)
    source.stop()
  }
  installSignalHandlers({ onSignal: shutdown })

  source.start()
  await done

  const snap = handler.snapshot()
  console.log('[backtest] summary', snap)
}

main().catch((err) => {
  console.error('[backtest] failed', err)
  process.exit(1)
})
