import * as parquet from '@dsnp/parquetjs'

import type {
  MarketEvent,
  MarketEventSource,
  MarketEventStatus,
} from '../ingest/marketEventSource.js'

type ReplayRow = {
  ingest_seq?: unknown
  ts_local_ms?: unknown
  ts_exchange_ms?: unknown
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

export type ParquetReplayOrder = 'recorded' | 'exchange_time'

export type ParquetReplaySourceOptions = {
  filePaths: string[]
  /**
   * - recorded: emit rows in the order stored inside each file, and merge files
   *   deterministically using (ts_local_ms, ingest_seq, file_index).
   * - exchange_time: merge deterministically using (ts_exchange_ms ?? ts_local_ms, ingest_seq, file_index)
   */
  order?: ParquetReplayOrder
  /**
   * If true, replay will sleep based on (ts_exchange_ms ?? ts_local_ms) deltas.
   * Default false (event-driven / as-fast-as-possible).
   */
  timeDriven?: boolean
}

type HeapItem = {
  fileIdx: number
  row: ReplayRow
  keyTs: bigint
  keySeq: bigint
}

function less(a: HeapItem, b: HeapItem): boolean {
  if (a.keyTs !== b.keyTs) return a.keyTs < b.keyTs
  if (a.keySeq !== b.keySeq) return a.keySeq < b.keySeq
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

export function createParquetReplaySource(opts: ParquetReplaySourceOptions): MarketEventSource {
  const filePaths = opts.filePaths
  if (filePaths.length === 0) throw new Error('[parquetReplay] filePaths is required')

  const order: ParquetReplayOrder = opts.order ?? 'recorded'
  const timeDriven = opts.timeDriven ?? false

  const eventListeners = new Set<(ev: MarketEvent) => void>()
  const statusListeners = new Set<(s: MarketEventStatus) => void>()

  let running = false
  let shouldStop = false
  let loopPromise: Promise<void> | undefined

  let readers: parquet.ParquetReader[] = []

  const emitEvent = (ev: MarketEvent): void => {
    for (const cb of eventListeners) cb(ev)
  }

  const emitStatus = (s: MarketEventStatus): void => {
    for (const cb of statusListeners) cb(s)
  }

  const closeReaders = async (): Promise<void> => {
    const rs = readers
    readers = []
    await Promise.all(rs.map((r) => r.close().catch(() => undefined)))
  }

  const getKey = (row: ReplayRow): { keyTs: bigint; keySeq: bigint } => {
    const tsLocal = toBigInt(row.ts_local_ms, 0n)
    const tsEx = toBigInt(row.ts_exchange_ms, tsLocal)
    const keyTs = order === 'exchange_time' ? tsEx : tsLocal
    const keySeq = toBigInt(row.ingest_seq, 0n)
    return { keyTs, keySeq }
  }

  const run = async (): Promise<void> => {
    emitStatus({ kind: 'connected', attempt: 1, info: `parquet:${filePaths.length} file(s)` })

    readers = await Promise.all(filePaths.map((p) => parquet.ParquetReader.openFile(p)))
    const cursors = readers.map((r) => r.getCursor())

    const heap = new MinHeap()
    for (let i = 0; i < cursors.length; i += 1) {
      const row = (await cursors[i]!.next()) as ReplayRow | null
      if (!row) continue
      const k = getKey(row)
      heap.push({ fileIdx: i, row, keyTs: k.keyTs, keySeq: k.keySeq })
    }

    let prevKeyTs: bigint | undefined
    while (!shouldStop) {
      const item = heap.pop()
      if (!item) break

      const raw =
        typeof item.row.raw_json === 'string'
          ? item.row.raw_json
          : JSON.stringify(item.row.raw_json ?? null)
      const tsLocalMs = toBigInt(item.row.ts_local_ms, item.keyTs)

      if (timeDriven) {
        if (prevKeyTs !== undefined && item.keyTs >= prevKeyTs) {
          const delta = item.keyTs - prevKeyTs
          const ms = Number(delta > 10_000n ? 10_000n : delta)
          // Cap to avoid extremely long sleeps on gaps; gaps should be handled by synthetic markers.
          await sleep(ms)
        }
        prevKeyTs = item.keyTs
      }

      emitEvent({ tsLocalMs, raw })

      const next = (await cursors[item.fileIdx]!.next()) as ReplayRow | null
      if (next) {
        const k = getKey(next)
        heap.push({ fileIdx: item.fileIdx, row: next, keyTs: k.keyTs, keySeq: k.keySeq })
      }
    }

    await closeReaders()
    emitStatus({ kind: 'disconnected', attempt: 1, info: shouldStop ? 'stopped' : 'eof' })
  }

  return {
    start: () => {
      if (running) return
      running = true
      shouldStop = false
      loopPromise = run().catch(async (err) => {
        emitStatus({ kind: 'disconnected', attempt: 1, info: `replay failed: ${String(err)}` })
        await closeReaders()
      })
    },
    stop: () => {
      if (!running) return
      shouldStop = true
      running = false
      void loopPromise?.finally(() => undefined)
      void closeReaders()
    },
    onEvent: (cb) => {
      eventListeners.add(cb)
      return () => eventListeners.delete(cb)
    },
    onStatus: (cb) => {
      statusListeners.add(cb)
      return () => statusListeners.delete(cb)
    },
  }
}
