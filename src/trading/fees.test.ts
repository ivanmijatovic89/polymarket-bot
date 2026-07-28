import test from 'node:test'
import assert from 'node:assert/strict'
import { computePolymarketTakerFee, POLYMARKET_CRYPTO_TAKER_FEE_BPS } from './fees.js'

const BPS = POLYMARKET_CRYPTO_TAKER_FEE_BPS

test('crypto taker fee rate is the documented 700 bps', () => {
  assert.equal(BPS, 700)
})

test('fee follows the documented curve fee = size × rate × p × (1−p)', () => {
  // 0.07 × 0.5 × 0.5 = 0.0175 USDC per share
  assert.equal(computePolymarketTakerFee({ feeRateBps: BPS, price: 0.5, size: 1 }), 0.0175)
  assert.equal(computePolymarketTakerFee({ feeRateBps: BPS, price: 0.5, size: 100 }), 1.75)
  // 0.07 × 0.3 × 0.7 = 0.0147 USDC per share
  assert.equal(computePolymarketTakerFee({ feeRateBps: BPS, price: 0.3, size: 1 }), 0.0147)
  assert.equal(computePolymarketTakerFee({ feeRateBps: BPS, price: 0.3, size: 100 }), 1.47)
  // 0.07 × 0.05 × 0.95 = 0.003325 USDC per share (rounds to 4 decimals per share)
  assert.equal(computePolymarketTakerFee({ feeRateBps: BPS, price: 0.05, size: 1 }), 0.0033)
  assert.equal(computePolymarketTakerFee({ feeRateBps: BPS, price: 0.05, size: 100 }), 0.3325)
})

test('fee is symmetric: fee(p) == fee(1−p)', () => {
  for (const p of [0.05, 0.1, 0.2, 0.3, 0.4, 0.45]) {
    assert.equal(
      computePolymarketTakerFee({ feeRateBps: BPS, price: p, size: 100 }),
      computePolymarketTakerFee({ feeRateBps: BPS, price: 1 - p, size: 100 }),
      `asymmetric at p=${p}`,
    )
  }
})

test('fee is zero at p = 0 and p = 1 (and outside the open interval)', () => {
  assert.equal(computePolymarketTakerFee({ feeRateBps: BPS, price: 0, size: 100 }), 0)
  assert.equal(computePolymarketTakerFee({ feeRateBps: BPS, price: 1, size: 100 }), 0)
  assert.equal(computePolymarketTakerFee({ feeRateBps: BPS, price: -0.1, size: 100 }), 0)
  assert.equal(computePolymarketTakerFee({ feeRateBps: BPS, price: 1.1, size: 100 }), 0)
})

test('fee rounds to 4 decimals and zeroes below the 0.0001 minimum', () => {
  // 0.07 × 0.123 × 0.877 × 7 = 0.05285679 → 0.0529
  assert.equal(computePolymarketTakerFee({ feeRateBps: BPS, price: 0.123, size: 7 }), 0.0529)
  // 0.07 × 0.25 × 0.005 = 0.0000875 → rounds up to exactly the 0.0001 minimum, kept
  assert.equal(computePolymarketTakerFee({ feeRateBps: BPS, price: 0.5, size: 0.005 }), 0.0001)
  // 0.07 × 0.25 × 0.002 = 0.000035 → rounds below MIN_FEE → 0
  assert.equal(computePolymarketTakerFee({ feeRateBps: BPS, price: 0.5, size: 0.002 }), 0)
})

test('fee is zero for invalid or non-positive inputs', () => {
  assert.equal(computePolymarketTakerFee({ feeRateBps: 0, price: 0.5, size: 100 }), 0)
  assert.equal(computePolymarketTakerFee({ feeRateBps: -700, price: 0.5, size: 100 }), 0)
  assert.equal(computePolymarketTakerFee({ feeRateBps: BPS, price: 0.5, size: 0 }), 0)
  assert.equal(computePolymarketTakerFee({ feeRateBps: NaN, price: 0.5, size: 100 }), 0)
  assert.equal(computePolymarketTakerFee({ feeRateBps: BPS, price: NaN, size: 100 }), 0)
  assert.equal(computePolymarketTakerFee({ feeRateBps: BPS, price: 0.5, size: NaN }), 0)
})
