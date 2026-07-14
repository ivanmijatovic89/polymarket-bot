/**
 * Rate-limited, retrying JSON HTTP client for the Polymarket public APIs.
 *
 * Retry policy (same shape as the telonex download worker, which has been
 * hammering a rate-limited API in production):
 *   - 429: honour `Retry-After` when present, otherwise exponential backoff.
 *     A 429 does NOT consume the retry budget (the server is telling us to slow
 *     down, not that the request is bad) — it has its own separate cap.
 *   - 5xx / network errors: exponential backoff, capped retry budget.
 *   - 4xx (other than 429): thrown immediately; retrying won't help.
 *
 * Callers pass a shared `RateLimiter` so that N concurrent workers respect one
 * global requests/second budget.
 */

import type { RateLimiter } from './rateLimiter.js'

const MAX_RETRIES = 4
const RETRY_DELAYS_MS = [500, 1500, 4000, 8000]
const MAX_429_RETRIES = 10
const DEFAULT_429_BACKOFF_MS = 2000

export class PolymarketHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | null,
    readonly url: string,
    readonly body: string,
  ) {
    super(`HTTP ${status} for ${url}: ${body.slice(0, 200)}`)
    this.name = 'PolymarketHttpError'
  }
}

export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000)
  const at = Date.parse(header)
  if (!Number.isNaN(at)) return Math.max(0, at - Date.now())
  return null
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export type JsonFetchOptions = {
  limiter: RateLimiter
  signal?: AbortSignal
  /** Prefix for warn logs, e.g. `[polymarket-data:sync-markets]`. */
  label?: string
}

/**
 * GET `url` and parse the JSON body. Rate-limited and retried.
 *
 * NOTE: `response.json()` is used rather than jq-style strict parsing because
 * Gamma occasionally emits raw control characters inside description strings;
 * V8's parser accepts them, stricter parsers do not.
 */
export async function fetchJson<T>(url: string, opts: JsonFetchOptions): Promise<T> {
  const label = opts.label ?? '[polymarket-data:http]'
  let retries = 0
  let rateLimitRetries = 0

  for (;;) {
    await opts.limiter.acquire()
    try {
      const res = await fetch(url, { signal: opts.signal ?? null })

      if (res.status === 429) {
        rateLimitRetries += 1
        if (rateLimitRetries > MAX_429_RETRIES) {
          throw new PolymarketHttpError(429, null, url, await safeText(res))
        }
        const waitMs =
          parseRetryAfter(res.headers.get('retry-after')) ??
          DEFAULT_429_BACKOFF_MS * rateLimitRetries
        console.warn(
          `${label} 429 rate limited, retry ${rateLimitRetries}/${MAX_429_RETRIES} in ${waitMs}ms`,
        )
        await sleep(waitMs, opts.signal)
        continue
      }

      if (res.status >= 500) {
        throw new PolymarketHttpError(res.status, null, url, await safeText(res))
      }
      if (!res.ok) {
        // 4xx: deterministic, do not retry.
        throw new PolymarketHttpError(res.status, null, url, await safeText(res))
      }

      return (await res.json()) as T
    } catch (err) {
      if (opts.signal?.aborted) throw err
      const retryable =
        !(err instanceof PolymarketHttpError) || err.status >= 500 || err.status === 429
      if (!retryable || retries >= MAX_RETRIES) throw err
      const waitMs = RETRY_DELAYS_MS[retries] ?? 8000
      retries += 1
      console.warn(
        `${label} request failed (${(err as Error).message}); retry ${retries}/${MAX_RETRIES} in ${waitMs}ms`,
      )
      await sleep(waitMs, opts.signal)
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}
