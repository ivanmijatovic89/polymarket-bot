---
title: Split-Sell-Redeem Strategy
description: How the SplitSellRedeem strategy works — the core trading idea, state machine, parameters, and why this strategy exists.
---

# Split-Sell-Redeem Strategy

The Split-Sell-Redeem family of strategies (`SplitSellRedeem.v1` through `v6` and a series of research variants) implements the core trading idea of the Polymarket Bot. This document explains `SplitSellRedeem.v1` — the original, minimal implementation — which establishes the pattern that all subsequent versions build on.

Registry ID: `SplitSellRedeem.v1`

---

## The Core Idea

Polymarket binary markets (such as BTC 15-minute Up/Down windows) have a mathematical invariant: one UP share plus one DOWN share always resolves to exactly $1 USDC, regardless of which outcome wins. This invariant is enforced by the Conditional Token Framework (CTF) at the smart contract level.

The split-sell-redeem strategy exploits this in three phases:

1. **Split** — Convert USDC collateral into a matched pair of UP and DOWN shares using CTF `splitPosition`. Splitting N shares costs N USDC and yields N UP shares and N DOWN shares.

2. **Sell** — Immediately sell one side (UP or DOWN) on the CLOB at a limit price above its current best bid. If the sell fills, you hold N shares of the remaining outcome at an effective cost of `(N - proceeds)` USDC.

3. **Redeem** — At market resolution, the held shares resolve at $1 each if the outcome wins, or $0 if it loses. The redeem watcher handles on-chain settlement automatically.

The strategy profits when the sold side fills at a price high enough that even if the held side loses, the net is positive. If the held side wins, the payout is the full $1 per share. The economics resemble buying one side cheaply by selling the other side first.

---

## Why This Strategy Exists

Polymarket 15-minute markets frequently exhibit transient pricing anomalies: one side temporarily trades at a low probability (e.g. 25-30 cents) not because the underlying probability is that low, but because of liquidity imbalance. During these windows, it is possible to sell that side above fair value while holding the other side as a free or near-free position in the remaining outcome.

The split-sell-redeem structure allows a position to be constructed without predicting direction: you always hold both sides after the split, then dispose of whichever side reaches the sell threshold first.

---

## State Machine

`SplitSellRedeem.v1` uses two boolean flags in the factory closure:

```
splitRequested = false
sellPlaced = false
```

**Transition logic in `onMarketTick`:**

```
Initial state: splitRequested=false, sellPlaced=false

Tick 1:
  → splitRequested is false
  → Emit split_positions intent; set splitRequested = true
  → Return immediately (no sell check on this tick)

Tick 2+:
  → splitRequested is true; sellPlaced is false
  → Check best bids for both UP and DOWN
  → If bestBid < triggerBidBelow AND position qty >= sellSize:
      → Select the side with the lowest bid (tie-break: UP wins)
      → Emit place_limit (GTC SELL) intent; set sellPlaced = true

Once sellPlaced = true:
  → Return [] on every subsequent tick (one-shot: no more actions)
```

The strategy is intentionally one-shot per episode: one split, one sell attempt. The episode ends when the market window closes (15 minutes). The next window starts a fresh strategy instance (or the same instance with reset state in backtest orderbook mode).

::: tip One-shot design
The one-shot design simplifies reasoning: the strategy has no cancel-and-replace logic, no partial-fill handling in `onAccountEvent`, and no position sizing decisions beyond the initial `splitShares`. Subsequent versions add this complexity.
:::

---

## Parameters

| Parameter         | Type     | Default | Description                                                                                                                                       |
| ----------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `splitShares`     | `number` | `100`   | Number of full sets to split. Costs `splitShares` USDC. Yields `splitShares` UP and `splitShares` DOWN shares.                                    |
| `triggerBidBelow` | `number` | `0.29`  | Best-bid threshold. The strategy places a sell only when a token's best bid falls below this price.                                               |
| `sellPrice`       | `number` | `0.31`  | GTC limit price for the sell order. Passed through `safeProbabilityPrice` before use.                                                             |
| `sellSize`        | `number` | `10`    | Number of shares to sell. Must be ≤ `splitShares`. The strategy checks that the held position has at least this quantity before placing the sell. |

CLI usage:

```bash
tsx src/cli/trading-bot.ts --strategy SplitSellRedeem.v1 \
  --param splitShares=50 \
  --param triggerBidBelow=0.25 \
  --param sellPrice=0.28 \
  --param sellSize=10
```

Backtest usage:

```bash
npm run backtest -- \
  --strategy SplitSellRedeem.v1 \
  --param splitShares=50 \
  --param triggerBidBelow=0.25 \
  --param sellPrice=0.28 \
  --param sellSize=10 \
  "data/events/btc/btc-updown-15m-1715000000.parquet"
```

---

## Side Selection Logic

When both UP and DOWN bids fall below `triggerBidBelow` on the same tick, the strategy picks the side with the lower bid. If bids are equal, UP is chosen:

```typescript
candidates.sort((a, b) => (a.bid !== b.bid ? a.bid - b.bid : a.side === 'UP' ? -1 : 1))
const chosen = candidates[0]!
```

This ensures the strategy sells the side that appears to have weaker demand — the one that is already more discounted — and retains the side the market is currently pricing higher.

---

## Position Check Before Selling

Before emitting a sell intent, the strategy verifies that the portfolio holds sufficient shares:

```typescript
const qty = portfolio.positionsByAssetId[assetId]?.qty ?? 0
if (Number.isFinite(qty) && qty >= sellSize)
  candidates.push(...)
```

This prevents a sell intent from being placed before the split has settled into the portfolio. Because the split is queued by `OrderManager` on the next tick, there is typically at least one tick delay between `split_positions` and the split appearing in `portfolio.positionsByAssetId`.

---

## `onAccountEvent`

`SplitSellRedeem.v1` returns `[]` from `onAccountEvent` — it does not react to fills, rejections, or merges. Redemption is handled by the redeem watcher process (`npm run redeem-watcher`), which runs independently and scans for resolved markets on-chain.

---

## Cost Basis Accounting

The split intent sets `costPerShare: 0`:

```typescript
{
  kind: 'split_positions',
  costPerShare: 0,
  ...
}
```

This means the portfolio records the position at zero cost basis, which is a simplification: the actual cost is 0.5 USDC per share (since splitting $N yields 2N shares at total cost $N). Production versions use `costPerShare: 0.5` for accurate PnL tracking. The `v1` template deliberately simplifies this to keep the state machine easy to follow.

---

## Relationship to Later Versions

| Version   | Key addition                                                   |
| --------- | -------------------------------------------------------------- |
| `v1`      | Minimal one-shot: split → sell on bid drop                     |
| `v2`      | Cascading sell on fill event; partial fill handling            |
| `v3`–`v4` | Position sizing improvements; smarter sell price               |
| `v5`      | Full episode management; merge on exit; research metrics       |
| `v5.x`    | Gate variants (net-change, TA indicators, orderbook imbalance) |
| `v6`      | Production-hardened; multi-window support                      |

All versions share the same fundamental structure: split once, sell one side on a price signal, hold the remaining side to resolution. The differences are in how aggressively they manage partial fills, when they exit, and what signals gate the initial sell.
