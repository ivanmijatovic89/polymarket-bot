import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { atomicWrite, readJson, writeJson } from './files.js'
import type { ApiRow } from './types.js'

export type Params = Record<string, string | number | boolean>
export interface ApiStats {
  requests: number
  retries: number
  response_bytes: number
  request_ms: number
  cache_pages: number
  endpoints: Record<string, number>
}
interface Checkpoint {
  query: string
  pages: number
  cursor: string | null
  complete: boolean
  seen_cursors: string[]
}
interface Page {
  data: ApiRow[]
  pagination: { next_cursor: string | null }
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export class ApiClient {
  readonly stats: ApiStats = {
    requests: 0,
    retries: 0,
    response_bytes: 0,
    request_ms: 0,
    cache_pages: 0,
    endpoints: {},
  }
  private nextRequest = 0
  private endpointNext = new Map<string, number>()
  private cooldownUntil = 0

  constructor(
    private readonly options: {
      requestsPerSecond?: number
      fetch?: typeof fetch
      sleep?: (ms: number) => Promise<void>
      dataUrl?: string
      gammaUrl?: string
      attempts?: number
      now?: () => number
    } = {},
  ) {}

  private async wait(ms: number): Promise<void> {
    if (ms > 0) await (this.options.sleep ?? ((n) => new Promise((r) => setTimeout(r, n))))(ms)
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  private async reserve(endpoint: string, gamma: boolean): Promise<void> {
    // 90% of the documented sliding-window ceilings (checked 2026-10-04).
    // Separate endpoint budgets let activity and positions share the general
    // allowance without either family exceeding 200 requests / 10 seconds.
    const endpointRate = gamma
      ? 27
      : endpoint === '/v2/trades'
        ? 27
        : endpoint === '/v2/status'
          ? 9
          : endpoint === '/v2/activity' || endpoint === '/v2/positions'
            ? 18
            : 72
    const key = `${gamma ? 'gamma' : 'data'}:${endpoint}`
    for (;;) {
      const now = this.now()
      const due = Math.max(
        now,
        this.nextRequest,
        this.endpointNext.get(key) ?? 0,
        this.cooldownUntil,
      )
      this.nextRequest = due + 1000 / (this.options.requestsPerSecond ?? 32)
      this.endpointNext.set(key, due + 1000 / endpointRate)
      await this.wait(due - now)
      // A concurrent response may have paused the client while this slot slept.
      if (this.cooldownUntil <= due) return
    }
  }

  async get(endpoint: string, params: Params = {}, gamma = false): Promise<unknown> {
    const base = gamma
      ? (this.options.gammaUrl ?? 'https://gamma-api.polymarket.com')
      : (this.options.dataUrl ?? 'https://data-api.polymarket.com')
    const url = new URL(endpoint, base)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
    const attempts = this.options.attempts ?? 6
    let lastError: unknown
    for (let attempt = 0; attempt < attempts; attempt++) {
      const family = endpoint.split('?')[0]!
      await this.reserve(family, gamma)
      const started = Date.now()
      this.stats.requests++
      this.stats.endpoints[family] = (this.stats.endpoints[family] ?? 0) + 1
      try {
        const response = await (this.options.fetch ?? fetch)(url, {
          signal: AbortSignal.timeout(30_000),
        })
        const body = await response.text()
        this.stats.response_bytes += Buffer.byteLength(body)
        this.stats.request_ms += Date.now() - started
        if (response.ok) return JSON.parse(body) as unknown
        const error = new HttpError(
          response.status,
          `${endpoint}: HTTP ${response.status} ${body.slice(0, 300)}`,
        )
        if (response.status !== 429 && response.status < 500) throw error
        lastError = error
        if (attempt + 1 < attempts) {
          const header = response.headers.get('retry-after')
          const retryMs = header
            ? /^\d+(?:\.\d+)?$/.test(header)
              ? Number(header) * 1000
              : Date.parse(header) - Date.now()
            : 0
          this.stats.retries++
          const delay = Math.max(500 * 2 ** attempt, Number.isFinite(retryMs) ? retryMs : 0)
          // Delay subsequent slots too, preventing other workers from ignoring
          // a server-wide throttle while only the failed request waits.
          this.cooldownUntil = Math.max(this.cooldownUntil, this.now() + delay)
          await this.wait(delay)
        }
      } catch (error) {
        if (error instanceof HttpError) throw error
        lastError = error
        if (attempt + 1 < attempts) {
          this.stats.retries++
          await this.wait(500 * 2 ** attempt)
        }
      }
    }
    throw lastError ?? new Error(`Request failed: ${endpoint}`)
  }

  async walk(endpoint: string, params: Params, cacheRoot: string): Promise<ApiRow[]> {
    const query = JSON.stringify([
      endpoint,
      Object.entries(params).sort(([a], [b]) => a.localeCompare(b)),
    ])
    const key = createHash('sha256').update(query).digest('hex')
    const directory = path.join(cacheRoot, key)
    const stateFile = path.join(directory, 'checkpoint.json')
    const initial = (): Checkpoint => ({
      query,
      pages: 0,
      cursor: null,
      complete: false,
      seen_cursors: [],
    })
    let state = (await readJson<Checkpoint>(stateFile)) ?? initial()
    if (state.query !== query) throw new Error('Checkpoint query mismatch')
    let restarted = false
    while (!state.complete) {
      let raw: unknown
      try {
        // Feed cursors carry only the anchor. Preserve every original filter.
        raw = await this.get(endpoint, {
          ...params,
          ...(state.cursor ? { cursor: state.cursor } : {}),
        })
      } catch (error) {
        if (state.cursor && !restarted && error instanceof HttpError && error.status === 400) {
          state = initial()
          restarted = true
          await writeJson(stateFile, state)
          continue
        }
        throw error
      }
      const page = raw as Partial<Page>
      if (
        !page ||
        !Array.isArray(page.data) ||
        !page.pagination ||
        !(page.pagination.next_cursor === null || typeof page.pagination.next_cursor === 'string')
      ) {
        throw new Error(`${endpoint}: invalid paginated response`)
      }
      const cursor = page.pagination.next_cursor
      if (cursor !== null && (cursor === state.cursor || state.seen_cursors.includes(cursor))) {
        throw new Error(`${endpoint}: repeated cursor; refusing a looping/incomplete download`)
      }
      // Publish the page before advancing the checkpoint. An interrupted write
      // is fetched again at the same page number, never appended as a new fill.
      await atomicWrite(
        path.join(directory, `${state.pages}.json.gz`),
        gzipSync(JSON.stringify(page.data)),
      )
      state = {
        ...state,
        pages: state.pages + 1,
        cursor,
        complete: cursor === null,
        seen_cursors: cursor ? [...state.seen_cursors, cursor] : state.seen_cursors,
      }
      await writeJson(stateFile, state)
    }
    const rows: ApiRow[] = []
    for (let i = 0; i < state.pages; i++) {
      const page = JSON.parse(
        gunzipSync(await readFile(path.join(directory, `${i}.json.gz`))).toString(),
      ) as ApiRow[]
      rows.push(...page)
      this.stats.cache_pages++
    }
    return rows
  }
}

export async function parallelMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid concurrency')
  const results = new Array<R>(items.length)
  let next = 0
  let failed = false
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failed) {
      const i = next++
      if (i >= items.length) return
      try {
        results[i] = await fn(items[i]!, i)
      } catch (error) {
        failed = true
        throw error
      }
    }
  })
  const settled = await Promise.allSettled(workers)
  const failure = settled.find((r) => r.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
  return results
}
