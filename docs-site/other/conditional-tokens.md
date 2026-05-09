---
title: Conditional Tokens
description: Reference for the ConditionalTokens module — split, merge, and redeem operations on Polymarket binary outcome positions.
---

# Conditional Tokens

The `src/blockchain/conditionalTokens.ts` module wraps Polymarket's on-chain ConditionalTokens Framework (CTF) contract for direct EOA execution. It exposes three operations: splitting USDC into binary outcome shares, merging binary outcome shares back to USDC, and redeeming winning shares for USDC after market resolution.

These functions are used by the live trading engine's position management layer and by the redeem watcher. They are not available in backtests, where split and merge intents are simulated without on-chain execution.

## Background: Conditional Tokens in Polymarket

Polymarket markets use an ERC-1155 token standard where each binary market has two outcome tokens — YES (index set `1`) and NO (index set `2`). These outcome tokens are collectively managed by the ConditionalTokens contract identified by its `conditionId` (a `bytes32` hash).

**Splitting** converts a given USDC amount into an equal number of YES and NO shares. After a split of 100 USDC, the wallet holds 100 YES shares and 100 NO shares. The USDC is locked in the CTF contract.

**Merging** is the inverse: surrendering an equal number of YES and NO shares to recover USDC. Merging 50 YES and 50 NO shares returns 50 USDC.

**Redeeming** is called after a market resolves. The holder of shares on the winning side redeems them 1:1 for USDC. Losing shares have no value.

::: tip Binary market partition
All three operations use the partition `[1, 2]`, which is the canonical representation of a two-outcome market in the CTF standard. The parentCollectionId is always `ZeroHash` for root-level splits.
:::

## Contract addresses

| Contract                | Address                                                    | Chain         |
| ----------------------- | ---------------------------------------------------------- | ------------- |
| ConditionalTokens (CTF) | `CONDITIONAL_TOKENS_ADDRESS` (from `contractAddresses.ts`) | Polygon (137) |
| USDC                    | `USDC_ADDRESS` (from `contractAddresses.ts`)               | Polygon (137) |

Contract addresses are maintained in `src/polymarket/contractAddresses.ts` and can also be fetched dynamically from the CLOB API.

## Functions

### `splitBinaryOutcomePositions`

Splits USDC into YES and NO shares for a given market condition.

```typescript
splitBinaryOutcomePositions(params: {
  rpcUrl: string
  chainId: number
  privateKey: string
  conditionId: string   // bytes32 hex string (0x + 64 hex chars)
  shares: number        // amount in share units (1 share = 1 USDC collateral)
  gasMultiplier?: number
}): Promise<{ txHash: string; splitShares: number }>
```

**Precondition:** The EOA must have a USDC allowance granted to the CTF contract (`approve(ctfAddress, amount)`) and sufficient USDC balance.

**Amount encoding:** `shares` is converted to USDC base units (6 decimals) using `Math.round(shares * 1e6)`. A value of `100` results in `100_000_000` base units.

**On-chain call:** `splitPosition(USDC_ADDRESS, ZeroHash, conditionId, [1, 2], amount)`

---

### `mergeBinaryOutcomePositions`

Merges equal quantities of YES and NO shares back to USDC.

```typescript
mergeBinaryOutcomePositions(params: {
  rpcUrl: string
  chainId: number
  privateKey: string
  conditionId: string   // bytes32 hex string
  shares: number        // number of each outcome token to merge
  gasMultiplier?: number
}): Promise<{ txHash: string; mergedShares: number }>
```

**Precondition:** The EOA must hold at least `shares` of both YES and NO tokens, and the CTF contract must have `isApprovedForAll` set to `true` for the Exchange contract. The merge requires the CTF contract to be able to burn the tokens.

::: warning Wait for MINED status before merging
Shares acquired from fills must reach `MINED` status in the account feed before merging is safe. Attempting to merge shares that are only at `MATCHED` status can fail because the token transfer may not yet be settled on-chain. See the fill-status semantics section in `CLAUDE.md` (repo root) for details.
:::

**On-chain call:** `mergePositions(USDC_ADDRESS, ZeroHash, conditionId, [1, 2], amount)`

---

### `redeemBinaryOutcomePositions`

Redeems outcome token shares for USDC after a market has resolved.

```typescript
redeemBinaryOutcomePositions(params: {
  rpcUrl: string
  chainId: number
  privateKey: string
  conditionId: string   // bytes32 hex string
  gasMultiplier?: number
}): Promise<{ txHash: string }>
```

**Precondition:** The market identified by `conditionId` must be resolved on-chain. Redemption can be attempted for both YES and NO index sets (`[1, 2]`); only the winning side yields USDC.

**On-chain call:** `redeemPositions(USDC_ADDRESS, ZeroHash, conditionId, [1, 2])`

---

## Gas configuration

All three functions accept an optional `gasMultiplier` parameter.

### Behavior

When `gasMultiplier` is omitted or `<= 1`, the transaction is submitted with no gas overrides (provider defaults apply).

When `gasMultiplier > 1`, the function queries the current network fee data and scales the result:

- On **EIP-1559 networks** (standard Polygon): both `maxFeePerGas` and `maxPriorityFeePerGas` are multiplied.
- On **legacy networks**: `gasPrice` is multiplied.

The multiplier is applied as integer arithmetic: `gasPrice * round(multiplier * 100) / 100`.

### Environment variable

The live trading engine reads `POLYMARKET_EOA_GAS_MULTIPLIER` from the environment and passes it to these functions. Setting a value above `1.0` (e.g. `1.5`) increases the probability that a transaction is included in the next block on Polygon's fee market.

```bash
POLYMARKET_EOA_GAS_MULTIPLIER=1.5
```

::: tip Stuck transactions on Polygon
Polygon gas fees can spike during congestion. If split or merge transactions are consistently stuck, increase `POLYMARKET_EOA_GAS_MULTIPLIER` to `1.5` or `2.0`.
:::

## Transaction waiting behavior

Every function awaits the transaction receipt via `tx.wait()` before returning. The returned `txHash` is taken from `receipt.hash` if present, falling back to the unconfirmed `tx.hash`.

There is no configurable timeout on `tx.wait()`. If the network is congested and the transaction is not mined within a reasonable period, the call will remain pending until the transaction is eventually included or rejected.

::: warning No automatic retry
These functions do not retry on failure. If a transaction reverts or times out, the caller (the trading engine or redeem watcher) is responsible for handling the error.
:::

## conditionId format

All three functions validate the `conditionId` with the regex `/^0x[0-9a-fA-F]{64}$/`. Passing a malformed string results in an immediate thrown error before any RPC call is made.

In the trading engine, the `conditionId` corresponds to `MarketOrderBooksSnapshot.market` — the bytes32 identifier assigned to each market by Polymarket.

## ABI reference

The module uses a minimal ABI for the ConditionalTokens contract:

```solidity
function splitPosition(
  address collateralToken,
  bytes32 parentCollectionId,
  bytes32 conditionId,
  uint256[] partition,
  uint256 amount
)

function mergePositions(
  address collateralToken,
  bytes32 parentCollectionId,
  bytes32 conditionId,
  uint256[] partition,
  uint256 amount
)

function redeemPositions(
  address collateralToken,
  bytes32 parentCollectionId,
  bytes32 conditionId,
  uint256[] indexSets
)
```
