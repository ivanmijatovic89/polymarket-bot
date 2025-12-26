import * as parquet from '@dsnp/parquetjs'
import { mkdir, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

import { rawMarketEventParquetSchema } from './eventSchema.js'
import type { RawMarketEventRow } from '../../types/rawEvent.js'

export type RotatingRecorderOptions = {
  /** Root directory where Parquet files are stored */
  baseDir: string
  /** Rotation interval in milliseconds (15min default) */
  windowMs: number
  /**
   * If true (default), partition output by UTC date derived from the window start:
   *   <baseDir>/<YYYY-MM-DD>/<fileKey>.parquet
   */
  partitionByUtcDate?: boolean
  /**
   * Optional hook invoked after a parquet file is finalized (tmp -> final rename).
   * Any error thrown by this hook is caught and logged (finalization still succeeds).
   */
  onFinalized?: (args: FinalPathTransformArgs & { finalPath: string }) => Promise<void> | void
}

export type MarketEventWrite = {
  /** Market identifier used for routing/ordering. Not persisted. */
  marketId: string
  /** File key (e.g. slug) used for output filename. Not persisted. */
  fileKey: string
  /** Persisted row payload (matches Parquet schema). */
  row: RawMarketEventRow
}

export type FinalPathTransformArgs = {
  marketId: string
  fileKey: string
  windowStartMs: number
  filePathFinal: string
}

export type CloseAllOptions = {
  /**
   * Optional hook to change the destination filename when closing writers.
   * Used to mark incomplete recordings (e.g. `*-terminated.parquet`).
   */
  finalPathTransform?: (args: FinalPathTransformArgs) => string
}

type WriterState = {
  marketId: string
  fileKey: string
  windowStartMs: number
  filePathFinal: string
  filePathTmp: string
  writer: parquet.ParquetWriter
  sawBook: boolean
  rowsWritten: number
}

export class RotatingParquetEventRecorder {
  private readonly baseDir: string
  private readonly windowMs: number
  private readonly partitionByUtcDate: boolean
  private readonly onFinalized?: RotatingRecorderOptions['onFinalized']

  private readonly writersByMarket = new Map<string, WriterState>()
  private readonly chainByMarket = new Map<string, Promise<void>>()

  /**
   * Event types that are allowed to create a file even before the first `book`
   * snapshot arrives. This ensures we can persist synthetic markers (like
   * `disconnect`) even if the connection drops before the initial `book`.
   */
  private static readonly OPEN_ON_EVENT_TYPES = new Set<string>([
    'book',
    // Synthetic markers from record-live.ts
    'disconnect',
    'window_end',
    'writer_lag_disconnect',
  ])

  /** Event types that we allow to be written before we see the first `book`. */
  private static readonly ALLOW_BEFORE_BOOK_EVENT_TYPES = new Set<string>([
    'disconnect',
    'window_end',
    'writer_lag_disconnect',
  ])

  constructor(opts: RotatingRecorderOptions) {
    this.baseDir = opts.baseDir
    this.windowMs = opts.windowMs
    this.partitionByUtcDate = opts.partitionByUtcDate ?? true
    this.onFinalized = opts.onFinalized
  }

  async append(write: MarketEventWrite): Promise<void> {
    await this.enqueue(write.marketId, async () => {
      await this.appendUnlocked(write)
    })
  }

  /**
   * Append a batch of rows. Rows are processed in-order per market, but markets
   * may be processed concurrently.
   */
  async appendMany(writes: MarketEventWrite[]): Promise<void> {
    if (writes.length === 0) return

    const byMarket = new Map<string, MarketEventWrite[]>()
    for (const w of writes) {
      const arr = byMarket.get(w.marketId)
      if (arr) arr.push(w)
      else byMarket.set(w.marketId, [w])
    }

    await Promise.all(
      [...byMarket.entries()].map(([marketId, batch]) =>
        this.enqueue(marketId, async () => {
          for (const w of batch) await this.appendUnlocked(w)
        }),
      ),
    )
  }

  async closeAll(opts?: CloseAllOptions): Promise<void> {
    const chains = [...this.chainByMarket.values()]
    await Promise.all(chains.map((p) => p.catch(() => undefined)))

    const markets = [...this.writersByMarket.keys()]
    const errors: Array<{ marketId: string; err: unknown }> = []
    for (const m of markets) {
      try {
        await this.closeMarket(m, opts)
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

  async closeMarket(marketId: string, opts?: CloseAllOptions): Promise<void> {
    const state = this.writersByMarket.get(marketId)
    if (!state) return
    try {
      await state.writer.close()

      // If nothing was written, don't emit a tiny "metadata-only" parquet file.
      // This can happen if the writer opened but the first append failed, or
      // we rotated immediately after opening.
      if (state.rowsWritten === 0) {
        await unlink(state.filePathTmp).catch(() => undefined)
        console.warn(
          `[recorder] dropped empty parquet tmp file ${state.filePathTmp} (rowsWritten=0)`,
        )
        return
      }

      // Only expose finalized parquet files to readers (DuckDB apps fail on missing footer).
      let finalPath = state.filePathFinal
      if (opts?.finalPathTransform) {
        const desired = opts.finalPathTransform({
          marketId: state.marketId,
          fileKey: state.fileKey,
          windowStartMs: state.windowStartMs,
          filePathFinal: state.filePathFinal,
        })
        finalPath = await ensureNonExistingPath(desired)
      }

      await rename(state.filePathTmp, finalPath)
      console.log(`[recorder] closed parquet file ${finalPath} rows=${state.rowsWritten}`)

      if (this.onFinalized) {
        try {
          await this.onFinalized({
            marketId: state.marketId,
            fileKey: state.fileKey,
            windowStartMs: state.windowStartMs,
            filePathFinal: state.filePathFinal,
            finalPath,
          })
        } catch (err) {
          console.warn(
            `[recorder] onFinalized failed for ${finalPath}: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
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

  private async appendUnlocked(write: MarketEventWrite): Promise<void> {
    const marketId = write.marketId
    const row = write.row
    const tsExchangeMs = row.ts_exchange_ms ? Number(row.ts_exchange_ms) : Number(row.ts_local_ms)
    const windowStartMs = floorToWindowStart(tsExchangeMs, this.windowMs)
    const fileKey = safeFileKey(write.fileKey)

    let state = this.writersByMarket.get(marketId)

    const canOpenFile =
      RotatingParquetEventRecorder.OPEN_ON_EVENT_TYPES.has(row.event_type) ||
      row.event_type === 'book'

    // We want each file to be self-contained; in general we start a file once we see a `book`.
    // Exception: allow certain synthetic markers (e.g. `disconnect`) to open a file so we can
    // persist data-gap metadata even if the connection drops before the initial `book`.
    if (!state && !canOpenFile) return

    if (!state || state.windowStartMs !== windowStartMs || state.fileKey !== fileKey) {
      if (state) await this.closeMarket(marketId)
      if (!canOpenFile) return
      state = await this.openMarketWindow({ marketId, windowStartMs, fileKey })
      this.writersByMarket.set(marketId, state)
    }

    if (row.event_type === 'book') state.sawBook = true
    if (
      !state.sawBook &&
      row.event_type !== 'book' &&
      !RotatingParquetEventRecorder.ALLOW_BEFORE_BOOK_EVENT_TYPES.has(row.event_type)
    ) {
      // Drop pre-book events to keep file self-contained.
      return
    }

    await state.writer.appendRow(row)
    state.rowsWritten += 1
  }

  private async openMarketWindow(args: {
    marketId: string
    windowStartMs: number
    fileKey: string
  }): Promise<WriterState> {
    const dir = this.partitionByUtcDate
      ? path.join(this.baseDir, formatUtcYYYYMMDD(args.windowStartMs))
      : this.baseDir
    await mkdir(dir, { recursive: true })
    const filePathFinal = path.join(dir, `${args.fileKey}.parquet`)
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
      rowsWritten: 0,
    }
  }
}

export function floorToWindowStart(tsMs: number, windowMs: number): number {
  return Math.floor(tsMs / windowMs) * windowMs
}

function formatUtcYYYYMMDD(tsMs: number): string {
  // UTC partitioning to keep deterministic behavior across machines.
  // Example: 2025-12-26
  return new Date(tsMs).toISOString().slice(0, 10)
}

function safeFileKey(s: string): string {
  // Keep it simple and filesystem-safe.
  // Allowed: a-zA-Z0-9._- ; everything else becomes '-'
  return s.replace(/[^a-zA-Z0-9._-]+/g, '-')
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'ENOENT'
    )
      return false
    throw err
  }
}

async function ensureNonExistingPath(p: string): Promise<string> {
  if (!(await pathExists(p))) return p

  const ext = path.extname(p)
  const base = p.slice(0, Math.max(0, p.length - ext.length))
  for (let i = 2; ; i += 1) {
    const candidate = `${base}-${i}${ext}`
    if (!(await pathExists(candidate))) return candidate
  }
}
