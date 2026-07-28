/**
 * Polymarket taker fee rate for crypto markets, in basis points.
 *
 * Official schedule (https://docs.polymarket.com/trading/fees, checked
 * 2026-07-28): crypto feeRate = 0.07. Rates are per-category and drift over
 * time; a rate change is a deliberate one-line PR here. Makers never pay fees,
 * and the tiered taker-rebate program is deliberately ignored (tier-0
 * assumption, conservative).
 */
export const POLYMARKET_CRYPTO_TAKER_FEE_BPS = 700

type TakerFeeParams = {
  feeRateBps: number
  price: number
  size: number
}

const MIN_FEE = 0.0001

function roundFee(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0
  const rounded = Math.round(n * 1e4) / 1e4
  return rounded < MIN_FEE ? 0 : rounded
}

/**
 * Documented Polymarket taker fee: `fee = size × (feeRateBps/10000) × p × (1−p)`,
 * charged in USDC regardless of side (both learn docs and fill accounting are
 * USDC-denominated). Returns the fee in USDC; symmetric in p, zero at p = 0
 * and p = 1.
 */
export function computePolymarketTakerFee(params: TakerFeeParams): number {
  const feeRateBps = params.feeRateBps
  const price = params.price
  const size = params.size
  if (!Number.isFinite(feeRateBps) || feeRateBps <= 0) return 0
  if (!Number.isFinite(price) || price <= 0 || price >= 1) return 0
  if (!Number.isFinite(size) || size <= 0) return 0

  const rate = feeRateBps / 10_000
  return roundFee(rate * price * (1 - price) * size)
}
