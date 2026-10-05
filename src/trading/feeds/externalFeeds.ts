export type RtdsPricePoint = {
  symbol: string
  tsMs: number
  value: number
  receivedAtMs: number
}

export type OpeningReferenceObservation = {
  source: 'chainlink-opening-twap'
  symbol: 'BTC'
  sourceTimestampMs: number
  windowSeconds: 60
  openPrice: number
  fullAccuracyValue: string
  receivedAtMs: number
  eventId: string
  sessionId: string
  connectionId: string
}

export type OpeningReferenceSnapshot = {
  observation?: OpeningReferenceObservation
  conflict?: { fullAccuracyValue: string; receivedAtMs: number; eventId: string }
  /** Conflicts in this capture session, retained after recovery and reset at bootstrap. */
  conflictCount?: number
  website?: { openPrice: number; receivedAtMs: number; eventId: string }
  comparison: 'unavailable' | 'waiting-for-website' | 'match' | 'mismatch' | 'conflicting-twap'
}

export type PriceToBeatSnapshot = {
  symbol: string
  eventStartTimeIso: string
  endDateIso: string
  openPrice: number
  apiTimestampMs?: number
  receivedAtMs: number
  /** Absent on legacy snapshots means the website observation. */
  source?: 'website' | 'chainlink-opening-twap'
  fullAccuracyValue?: string
  sourceTimestampMs?: number
  windowSeconds?: number
  eventId?: string
}

export type ExternalFeedsSnapshot = {
  openingReference?: OpeningReferenceSnapshot
  websitePriceToBeat?: PriceToBeatSnapshot
  /** Captured best bid/ask has no exchange timestamp in Binance's spot payload. */
  binanceBookTicker?: {
    symbol: string
    updateId: string
    bidPrice: string
    bidQuantity: string
    askPrice: string
    askQuantity: string
    receivedAtMs: number
  }
  chainlinkTwap?: RtdsPricePoint & {
    windowSeconds: number
    fullAccuracyValue?: string
    source: 'chainlink'
  }
  rtdsPolymarketCryptoPrices?: {
    binance?: RtdsPricePoint
    chainlink?: RtdsPricePoint
  }
  binanceWsSpotPrice?: RtdsPricePoint
  polymarketPriceToBeat?: PriceToBeatSnapshot
}

/**
 * Detach our plain feed DTOs without the general structured-clone serializer.
 * Every leaf contains only scalars. Keep the copies here in sync when adding
 * nested fields; this helper is not a clone for arbitrary plugin snapshots.
 */
export function cloneExternalFeedsSnapshot(value: ExternalFeedsSnapshot): ExternalFeedsSnapshot {
  const copy = { ...value }
  if (value.binanceWsSpotPrice) copy.binanceWsSpotPrice = { ...value.binanceWsSpotPrice }
  if (value.binanceBookTicker) copy.binanceBookTicker = { ...value.binanceBookTicker }
  if (value.chainlinkTwap) copy.chainlinkTwap = { ...value.chainlinkTwap }
  if (value.polymarketPriceToBeat) copy.polymarketPriceToBeat = { ...value.polymarketPriceToBeat }
  if (value.websitePriceToBeat) copy.websitePriceToBeat = { ...value.websitePriceToBeat }
  if (value.rtdsPolymarketCryptoPrices) {
    const prices = (copy.rtdsPolymarketCryptoPrices = { ...value.rtdsPolymarketCryptoPrices })
    if (prices.binance) prices.binance = { ...prices.binance }
    if (prices.chainlink) prices.chainlink = { ...prices.chainlink }
  }
  if (value.openingReference) {
    const reference = (copy.openingReference = { ...value.openingReference })
    if (reference.observation) reference.observation = { ...reference.observation }
    if (reference.website) reference.website = { ...reference.website }
    if (reference.conflict) reference.conflict = { ...reference.conflict }
  }
  return copy
}

export type ExternalFeedsStore = {
  snapshot: () => ExternalFeedsSnapshot
  updateBinance: (u: { symbol: string; tsMs: number; value: number }) => void
  updateChainlink: (u: { symbol: string; tsMs: number; value: number }) => void
  updateBinanceWsSpotPrice: (u: { symbol: string; tsMs: number; value: number }) => void
  updatePolymarketPriceToBeat: (u: {
    symbol: string
    eventStartTimeIso: string
    endDateIso: string
    openPrice: number
    apiTimestampMs?: number
  }) => void
  clearPolymarketPriceToBeat: () => void
  reset: () => void
}

export function createExternalFeedsStore(): ExternalFeedsStore {
  let binance: RtdsPricePoint | undefined
  let chainlink: RtdsPricePoint | undefined
  let binanceWsSpotPrice: RtdsPricePoint | undefined
  let polymarketPriceToBeat:
    | {
        symbol: string
        eventStartTimeIso: string
        endDateIso: string
        openPrice: number
        apiTimestampMs?: number
        receivedAtMs: number
      }
    | undefined

  return {
    snapshot: () => ({
      rtdsPolymarketCryptoPrices: {
        ...(binance ? { binance } : {}),
        ...(chainlink ? { chainlink } : {}),
      },
      ...(binanceWsSpotPrice ? { binanceWsSpotPrice } : {}),
      ...(polymarketPriceToBeat ? { polymarketPriceToBeat } : {}),
    }),
    updateBinance: (u) => {
      binance = { ...u, receivedAtMs: Date.now() }
    },
    updateChainlink: (u) => {
      chainlink = { ...u, receivedAtMs: Date.now() }
    },
    updateBinanceWsSpotPrice: (u) => {
      binanceWsSpotPrice = { ...u, receivedAtMs: Date.now() }
    },
    updatePolymarketPriceToBeat: (u) => {
      polymarketPriceToBeat = { ...u, receivedAtMs: Date.now() }
    },
    clearPolymarketPriceToBeat: () => {
      polymarketPriceToBeat = undefined
    },
    reset: () => {
      binance = undefined
      chainlink = undefined
      binanceWsSpotPrice = undefined
      polymarketPriceToBeat = undefined
    },
  }
}
