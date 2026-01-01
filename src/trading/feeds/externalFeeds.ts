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
}

export type ExternalFeedsStore = {
  snapshot: () => ExternalFeedsSnapshot
  updateBinance: (u: { symbol: string; tsMs: number; value: number }) => void
  updateChainlink: (u: { symbol: string; tsMs: number; value: number }) => void
  reset: () => void
}

export function createExternalFeedsStore(): ExternalFeedsStore {
  let binance: RtdsPricePoint | undefined
  let chainlink: RtdsPricePoint | undefined

  return {
    snapshot: () => ({
      rtdsPolymarketCryptoPrices: {
        ...(binance ? { binance } : {}),
        ...(chainlink ? { chainlink } : {}),
      },
    }),
    updateBinance: (u) => {
      binance = { ...u, receivedAtMs: Date.now() }
    },
    updateChainlink: (u) => {
      chainlink = { ...u, receivedAtMs: Date.now() }
    },
    reset: () => {
      binance = undefined
      chainlink = undefined
    },
  }
}


