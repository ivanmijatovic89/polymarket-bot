import { randomUUID } from 'node:crypto'
import type { FeedCallbacks, IngressStamp, RecordedMarket } from '../types.js'
import { ingressStamp, parseObject } from './transport.js'

const MAX_FAILURE_BACKOFF_MS = 300_000

function retryAfterDeadline(value: string | null, receivedAtMs: number): number {
  if (!value?.trim()) return 0
  const text = value.trim()
  if (/^\d+$/.test(text)) return receivedAtMs + Number(text) * 1_000
  // HTTP dates start with a weekday; Date.parse alone also accepts invalid numeric delays.
  if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(text)) return 0
  const date = Date.parse(text)
  return Number.isFinite(date) && date > receivedAtMs ? date : 0
}

function nestedRateLimit(parsed: Record<string, unknown> | null): boolean {
  const error = parsed?.error
  if (typeof error === 'string') return /^Chainlink API error 429\b/i.test(error)
  if (!error || typeof error !== 'object' || Array.isArray(error)) return false
  const code = (error as Record<string, unknown>).code
  return code === 429 || code === '429'
}

export function priceToBeatUrl(
  market: RecordedMarket,
  nowMs: number,
  baseUrl = 'https://polymarket.com',
): string {
  const url = new URL('/api/crypto/crypto-price', baseUrl)
  url.searchParams.set('symbol', 'BTC')
  url.searchParams.set('eventStartTime', new Date(market.startMs).toISOString())
  url.searchParams.set('endDate', new Date(market.endMs).toISOString())
  // Verified against Polymarket's public frontend; this endpoint is not a stable public API.
  url.searchParams.set('variant', market.timeframe === '5m' ? 'fiveminute' : 'fifteen')
  url.searchParams.set('twapEnabled', String(market.twapEnabled))
  if (market.twapLookbackSeconds !== null)
    url.searchParams.set('twapLookbackSeconds', String(market.twapLookbackSeconds))
  url.searchParams.set('ts', String(nowMs))
  return url.toString()
}

export type PriceToBeatOptions = FeedCallbacks & {
  market: RecordedMarket
  fetch?: typeof fetch
  clock?: () => IngressStamp
  baseUrl?: string
  timeoutMs?: number
  pollMs?: number
  correctionPollMs?: number
}

/** Capture the response body before parsing, including nulls, corrections and HTTP failures. */
export function createPriceToBeatFeed(options: PriceToBeatOptions) {
  const clock = options.clock ?? ingressStamp
  const connectionId = randomUUID()
  let running = false
  let timer: NodeJS.Timeout | undefined
  let request: AbortController | undefined
  let hasPrice = false
  let generation = 0
  let consecutiveFailures = 0
  let failureBackoffMs = 0
  let learnedCooldownMs = 0
  let nextAttemptAtMs = 0
  const initialPollMs = Math.max(100, options.pollMs ?? 1_000)
  const correctionPollMs = Math.max(100, options.correctionPollMs ?? 30_000)
  const report = (
    reason: string,
    received: IngressStamp,
    retryAfter: string | null = null,
    rateLimited = false,
  ) => {
    consecutiveFailures = Math.min(16, consecutiveFailures + 1)
    const baseMs = rateLimited
      ? Math.max(initialPollMs, correctionPollMs)
      : hasPrice
        ? correctionPollMs
        : initialPollMs
    failureBackoffMs = Math.min(MAX_FAILURE_BACKOFF_MS, baseMs * 2 ** consecutiveFailures)
    if (rateLimited) learnedCooldownMs = Math.max(learnedCooldownMs, failureBackoffMs)
    options.onStatus({
      source: 'price_to_beat',
      connectionId,
      kind: 'error',
      stamp: received,
      marketSlug: options.market.slug,
      reason,
      details: {
        retryBackoffMs: Math.max(learnedCooldownMs, failureBackoffMs),
        ...(retryAfter === null ? {} : { retryAfter }),
      },
    })
  }
  const schedule = (currentGeneration: number, nowMs: number) => {
    if (nowMs >= options.market.endMs) return
    // A long server deadline must never overflow Node's timer into an immediate retry.
    // Waking at market end only retires the poller; poll checks the deadline again.
    const delay = Math.min(
      Math.max(1, nextAttemptAtMs - nowMs),
      options.market.endMs - nowMs,
      2_147_483_647,
    )
    timer = setTimeout(() => void poll(currentGeneration), delay)
  }
  const poll = async (currentGeneration: number) => {
    if (!running || currentGeneration !== generation) return
    const before = clock()
    if (before.receivedAtMs >= options.market.endMs) return
    if (before.receivedAtMs < nextAttemptAtMs) {
      schedule(currentGeneration, before.receivedAtMs)
      return
    }
    if (before.receivedAtMs < options.market.startMs) {
      timer = setTimeout(
        () => void poll(currentGeneration),
        Math.min(1_000, options.market.startMs - before.receivedAtMs),
      )
      return
    }
    request = new AbortController()
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 10_000)
    const signal = AbortSignal.any([timeout, request.signal])
    const url = priceToBeatUrl(options.market, before.receivedAtMs, options.baseUrl)
    let serverDeadlineMs = 0
    let retryAfter: string | null = null
    let rateLimited = false
    try {
      const response = await (options.fetch ?? fetch)(url, {
        signal,
        headers: { accept: 'application/json' },
      })
      retryAfter = response.headers.get('retry-after')
      serverDeadlineMs = retryAfterDeadline(retryAfter, clock().receivedAtMs)
      rateLimited = response.status === 429 || serverDeadlineMs > 0
      const rawJson = await response.text()
      const received = clock()
      if (!running || currentGeneration !== generation) return
      options.onFrame({
        source: 'price_to_beat',
        connectionId,
        rawJson,
        stamp: received,
        marketSlug: options.market.slug,
        request: { url, httpStatus: response.status, startedAtMs: before.receivedAtMs },
      })
      const parsed = parseObject(rawJson)
      rateLimited ||= nestedRateLimit(parsed)
      if (!response.ok)
        report(`price_to_beat_http_${response.status}`, received, retryAfter, rateLimited)
      else {
        if (!parsed || !('openPrice' in parsed))
          report('price_to_beat_invalid_response', received, retryAfter, rateLimited)
        else if (parsed.openPrice !== null) {
          const open = Number(parsed.openPrice)
          if (
            (typeof parsed.openPrice === 'number' || typeof parsed.openPrice === 'string') &&
            Number.isFinite(open) &&
            open > 0
          ) {
            hasPrice = true
            consecutiveFailures = 0
            failureBackoffMs = 0
          } else report('price_to_beat_invalid_open_price', received, retryAfter, rateLimited)
        }
      }
    } catch {
      if (running && currentGeneration === generation)
        report('price_to_beat_request_failed', clock(), retryAfter, rateLimited)
    } finally {
      if (running && currentGeneration === generation) {
        request = undefined
        const nowMs = clock().receivedAtMs
        // Keep the learned cooldown for this market. One success must not restart
        // an alternating success/429 loop; a new market starts with normal polling.
        const delay = Math.max(
          hasPrice ? correctionPollMs : initialPollMs,
          failureBackoffMs,
          learnedCooldownMs,
        )
        nextAttemptAtMs = Math.max(nowMs + delay, serverDeadlineMs)
        schedule(currentGeneration, nowMs)
      }
    }
  }
  return {
    start() {
      if (running) return
      running = true
      generation++
      void poll(generation)
    },
    stop() {
      running = false
      generation++
      if (timer) clearTimeout(timer)
      request?.abort()
      timer = undefined
      request = undefined
    },
  }
}
