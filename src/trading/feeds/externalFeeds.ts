export type RtdsPricePoint = {
  symbol: string
  tsMs: number
  value: number
  receivedAtMs: number
}

export type ExternalFeedsSnapshot = {
  rtdsPolymarketCryptoPrices?: {
    binance?: RtdsPricePoint
    chainlink?: RtdsPricePoint
  }
  binanceWsSpotPrice?: RtdsPricePoint
}

export type ExternalFeedsStore = {
  snapshot: () => ExternalFeedsSnapshot
  updateBinance: (u: { symbol: string; tsMs: number; value: number }) => void
  updateChainlink: (u: { symbol: string; tsMs: number; value: number }) => void
  updateBinanceWsSpotPrice: (u: { symbol: string; tsMs: number; value: number }) => void
  reset: () => void
}

export function createExternalFeedsStore(): ExternalFeedsStore {
  let binance: RtdsPricePoint | undefined
  let chainlink: RtdsPricePoint | undefined
  let binanceWsSpotPrice: RtdsPricePoint | undefined

  return {
    snapshot: () => ({
      rtdsPolymarketCryptoPrices: {
        ...(binance ? { binance } : {}),
        ...(chainlink ? { chainlink } : {}),
      },
      ...(binanceWsSpotPrice ? { binanceWsSpotPrice } : {}),
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
    reset: () => {
      binance = undefined
      chainlink = undefined
      binanceWsSpotPrice = undefined
    },
  }
}


