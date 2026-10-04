export type RtdsPricePoint = {
  symbol: string
  tsMs: number
  value: number
  receivedAtMs: number
}

export type ExternalFeedsSnapshot = {
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
  polymarketPriceToBeat?: {
    symbol: string
    eventStartTimeIso: string
    endDateIso: string
    openPrice: number
    apiTimestampMs?: number
    receivedAtMs: number
  }
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
