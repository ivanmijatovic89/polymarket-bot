import * as parquet from '@dsnp/parquetjs'
import { mkdir, rename, unlink } from 'node:fs/promises'
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
  filePathFinal: string
  filePathTmp: string
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
      await this.appendUnlocked(marketId, row)
    })
  }

  /**
   * Append a batch of rows. Rows are processed in-order per market, but markets
   * may be processed concurrently.
   */
  async appendMany(rows: RawMarketEventRow[]): Promise<void> {
    if (rows.length === 0) return

    const byMarket = new Map<string, RawMarketEventRow[]>()
    for (const row of rows) {
      const marketId = row.market ?? 'unknown'
      const arr = byMarket.get(marketId)
      if (arr) arr.push(row)
      else byMarket.set(marketId, [row])
    }

    await Promise.all(
      [...byMarket.entries()].map(([marketId, batch]) =>
        this.enqueue(marketId, async () => {
          for (const row of batch) await this.appendUnlocked(marketId, row)
        }),
      ),
    )
  }

  async closeAll(): Promise<void> {
    const chains = [...this.chainByMarket.values()]
    await Promise.all(chains.map((p) => p.catch(() => undefined)))

    const markets = [...this.writersByMarket.keys()]
    const errors: Array<{ marketId: string; err: unknown }> = []
    for (const m of markets) {
      try {
        await this.closeMarket(m)
      } catch (err) {
        errors.push({ marketId: m, err })
      }
    }

    if (errors.length > 0) {
      const first = errors[0]
      if (!first) throw new Error('[recorder] closeAll: failed but no error captured')
      throw new Error(
        `[recorder] closeAll: ${errors.length} market(s) failed; first market=${first.marketId} err=${String(
          first.err,
        )}`,
      )
    }
  }

  async closeMarket(marketId: string): Promise<void> {
    const state = this.writersByMarket.get(marketId)
    if (!state) return
    try {
      await state.writer.close()

      // Only expose finalized parquet files to readers (DuckDB apps fail on missing footer).
      await rename(state.filePathTmp, state.filePathFinal)
      console.log(`[recorder] closed parquet file ${state.filePathFinal}`)
    } finally {
      // Always drop the state; writer is not reusable after close attempt.
      this.writersByMarket.delete(marketId)
    }
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

  private async appendUnlocked(marketId: string, row: RawMarketEventRow): Promise<void> {
    const tsExchangeMs = row.ts_exchange_ms ? Number(row.ts_exchange_ms) : Number(row.ts_local_ms)
    const windowStartMs = floorToWindowStart(tsExchangeMs, this.windowMs)
    const fileKey = row.market_slug
      ? safeFileKey(row.market_slug)
      : safeFileKey(`market-${marketId}`)

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
  }

  private async openMarketWindow(args: {
    marketId: string
    windowStartMs: number
    fileKey: string
  }): Promise<WriterState> {
    await mkdir(this.baseDir, { recursive: true })
    const filePathFinal = path.join(this.baseDir, `${args.fileKey}.parquet`)
    const filePathTmp = `${filePathFinal}.tmp`

    // Best-effort cleanup if a previous run left a temp file behind.
    await unlink(filePathTmp).catch(() => undefined)

    const writer = await parquet.ParquetWriter.openFile(rawMarketEventParquetSchema, filePathTmp)

    console.log(`[recorder] opened parquet tmp file ${filePathTmp}`)

    return {
      marketId: args.marketId,
      fileKey: args.fileKey,
      windowStartMs: args.windowStartMs,
      filePathFinal,
      filePathTmp,
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
