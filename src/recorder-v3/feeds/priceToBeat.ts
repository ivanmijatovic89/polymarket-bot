import { randomUUID } from 'node:crypto'
import type { FeedCallbacks, IngressStamp, RecordedMarket } from '../types.js'
import { ingressStamp, parseObject } from './transport.js'

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
  const report = (reason: string, received: IngressStamp) =>
    options.onStatus({
      source: 'price_to_beat',
      connectionId,
      kind: 'error',
      stamp: received,
      marketSlug: options.market.slug,
      reason,
    })
  const poll = async (currentGeneration: number) => {
    if (!running || currentGeneration !== generation) return
    const before = clock()
    if (before.receivedAtMs >= options.market.endMs) return
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
    try {
      const response = await (options.fetch ?? fetch)(url, {
        signal,
        headers: { accept: 'application/json' },
      })
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
      if (!response.ok) report(`price_to_beat_http_${response.status}`, received)
      else {
        const parsed = parseObject(rawJson)
        if (!parsed || !('openPrice' in parsed)) report('price_to_beat_invalid_response', received)
        else if (parsed.openPrice !== null) {
          const open = Number(parsed.openPrice)
          if (Number.isFinite(open) && open > 0) hasPrice = true
          else report('price_to_beat_invalid_open_price', received)
        }
      }
    } catch {
      if (running && currentGeneration === generation)
        report('price_to_beat_request_failed', clock())
    } finally {
      if (running && currentGeneration === generation) {
        request = undefined
        const delay = hasPrice ? (options.correctionPollMs ?? 30_000) : (options.pollMs ?? 1_000)
        timer = setTimeout(() => void poll(currentGeneration), Math.max(100, delay))
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
