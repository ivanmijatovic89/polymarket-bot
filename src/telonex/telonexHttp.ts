/**
 * Shared Telonex HTTP download primitives.
 *
 * SINGLE SOURCE OF TRUTH for the authenticated Telonex file fetch — used by
 * the per-market raw downloader (`download-raw-files.ts`) and the per-asset
 * `crypto_prices` downloader (`cryptoPrices/download-crypto-prices.ts`). The
 * endpoint returns a 302 to a pre-signed S3 URL; `fetch` follows it, so the
 * response body IS the parquet file.
 *
 * Error taxonomy (callers branch on it, so keep it stable):
 * - 404 → `{ notFound: true }` — the file does not exist for those params.
 * - 429 → `HttpError(kind='rateLimit')` with `retryAfterMs` — retry after the
 *   server-suggested delay WITHOUT consuming a retry attempt.
 * - 403 → `HttpError(kind='downloadLimit')` — the plan's download budget is
 *   exhausted (or the subscription lapsed). NOT retryable; abort the run.
 * - other non-2xx → `HttpError(kind='http')` — retryable with backoff.
 */

export const TELONEX_DOWNLOAD_BASE = 'https://api.telonex.io/v1/downloads/polymarket'

export type TelonexHttpErrorKind = 'rateLimit' | 'downloadLimit' | 'http'

export class HttpError extends Error {
  constructor(
    public status: number,
    public retryAfterMs: number | null,
    message: string,
    public kind: TelonexHttpErrorKind = 'http',
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export function parseRetryAfter(h: string | null): number | null {
  if (!h) return null
  const n = Number(h)
  if (!isNaN(n)) return Math.max(0, n * 1000)
  const t = Date.parse(h)
  if (!isNaN(t)) return Math.max(0, t - Date.now())
  return null
}

export function readTelonexApiKey(prefix = 'telonex'): string {
  const k = process.env.TELONEX_API_KEY
  if (!k || k.trim() === '') throw new Error(`[${prefix}] TELONEX_API_KEY is required`)
  return k.trim()
}

export type TelonexFetchOk = {
  buffer: Buffer
  sourceEtag: string | null
  /** X-Downloads-Remaining response header, when the plan meters downloads. */
  downloadsRemaining: number | null
}

export async function fetchTelonexFile(
  url: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<TelonexFetchOk | { notFound: true }> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    redirect: 'follow',
    signal,
  })
  // Cancel unread bodies on every non-success path so the underlying socket
  // is released immediately (undici keeps it reserved until the body settles).
  const discardBody = (): void => {
    void res.body?.cancel().catch(() => {})
  }
  if (res.status === 404) {
    discardBody()
    return { notFound: true }
  }
  if (res.status === 429) {
    discardBody()
    const ra = parseRetryAfter(res.headers.get('retry-after'))
    throw new HttpError(429, ra ?? 4000, `429 Too Many Requests`, 'rateLimit')
  }
  if (res.status === 403) {
    discardBody()
    const remaining = res.headers.get('x-downloads-remaining')
    throw new HttpError(
      403,
      null,
      `403 Forbidden — download limit exceeded or subscription required` +
        (remaining !== null ? ` (X-Downloads-Remaining: ${remaining})` : ''),
      'downloadLimit',
    )
  }
  if (!res.ok) {
    discardBody()
    throw new HttpError(res.status, null, `HTTP ${res.status} ${res.statusText}`)
  }
  if (!res.body) throw new HttpError(500, null, 'empty body')
  const buffer = Buffer.from(await res.arrayBuffer())
  const remainingRaw = res.headers.get('x-downloads-remaining')
  const remaining = remainingRaw !== null ? Number(remainingRaw) : NaN
  return {
    buffer,
    sourceEtag: res.headers.get('etag')?.replace(/^"|"$/g, '') ?? null,
    downloadsRemaining: Number.isFinite(remaining) ? remaining : null,
  }
}

/** Abortable sleep; rejects with Error('aborted') when the signal fires. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'))
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(t)
      reject(new Error('aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
