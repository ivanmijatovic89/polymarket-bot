---
title: Fee Computation
description: Reference for the taker fee model used in live trading and backtesting, including the documented Polymarket fee curve and the hardcoded crypto rate.
---

# Fee Computation

Fee logic is implemented in `src/trading/fees.ts`. The bot models only **taker fees** — makers never pay fees on Polymarket, and maker rebates are deliberately not modelled (tier-0 assumption, conservative).

---

## Fee Rate

### Live Trading

The fee rate is supplied by Polymarket per fill: the user WS channel stamps `fee_rate_bps` on each trade message, and that value flows into `Fill.feeRateBps`. The live path always uses the exchange-provided rate.

### Backtesting

The backtest simulator stamps every TAKER fill with the hardcoded crypto-market rate:

```typescript
// src/trading/fees.ts
export const POLYMARKET_CRYPTO_TAKER_FEE_BPS = 700
```

This matches the official fee schedule ([docs.polymarket.com/trading/fees](https://docs.polymarket.com/trading/fees)): crypto markets charge `feeRate = 0.07`. The rate is **not configurable** — it is a documented fact, and a future rate change is a deliberate one-line PR. Fleet determinism comes free because jobs are SHA-gated: the code version pins the fee.

---

## Fee Formula

Fee computation is performed by `computePolymarketTakerFee`, implementing the officially documented curve:

```
fee = size × (feeRateBps / 10_000) × price × (1 − price)
```

The fee is **charged in USDC for both BUY and SELL fills** — Polymarket calculates and deducts taker fees in USDC, never in outcome shares. The curve is symmetric (`fee(p) = fee(1 − p)`), peaks at `p = 0.5`, and is zero at `p = 0` and `p = 1`.

## Function Signature

```typescript
computePolymarketTakerFee(params: {
  feeRateBps: number
  price: number
  size: number
}): number // fee in USDC
```

---

## Rounding and Minimum Fee

Computed fees are rounded to four decimal places. If the rounded value is below the minimum fee threshold, the fee is treated as zero.

```
MIN_FEE = 0.0001
rounded = round(fee × 10_000) / 10_000
fee     = rounded < MIN_FEE ? 0 : rounded
```

---

## Guard Conditions

`computePolymarketTakerFee` returns `0` (no fee) under any of the following conditions:

| Condition               | Description                              |
| ----------------------- | ---------------------------------------- |
| `feeRateBps <= 0`       | Zero or negative rate — no fee applies.  |
| `!isFinite(feeRateBps)` | Non-finite rate value.                   |
| `price <= 0`            | Non-positive price.                      |
| `price >= 1`            | Price at or beyond 1 — fee curve is zero. |
| `!isFinite(price)`      | Non-finite price.                        |
| `size <= 0`             | Non-positive order size.                 |
| `!isFinite(size)`       | Non-finite order size.                   |

---

## Example Calculations

### 100 shares at price 0.50, rate 700 bps (either side)

```
fee = 100 × 0.07 × 0.50 × 0.50 = 1.75 USDC   (0.0175 USDC per share)
```

### 100 shares at price 0.60, rate 700 bps (either side)

```
fee = 100 × 0.07 × 0.60 × 0.40 = 1.68 USDC
```

---

## PnL Impact

In `Portfolio.applyFillToPosition`:

- **BUY (TAKER)** — the full share size is received; the USDC fee is capitalized into the position's cost basis (effective entry cost includes the fee).
- **SELL (TAKER)** — the USDC fee is subtracted from sale proceeds before realizing PnL.
- **MAKER** fills pay exactly $0.

`marketStats.feesPaid` recomputes the same fee per TAKER trade, so backtest stats and Portfolio accounting always agree.
