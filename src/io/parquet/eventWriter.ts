import * as parquet from '@dsnp/parquetjs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { rawMarketEventParquetSchema } from './eventSchema.js'
import type { RawMarketEventRow } from '../../types/rawEvent.js'

export type RotatingRecorderOptions = {
  /** Root directory where Parquet files are stored */
  baseDir: string
  /** Rotation interval in milliseconds (15min default) */
  windowMs: number
}

type WriterState = {
  marketId: string
  fileKey: string
  windowStartMs: number
  filePath: string
  writer: parquet.ParquetWriter
  sawBook: boolean
}

export class RotatingParquetEventRecorder {
  private readonly baseDir: string
  private readonly windowMs: number

  private readonly writersByMarket = new Map<string, WriterState>()
  private readonly chainByMarket = new Map<string, Promise<void>>()

  constructor(opts: RotatingRecorderOptions) {
    this.baseDir = opts.baseDir
    this.windowMs = opts.windowMs
  }

  async append(row: RawMarketEventRow): Promise<void> {
    const marketId = row.market ?? 'unknown'
    await this.enqueue(marketId, async () => {
      const tsExchangeMs = row.ts_exchange_ms ? Number(row.ts_exchange_ms) : Number(row.ts_local_ms)
      const windowStartMs = floorToWindowStart(tsExchangeMs, this.windowMs)
      const fileKey = safeFileKey(row.market_slug ?? row.market ?? 'unknown')

      let state = this.writersByMarket.get(marketId)

      // We want each file to be self-contained; we only start a file once we see a `book`.
      if (!state && row.event_type !== 'book') return

      if (!state || state.windowStartMs !== windowStartMs || state.fileKey !== fileKey) {
        if (state) await this.closeMarket(marketId)
        if (row.event_type !== 'book') return
        state = await this.openMarketWindow({ marketId, windowStartMs, fileKey })
        this.writersByMarket.set(marketId, state)
      }

      if (row.event_type === 'book') state.sawBook = true
      if (!state.sawBook && row.event_type !== 'book') {
        // Drop pre-book events to keep file self-contained.
        return
      }

      await state.writer.appendRow(row)
    })
  }

  async closeAll(): Promise<void> {
    const chains = [...this.chainByMarket.values()]
    await Promise.all(chains.map((p) => p.catch(() => undefined)))

    const markets = [...this.writersByMarket.keys()]
    for (const m of markets) await this.closeMarket(m)
  }

  async closeMarket(marketId: string): Promise<void> {
    const state = this.writersByMarket.get(marketId)
    if (!state) return
    this.writersByMarket.delete(marketId)
    await state.writer.close()
    console.log(`[recorder] closed parquet file ${state.filePath}`)
  }

  private async enqueue(marketId: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.chainByMarket.get(marketId) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    this.chainByMarket.set(
      marketId,
      next.catch(() => undefined),
    )
    await next
  }

  private async openMarketWindow(args: {
    marketId: string
    windowStartMs: number
    fileKey: string
  }): Promise<WriterState> {
    await mkdir(this.baseDir, { recursive: true })
    const filePath = path.join(this.baseDir, `${args.fileKey}.parquet`)
    const writer = await parquet.ParquetWriter.openFile(rawMarketEventParquetSchema, filePath)

    console.log(`[recorder] opened parquet file ${filePath}`)

    return {
      marketId: args.marketId,
      fileKey: args.fileKey,
      windowStartMs: args.windowStartMs,
      filePath,
      writer,
      sawBook: false,
    }
  }
}

export function floorToWindowStart(tsMs: number, windowMs: number): number {
  return Math.floor(tsMs / windowMs) * windowMs
}

function safeFileKey(s: string): string {
  // Keep it simple and filesystem-safe.
  // Allowed: a-zA-Z0-9._- ; everything else becomes '-'
  return s.replace(/[^a-zA-Z0-9._-]+/g, '-')
}
