import type { ExternalFeedsSnapshot } from '../../trading/feeds/externalFeeds.js'
import type { ExternalFeedsRequestConfig } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import type { SyntheticFeedEventType } from '../../market/syntheticTick.js'
import type { CapturedEvent, RecordedMarket, RecorderFeed } from '../types.js'

export function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function finite(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  if (typeof value === 'string' && value.trim() === '') return undefined
  const result = Number(value)
  return Number.isFinite(result) ? result : undefined
}

export function isValidBinancePriceEnvelope(value: unknown): boolean {
  const raw = object(value)
  const data = object(raw?.data)
  if (!raw || !data || data.s !== 'BTCUSDT') return false
  if (raw.stream === 'btcusdt@aggTrade')
    return (
      data.e === 'aggTrade' &&
      typeof data.a === 'number' &&
      Number.isSafeInteger(data.a) &&
      data.a >= 0 &&
      (finite(data.p) ?? 0) > 0 &&
      (finite(data.T) ?? 0) > 0
    )
  if (raw.stream !== 'btcusdt@bookTicker') return false
  return (
    [data.b, data.B, data.a, data.A].every(
      (item) => typeof item === 'string' && /^\d+(?:\.\d+)?$/.test(item),
    ) &&
    (finite(data.b) ?? 0) > 0 &&
    (finite(data.a) ?? 0) > 0 &&
    (finite(data.B) ?? -1) >= 0 &&
    (finite(data.A) ?? -1) >= 0 &&
    ((typeof data.u === 'number' && Number.isSafeInteger(data.u) && data.u >= 0) ||
      (typeof data.u === 'string' && /^\d+$/.test(data.u)))
  )
}

export function isValidPolyBoltPricePoint(value: unknown): boolean {
  const point = object(value)
  return (
    !!point &&
    typeof point.timestamp === 'number' &&
    Number.isFinite(point.timestamp) &&
    point.timestamp > 0 &&
    typeof point.full_accuracy_value === 'string' &&
    /^\d+(?:\.\d+)?$/.test(point.full_accuracy_value) &&
    (finite(point.full_accuracy_value) ?? 0) > 0 &&
    (point.source === undefined || point.source === 'chainlink')
  )
}

export function isValidPolyBoltPriceEnvelope(
  value: unknown,
  twapWindowSeconds: number | null = 60,
): boolean {
  const raw = object(value)
  const payload = object(raw?.payload)
  if (
    !raw ||
    !payload ||
    payload.source !== 'chainlink' ||
    payload.symbol !== 'btcusd' ||
    (raw.snapshot !== undefined && typeof raw.snapshot !== 'boolean')
  )
    return false
  if (raw.channel !== 'price.crypto' && raw.channel !== 'price.crypto.twap') return false
  if (
    raw.channel === 'price.crypto.twap' &&
    (twapWindowSeconds === null || payload.window_seconds !== twapWindowSeconds)
  )
    return false
  const points = raw.snapshot === true ? payload.data : [payload]
  if (raw.snapshot !== true && payload.data !== undefined) return false
  return Array.isArray(points) && points.length > 0 && points.every(isValidPolyBoltPricePoint)
}

export function parseCapturedJson(
  event: Pick<CapturedEvent, 'rawJson' | 'decodedPayload'>,
): unknown {
  if (event.decodedPayload !== undefined) return event.decodedPayload
  try {
    return JSON.parse(event.rawJson)
  } catch {
    return null
  }
}

export type FeedUpdate = {
  feed: RecorderFeed
  snapshot: ExternalFeedsSnapshot
  synthetic?: { eventType: SyntheticFeedEventType; symbol: string }
}

/** Pure receive-order reducer, shared by observed streaming and archived replay. */
export function applyCapturedFeed(
  state: ExternalFeedsSnapshot,
  event: CapturedEvent,
  market: RecordedMarket,
): FeedUpdate | null {
  const raw = object(parseCapturedJson(event))
  if (!raw) return null
  const receivedAtMs = event.receivedAtMs
  if (event.source === 'binance') {
    if (!isValidBinancePriceEnvelope(raw)) return null
    const data = object(raw.data)
    if (!data || data.s !== 'BTCUSDT') return null
    if (raw.stream === 'btcusdt@aggTrade' && data.e === 'aggTrade') {
      const value = finite(data.p)
      const tsMs = finite(data.T)
      if (value === undefined || value <= 0 || tsMs === undefined || tsMs <= 0) return null
      const symbol = data.s.toLowerCase()
      return {
        feed: 'binance_agg_trade',
        snapshot: { ...state, binanceWsSpotPrice: { symbol, value, tsMs, receivedAtMs } },
        synthetic: { eventType: 'binance_agg_trade', symbol },
      }
    }
    if (
      raw.stream === 'btcusdt@bookTicker' &&
      typeof data.b === 'string' &&
      typeof data.B === 'string' &&
      typeof data.a === 'string' &&
      typeof data.A === 'string' &&
      (typeof data.u === 'string' || typeof data.u === 'number')
    ) {
      const prices = [finite(data.b), finite(data.a)]
      const quantities = [finite(data.B), finite(data.A)]
      if (
        ![data.b, data.B, data.a, data.A].every((value) => /^\d+(?:\.\d+)?$/.test(value)) ||
        prices.some((value) => value === undefined || value <= 0) ||
        quantities.some((value) => value === undefined || value < 0) ||
        !/^\d+$/.test(String(data.u))
      )
        return null
      return {
        feed: 'binance_book_ticker',
        snapshot: {
          ...state,
          binanceBookTicker: {
            symbol: data.s.toLowerCase(),
            updateId: String(data.u),
            bidPrice: data.b,
            bidQuantity: data.B,
            askPrice: data.a,
            askQuantity: data.A,
            receivedAtMs,
          },
        },
      }
    }
  }
  if (event.source === 'chainlink') {
    if (!isValidPolyBoltPriceEnvelope(raw, market.twapLookbackSeconds)) return null
    if (raw.channel !== 'price.crypto' && raw.channel !== 'price.crypto.twap') return null
    const payload = object(raw.payload)
    // Provider fallback is not interchangeable with the contracted Chainlink stream.
    if (!payload || payload.source !== 'chainlink' || payload.symbol !== 'btcusd') return null
    const history = raw.snapshot === true && Array.isArray(payload.data) ? payload.data : null
    if (
      (raw.snapshot === true && !history) ||
      (raw.snapshot !== true && payload.data !== undefined)
    )
      return null
    const point = history
      ? history
          .map(object)
          .filter((p): p is Record<string, unknown> => p !== null)
          .reduce<Record<string, unknown> | null>(
            (latest, next) =>
              (finite(next.timestamp) ?? -Infinity) >= (finite(latest?.timestamp) ?? -Infinity)
                ? next
                : latest,
            null,
          )
      : payload
    if (!point) return null
    const tsMs = finite(point.timestamp)
    const value = finite(point.full_accuracy_value ?? point.value)
    if (
      tsMs === undefined ||
      tsMs <= 0 ||
      value === undefined ||
      value <= 0 ||
      (point.source !== undefined && point.source !== 'chainlink')
    )
      return null
    if (raw.channel === 'price.crypto.twap') {
      const windowSeconds = finite(payload.window_seconds)
      if (windowSeconds === undefined || windowSeconds !== market.twapLookbackSeconds) return null
      return {
        feed: 'chainlink_twap',
        snapshot: {
          ...state,
          chainlinkTwap: {
            symbol: 'btc/usd',
            tsMs,
            value,
            receivedAtMs,
            windowSeconds,
            source: 'chainlink',
            ...(typeof point.full_accuracy_value === 'string'
              ? { fullAccuracyValue: point.full_accuracy_value }
              : {}),
          },
        },
      }
    }
    return {
      feed: 'chainlink_spot',
      snapshot: {
        ...state,
        rtdsPolymarketCryptoPrices: {
          ...state.rtdsPolymarketCryptoPrices,
          chainlink: { symbol: 'btc/usd', tsMs, value, receivedAtMs },
        },
      },
      // A history snapshot restores state at receipt, not a series of new rounds.
      ...(!history && raw.snapshot !== true
        ? { synthetic: { eventType: 'chainlink_round' as const, symbol: 'btc/usd' } }
        : {}),
    }
  }
  if (event.source === 'price_to_beat') {
    const openPrice = finite(raw.openPrice)
    if (openPrice === undefined || openPrice <= 0) return null
    let details: Record<string, unknown> | null = null
    try {
      details = object(JSON.parse(event.detailsJson ?? 'null'))
    } catch {
      /* optional */
    }
    const request = object(details?.request) ?? details
    const status = finite(request?.httpStatus)
    if (status !== undefined && (status < 200 || status >= 300)) return null
    const apiTimestampMs = finite(raw.timestamp)
    return {
      feed: 'price_to_beat',
      snapshot: {
        ...state,
        polymarketPriceToBeat: {
          symbol: 'BTC',
          eventStartTimeIso: new Date(market.startMs).toISOString(),
          endDateIso: new Date(market.endMs).toISOString(),
          openPrice,
          receivedAtMs,
          ...(apiTimestampMs !== undefined ? { apiTimestampMs } : {}),
        },
      },
    }
  }
  return null
}

export function requestedCapturedFeeds(config: ExternalFeedsRequestConfig): Set<RecorderFeed> {
  const required = new Set<RecorderFeed>(['polymarket'])
  if (config.binanceWsSpotPrice) required.add('binance_agg_trade')
  if (config.binanceBookTicker) required.add('binance_book_ticker')
  if (config.rtdsCryptoPrices) required.add('chainlink_spot')
  if (config.chainlinkTwap) required.add('chainlink_twap')
  if (config.polymarketPriceToBeat?.enabled)
    required.add(
      config.polymarketPriceToBeat.source === 'chainlink-opening-twap'
        ? 'chainlink_twap'
        : 'price_to_beat',
    )
  return required
}

export function validateCapturedFeedRequest(
  config: ExternalFeedsRequestConfig,
  market: RecordedMarket,
): void {
  const ptbSource = config.polymarketPriceToBeat?.source
  if (ptbSource !== undefined && ptbSource !== 'website' && ptbSource !== 'chainlink-opening-twap')
    throw new Error('Unknown captured price-to-beat source')
  if (
    ptbSource === 'chainlink-opening-twap' &&
    (!market.twapEnabled || market.twapLookbackSeconds !== 60)
  )
    throw new Error('Chainlink opening TWAP requires an explicit 60-second TWAP market')
  for (const request of [config.binanceWsSpotPrice, config.binanceBookTicker]) {
    if (request?.symbol && request.symbol.toLowerCase() !== 'btcusdt') {
      throw new Error(`Recorder v4 contains BTCUSDT, not ${request.symbol}`)
    }
  }
  if (config.rtdsCryptoPrices?.binanceSymbols?.length) {
    throw new Error(
      'Recorder v4 does not contain the legacy RTDS Binance feed; request binanceWsSpotPrice',
    )
  }
  for (const symbol of config.rtdsCryptoPrices?.chainlinkSymbols ?? []) {
    if (symbol.toLowerCase() !== 'btc/usd')
      throw new Error(`Recorder v4 has no Chainlink ${symbol}`)
  }
  if (
    config.chainlinkTwap?.symbol &&
    !['btcusd', 'btc/usd'].includes(config.chainlinkTwap.symbol.toLowerCase())
  ) {
    throw new Error(`Recorder v4 has no TWAP ${config.chainlinkTwap.symbol}`)
  }
  if (
    config.chainlinkTwap?.windowSeconds !== undefined &&
    config.chainlinkTwap.windowSeconds !== market.twapLookbackSeconds
  ) {
    throw new Error('Requested TWAP duration does not match the captured market configuration')
  }
}

/** Expose only declared feeds, matching the live strategy-driven subscription contract. */
export function selectCapturedFeeds(
  state: ExternalFeedsSnapshot,
  config: ExternalFeedsRequestConfig,
  market?: RecordedMarket,
): ExternalFeedsSnapshot {
  const opening =
    config.polymarketPriceToBeat?.enabled &&
    config.polymarketPriceToBeat.source === 'chainlink-opening-twap'
  if (opening && !market) throw new Error('Opening reference selection requires market identity')
  const reference = state.openingReference
  const observation = reference?.conflict ? undefined : reference?.observation
  const price = opening
    ? observation && market
      ? {
          symbol: observation.symbol,
          eventStartTimeIso: new Date(market.startMs).toISOString(),
          endDateIso: new Date(market.endMs).toISOString(),
          openPrice: observation.openPrice,
          receivedAtMs: observation.receivedAtMs,
          source: observation.source,
          sourceTimestampMs: observation.sourceTimestampMs,
          windowSeconds: observation.windowSeconds,
          fullAccuracyValue: observation.fullAccuracyValue,
          eventId: observation.eventId,
        }
      : undefined
    : state.polymarketPriceToBeat
  return {
    ...(config.binanceWsSpotPrice && state.binanceWsSpotPrice
      ? { binanceWsSpotPrice: state.binanceWsSpotPrice }
      : {}),
    ...(config.binanceBookTicker && state.binanceBookTicker
      ? { binanceBookTicker: state.binanceBookTicker }
      : {}),
    ...(config.rtdsCryptoPrices && state.rtdsPolymarketCryptoPrices
      ? { rtdsPolymarketCryptoPrices: state.rtdsPolymarketCryptoPrices }
      : {}),
    ...(config.chainlinkTwap && state.chainlinkTwap ? { chainlinkTwap: state.chainlinkTwap } : {}),
    ...(config.polymarketPriceToBeat?.enabled && price ? { polymarketPriceToBeat: price } : {}),
    ...(opening && reference ? { openingReference: reference } : {}),
    ...(opening && state.polymarketPriceToBeat
      ? { websitePriceToBeat: state.polymarketPriceToBeat }
      : {}),
  }
}
