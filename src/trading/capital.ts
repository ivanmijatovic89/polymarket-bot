import type { Fill } from '../strategy/Strategy.js'
import { computePolymarketTakerFee, POLYMARKET_CRYPTO_TAKER_FEE_BPS } from './fees.js'
import { round8 } from './utils/rounding.js'

/** Per-market execution allowance, in USDC. Independent of aggregate INITIAL_CAPITAL. */
export const DEFAULT_STARTING_CAPITAL = 500

export function validateStartingCapital(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('starting capital must be a finite non-negative number of USDC')
  }
  return value
}

/** Worst-case BUY cost at the limit price; post-only orders cannot incur taker fees. */
export function buyCommitment(price: number, size: number, postOnly = false): number {
  if (size <= 0) return 0
  return round8(
    price * size +
      (postOnly
        ? 0
        : computePolymarketTakerFee({
            price,
            size,
            feeRateBps: POLYMARKET_CRYPTO_TAKER_FEE_BPS,
          })),
  )
}

export function fillCashDelta(fill: Fill): number {
  const fee =
    fill.liquidity === 'TAKER'
      ? computePolymarketTakerFee({
          price: fill.price,
          size: fill.size,
          feeRateBps: fill.feeRateBps ?? 0,
        })
      : 0
  return round8((fill.side === 'BUY' ? -1 : 1) * fill.price * fill.size - fee)
}
