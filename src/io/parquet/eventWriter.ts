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
  windowStartMs: number
  filePath: string
  writer: parquet.ParquetWriter
  sawBook: boolean
}

export class RotatingParquetEventRecorder {
  private readonly baseDir: string
  private readonly windowMs: number

  private readonly writersByMarket = new Map<string, WriterState>()

  constructor(opts: RotatingRecorderOptions) {
    this.baseDir = opts.baseDir
    this.windowMs = opts.windowMs
  }

  async append(row: RawMarketEventRow): Promise<void> {
    const marketId = row.market ?? 'unknown'
    const tsExchangeMs = row.ts_exchange_ms ? Number(row.ts_exchange_ms) : Number(row.ts_local_ms)
    const windowStartMs = floorToWindowStart(tsExchangeMs, this.windowMs)

    let state = this.writersByMarket.get(marketId)
    if (!state || state.windowStartMs !== windowStartMs) {
      if (state) await this.closeMarket(marketId)
      state = await this.openMarketWindow({ marketId, windowStartMs })
      this.writersByMarket.set(marketId, state)
    }

    if (row.event_type === 'book') state.sawBook = true
    if (!state.sawBook && row.event_type !== 'book') {
      // Not fatal, but it means this file may not be self-contained for replay.
      // We still record to avoid gaps.
      // eslint-disable-next-line no-console
      console.warn(
        `[recorder] market=${marketId} windowStart=${state.windowStartMs} saw non-book before book (${row.event_type})`,
      )
    }

    await state.writer.appendRow(row)
  }

  async closeAll(): Promise<void> {
    const markets = [...this.writersByMarket.keys()]
    await Promise.all(markets.map((m) => this.closeMarket(m)))
  }

  async closeMarket(marketId: string): Promise<void> {
    const state = this.writersByMarket.get(marketId)
    if (!state) return
    this.writersByMarket.delete(marketId)
    await state.writer.close()
    // eslint-disable-next-line no-console
    console.log(`[recorder] closed parquet file ${state.filePath}`)
  }

  private async openMarketWindow(args: { marketId: string; windowStartMs: number }): Promise<WriterState> {
    const windowStartLabel = formatWindowStartUtc(args.windowStartMs)
    const dir = path.join(this.baseDir, `market=${args.marketId}`, `windowStart=${windowStartLabel}`)
    await mkdir(dir, { recursive: true })

    const filePath = path.join(dir, 'events.parquet')
    const writer = await parquet.ParquetWriter.openFile(rawMarketEventParquetSchema, filePath)

    // eslint-disable-next-line no-console
    console.log(`[recorder] opened parquet file ${filePath}`)

    return {
      marketId: args.marketId,
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

export function formatWindowStartUtc(windowStartMs: number): string {
  const d = new Date(windowStartMs)
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0')
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0')
  const dd = d.getUTCDate().toString().padStart(2, '0')
  const hh = d.getUTCHours().toString().padStart(2, '0')
  const mi = d.getUTCMinutes().toString().padStart(2, '0')
  return `${yyyy}${mm}${dd}_${hh}${mi}UTC`
}

