import type { RecordedMarket, RecorderTimeframe } from './types.js'

export const BTC_TIMEFRAMES: readonly RecorderTimeframe[] = ['5m', '15m']

export function timeframeMs(timeframe: RecorderTimeframe): number {
  return timeframe === '5m' ? 300_000 : 900_000
}

/** Discover current and next markets early enough to obtain their initial books. */
export function candidateBtcSlugs(
  nowMs: number,
  timeframes: readonly RecorderTimeframe[] = BTC_TIMEFRAMES,
): string[] {
  return timeframes.flatMap((timeframe) => {
    const duration = timeframeMs(timeframe)
    const start = Math.floor(nowMs / duration) * duration
    return [start, start + duration].map((ms) => `btc-updown-${timeframe}-${ms / 1_000}`)
  })
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function strings(value: unknown): string[] {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
    throw new Error('Gamma market must contain string outcomes and token IDs')
  }
  return parsed as string[]
}

export function parseRecorderMarket(raw: unknown, expectedSlug?: string): RecordedMarket {
  const market = object(raw)
  if (!market) throw new Error('Gamma market response must be an object')
  const slug = market.slug
  if (typeof slug !== 'string' || (expectedSlug !== undefined && slug !== expectedSlug)) {
    throw new Error('Gamma market slug mismatch')
  }
  const match = /^btc-updown-(5m|15m)-(\d+)$/.exec(slug)
  if (!match) throw new Error(`Unsupported recorder market slug: ${slug}`)
  const timeframe = match[1] as RecorderTimeframe
  const startMs = Number(match[2]) * 1_000
  if (!Number.isSafeInteger(startMs)) throw new Error('Invalid market start time')
  const endMs = startMs + timeframeMs(timeframe)
  if (typeof market.endDate !== 'string' || Date.parse(market.endDate) !== endMs) {
    throw new Error(`Gamma market end time does not match its slug: ${slug}`)
  }
  const tokenIds = strings(market.clobTokenIds)
  const outcomes = strings(market.outcomes)
  if (
    tokenIds.length !== 2 ||
    tokenIds.some((token) => !token) ||
    tokenIds[0] === tokenIds[1] ||
    outcomes.length !== 2 ||
    !outcomes.some((value) => value.toLowerCase() === 'up') ||
    !outcomes.some((value) => value.toLowerCase() === 'down')
  ) {
    throw new Error(`Expected two distinct Up/Down tokens: ${slug}`)
  }
  if (typeof market.conditionId !== 'string' || !market.conditionId) {
    throw new Error(`Missing condition ID: ${slug}`)
  }
  const event = Array.isArray(market.events) ? object(market.events[0]) : null
  const config = object(market.cryptoMarketConfig) ?? object(event?.cryptoMarketConfig)
  if (!config || typeof config.twapEnabled !== 'boolean') {
    throw new Error(`Missing explicit reference-price configuration: ${slug}`)
  }
  if (
    (config.asset !== undefined && config.asset !== 'btc') ||
    (config.duration !== undefined && config.duration !== timeframe)
  ) {
    throw new Error(`Reference-price configuration does not match market: ${slug}`)
  }
  const lookback = config.twapEnabled ? Number(config.twapLookbackSeconds) : null
  // PolyBolt currently supplies only 60-second TWAP. Do not record a changed rule silently.
  if (config.twapEnabled && lookback !== 60) {
    throw new Error(`Unsupported TWAP lookback for ${slug}: ${String(lookback)}`)
  }
  const resolutionSource =
    typeof market.resolutionSource === 'string' ? market.resolutionSource : null
  if (resolutionSource) {
    let provider = ''
    try {
      provider = new URL(resolutionSource).hostname.toLowerCase()
    } catch {
      /* rejected below */
    }
    if (provider !== 'chain.link' && !provider.endsWith('.chain.link')) {
      throw new Error(`Unsupported reference-price provider for ${slug}`)
    }
  }
  return {
    slug,
    symbol: 'btc',
    timeframe,
    conditionId: market.conditionId,
    tokenIds: tokenIds as [string, string],
    outcomes: outcomes as [string, string],
    startMs,
    endMs,
    twapEnabled: config.twapEnabled,
    twapLookbackSeconds: lookback,
    resolutionSource,
    rawJson: JSON.stringify(raw),
  }
}

export type GammaFetchOptions = {
  fetch?: typeof fetch
  baseUrl?: string
  timeoutMs?: number
  signal?: AbortSignal
  /** Called immediately after the complete response body becomes available. */
  onResponse?: (response: { slug: string; rawJson: string; status: number; url: string }) => void
}

/** One bounded request; callers own persistent scheduling/retries. No trading config imports. */
export async function fetchGammaRaw(
  slug: string,
  options: GammaFetchOptions = {},
): Promise<Record<string, unknown> | null> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 10_000)
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout
  const url = `${options.baseUrl ?? 'https://gamma-api.polymarket.com'}/markets/slug/${encodeURIComponent(slug)}`
  const response = await (options.fetch ?? fetch)(url, {
    signal,
    headers: { accept: 'application/json' },
  })
  const rawJson = await response.text()
  options.onResponse?.({ slug, rawJson, status: response.status, url })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Gamma HTTP ${response.status} for ${slug}`)
  const result = object(JSON.parse(rawJson))
  if (!result) throw new Error(`Invalid Gamma response for ${slug}`)
  return result
}

export async function discoverBtcMarkets(
  options: GammaFetchOptions & {
    nowMs: number
    timeframes?: readonly RecorderTimeframe[]
    onError?: (slug: string, error: unknown) => void
  },
): Promise<RecordedMarket[]> {
  const markets = await Promise.all(
    candidateBtcSlugs(options.nowMs, options.timeframes).map(async (slug) => {
      try {
        const raw = await fetchGammaRaw(slug, options)
        return raw ? parseRecorderMarket(raw, slug) : null
      } catch (error) {
        if (!options.onError) throw error
        options.onError(slug, error)
        return null
      }
    }),
  )
  return markets.filter((market): market is RecordedMarket => market !== null)
}
