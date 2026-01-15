export type TakerFeeResult = {
  feeBase: number
  feeQuote: number
}

type TakerFeeParams = {
  feeRateBps: number
  price: number
  size: number
  side: 'BUY' | 'SELL'
}

const MIN_FEE = 0.0001
const DEFAULT_BACKTEST_TAKER_FEE_BPS = 156

export function getBacktestTakerFeeBps(): number {
  const raw = process.env.BACKTEST_TAKER_FEE_BPS
  if (raw === undefined) return DEFAULT_BACKTEST_TAKER_FEE_BPS
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_BACKTEST_TAKER_FEE_BPS
  return Math.trunc(n)
}

function roundFee(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0
  const rounded = Math.round(n * 1e4) / 1e4
  return rounded < MIN_FEE ? 0 : rounded
}

export function computePolymarketTakerFee(params: TakerFeeParams): TakerFeeResult {
  const feeRateBps = params.feeRateBps
  const price = params.price
  const size = params.size
  if (!Number.isFinite(feeRateBps) || feeRateBps <= 0) return { feeBase: 0, feeQuote: 0 }
  if (!Number.isFinite(price) || price <= 0) return { feeBase: 0, feeQuote: 0 }
  if (!Number.isFinite(size) || size <= 0) return { feeBase: 0, feeQuote: 0 }

  const baseRate = feeRateBps / 10_000
  const priceEdge = Math.min(price, 1 - price)
  if (!Number.isFinite(priceEdge) || priceEdge <= 0) return { feeBase: 0, feeQuote: 0 }

  if (params.side === 'SELL') {
    const feeQuote = baseRate * priceEdge * size
    return { feeBase: 0, feeQuote: roundFee(feeQuote) }
  }

  const feeBase = baseRate * priceEdge * (size / price)
  return { feeBase: roundFee(feeBase), feeQuote: 0 }
}
