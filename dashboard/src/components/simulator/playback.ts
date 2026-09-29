import type {
  TraceChunk,
  TraceManifest,
  TraceFrame,
  DisplayState,
} from '@bot/backtest/simulator/contracts'

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store' })
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(
      `Dashboard returned an unexpected response (${response.status}). Reload after the server finishes updating.`,
    )
  }
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`)
  return data as T
}
/** Last entry <= target. Equal clocks retain the original ingest order. */
export function floorIndex<T>(values: readonly T[], target: number, key: (v: T) => number): number {
  let low = 0,
    high = values.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (key(values[mid]!) <= target) low = mid + 1
    else high = mid
  }
  return Math.max(0, low - 1)
}
export type Cursor = { tick: number; actionSeq: number | null }
export type DisplayFrame = {
  frame: TraceFrame
  state: DisplayState
  context: unknown
  actionSeq: number | null
}

export class TraceCache {
  private readonly loaded = new Map<number, TraceChunk>()
  private readonly pending = new Map<number, Promise<TraceChunk>>()
  constructor(
    readonly session: string,
    readonly manifest: TraceManifest,
  ) {}
  async chunk(id: number): Promise<TraceChunk> {
    const cached = this.loaded.get(id)
    if (cached) {
      this.loaded.delete(id)
      this.loaded.set(id, cached)
      return cached
    }
    let pending = this.pending.get(id)
    if (!pending) {
      pending = fetchJson<TraceChunk>(`/api/simulator/${this.session}/chunks/${id}`)
        .then((chunk) => {
          this.loaded.set(id, chunk)
          while (this.loaded.size > 3) this.loaded.delete(this.loaded.keys().next().value!)
          return chunk
        })
        .finally(() => this.pending.delete(id))
      this.pending.set(id, pending)
    }
    return pending
  }
  async at(cursor: Cursor): Promise<DisplayFrame> {
    const index = floorIndex(this.manifest.chunks, cursor.tick, (c) => c.firstTick)
    const chunk = await this.chunk(index)
    const frame = chunk.frames[cursor.tick - this.manifest.chunks[index]!.firstTick]!
    const action =
      cursor.actionSeq === null ? undefined : frame.actions.find((a) => a.seq === cursor.actionSeq)
    return {
      frame,
      state: chunk.states[action?.state ?? frame.state]!,
      context: chunk.contexts[action?.context ?? frame.context],
      actionSeq: action?.seq ?? null,
    }
  }
  async atTime(time: number): Promise<number> {
    const index = floorIndex(this.manifest.chunks, time, (c) => c.startTime)
    const chunk = await this.chunk(index)
    return chunk.frames[floorIndex(chunk.frames, time, (f) => f.time)]!.tick
  }
}
