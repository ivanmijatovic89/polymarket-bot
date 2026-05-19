---
title: Fee Computation
description: Reference for the taker fee model used in live trading and backtesting, including formulas and the BACKTEST_TAKER_FEE_BPS environment variable.
---

# Fee Computation

Fee logic is implemented in `src/trading/fees.ts`. The bot models only **taker fees** — maker rebates are not currently modelled in the backtest simulator or PnL accounting.

---

## Fee Rate

### Live Trading

The fee rate is supplied by the CLOB API as part of the order response and stored in `feeRateBps` (basis points). The live execution path uses the rate returned by the exchange for each order.

### Backtesting

The backtest simulator applies a configurable taker fee rate. The default is **156 bps (1.56%)**.

| Variable                 | Type            | Default | Description                                                                                                                                                                    |
| ------------------------ | --------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BACKTEST_TAKER_FEE_BPS` | `integer (bps)` | `156`   | Taker fee rate applied by the backtest execution simulator. Must be a non-negative integer; non-finite or negative values fall back to `156`. Fractional values are truncated. |

```typescript
// src/trading/fees.ts
const DEFAULT_BACKTEST_TAKER_FEE_BPS = 156
```

---

## Fee Formula

Fee computation is performed by `computePolymarketTakerFee`. Polymarket's fee is applied to the **smaller price edge** — the distance from the order price to the nearer of 0 and 1.

```
priceEdge = min(price, 1 - price)
baseRate  = feeRateBps / 10_000
```

### BUY Side

The fee is paid in the **base asset** (shares):

```
feeBase  = baseRate × priceEdge × (size / price)
feeQuote = 0
```

### SELL Side

The fee is paid in the **quote asset** (USDC):

```
feeBase  = 0
feeQuote = baseRate × priceEdge × size
```

The asymmetry arises because buying shares with USDC and selling shares for USDC have different denominations for the fee.

---

## Function Signature

```typescript
computePolymarketTakerFee(params: {
  feeRateBps: number
  price: number
  size: number
  side: 'BUY' | 'SELL'
}): TakerFeeResult
```

```typescript
type TakerFeeResult = {
  feeBase: number // shares deducted (non-zero for BUY only)
  feeQuote: number // USDC deducted (non-zero for SELL only)
}
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

`computePolymarketTakerFee` returns `{ feeBase: 0, feeQuote: 0 }` (no fee) under any of the following conditions:

| Condition               | Description                                             |
| ----------------------- | ------------------------------------------------------- |
| `feeRateBps <= 0`       | Zero or negative rate — no fee applies.                 |
| `!isFinite(feeRateBps)` | Non-finite rate value.                                  |
| `price <= 0`            | Non-positive price.                                     |
| `!isFinite(price)`      | Non-finite price.                                       |
| `size <= 0`             | Non-positive order size.                                |
| `!isFinite(size)`       | Non-finite order size.                                  |
| `priceEdge <= 0`        | Price is exactly 0 or 1 — edge is zero, no fee surface. |

---

## Example Calculations

### BUY at price 0.60, size 100 shares, rate 156 bps

```
priceEdge = min(0.60, 0.40) = 0.40
baseRate  = 156 / 10_000   = 0.0156
feeBase   = 0.0156 × 0.40 × (100 / 0.60)
          = 0.0156 × 0.40 × 166.667
          = 1.04 shares
feeQuote  = 0
```

### SELL at price 0.60, size 100 shares, rate 156 bps

```
priceEdge = min(0.60, 0.40) = 0.40
baseRate  = 0.0156
feeQuote  = 0.0156 × 0.40 × 100 = 0.624 USDC
feeBase   = 0
```

---

## PnL Impact

In backtests, `feeBase` is subtracted from the filled share quantity and `feeQuote` is subtracted from the USDC proceeds. This reduces realised PnL proportionally to trading activity, providing a conservative estimate of net returns at the configured fee tier.

::: tip Adjusting the fee rate
To simulate lower fees (e.g. for VIP-tier estimation), set `BACKTEST_TAKER_FEE_BPS` to the target rate before running the backtest. There is no VIP tier model in the current implementation — the rate is applied uniformly to every fill.
:::
