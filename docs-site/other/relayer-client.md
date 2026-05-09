---
title: Relayer Client
description: Reference for the Polymarket relayer client module — operations available, required environment variables, and how it differs from direct EOA execution.
---

# Relayer Client

`src/polymarket/relayerClient.ts` provides the integration layer between the bot and Polymarket's builder relayer service. In Relayer/SAFE mode, the EOA wallet signs transactions on behalf of a Gnosis SAFE proxy, and the relayer broadcasts and sponsors those transactions on-chain. This module handles all relayer interactions: SAFE deployment, token approvals, position splits and merges, position redemption, and USDC withdrawal.

All exported functions are async and resolve only after the relayer confirms the transaction has reached `STATE_MINED` or `STATE_CONFIRMED` status. A `STATE_FAILED` result throws an error.

## How the relayer client differs from direct EOA execution

| Aspect                | EOA mode (`conditionalTokens.ts`) | Relayer/SAFE mode (`relayerClient.ts`)                      |
| --------------------- | --------------------------------- | ----------------------------------------------------------- |
| Signer                | EOA wallet (ethers.js `Wallet`)   | EOA wallet (viem `WalletClient`) via relayer                |
| Transaction sender    | EOA address                       | SAFE proxy address                                          |
| Gas payment           | EOA pays POL gas                  | Relayer sponsors gas                                        |
| Transaction batching  | One tx per operation              | Multiple ops per relayer call (atomic)                      |
| Authentication        | Private key only                  | Private key + Builder API credentials                       |
| Confirmation model    | `tx.wait()` from ethers           | `response.wait()` from `@polymarket/builder-relayer-client` |
| Applicable strategies | `POLYMARKET_TX_MODE_*=direct`     | `POLYMARKET_TX_MODE_*=relayer`                              |

## Required environment variables

All relayer operations require the following variables:

| Variable                                  | Description                                        |
| ----------------------------------------- | -------------------------------------------------- |
| `PRIVATE_KEY` or `POLYMARKET_PRIVATE_KEY` | EOA private key (hex, with or without `0x` prefix) |
| `POLYMARKET_BUILDER_API_KEY`              | Builder API key credential                         |
| `POLYMARKET_BUILDER_API_SECRET`           | Builder API secret credential                      |
| `POLYMARKET_BUILDER_API_PASSPHRASE`       | Builder API passphrase credential                  |

Optional variables that tune relayer behavior:

| Variable                      | Default                              | Description                                               |
| ----------------------------- | ------------------------------------ | --------------------------------------------------------- |
| `POLYMARKET_RELAYER_URL`      | `https://relayer-v2.polymarket.com/` | Relayer service endpoint                                  |
| `POLYMARKET_RELAYER_CHAIN_ID` | `137`                                | Target chain ID                                           |
| `POLYMARKET_RELAYER_TX_TYPE`  | `SAFE`                               | Transaction type: `SAFE` (default) or `PROXY`             |
| `POLYGON_RPC_URL`             | (provider default)                   | Polygon RPC endpoint for wallet client                    |
| `CLOB_API_URL`                | `https://clob.polymarket.com`        | Used by `approveViaRelayer` to resolve contract addresses |

## Exported functions

### `deploySafeIfNeeded`

Deploys a Gnosis SAFE proxy via the relayer if one does not already exist for the EOA. The SAFE address is deterministic, so calling this on an already-deployed SAFE is a no-op.

```typescript
deploySafeIfNeeded(): Promise<{
  proxyAddress: string
  transactionHash: string
} | null>
```

Returns `null` when no deployment result is returned by the relayer (e.g. already deployed). Returns the proxy address and transaction hash on successful deployment.

CLI equivalent: `npm run relayer:deploy-safe`

---

### `getExpectedSafeAddress`

Computes the deterministic SAFE address for the current EOA without deploying.

```typescript
getExpectedSafeAddress(): Promise<string>
```

Calls `RelayClient.getExpectedSafe()`. Throws if the underlying client does not expose this method.

CLI equivalent: `npm run relayer:show-safe`

---

### `approveViaRelayer`

Grants all three token approvals required for trading, executed atomically from the SAFE in a single relayer transaction batch:

1. `USDC.approve(CONDITIONAL_TOKENS_ADDRESS, uint256_max)` — allows the CTF contract to debit USDC for split operations
2. `USDC.approve(exchangeAddress, uint256_max)` — allows the Exchange contract to debit USDC on order fill
3. `ConditionalTokens.setApprovalForAll(exchangeAddress, true)` — allows the Exchange contract to transfer any outcome token

```typescript
approveViaRelayer(args: {
  clobHost: string
  chainId: number
}): Promise<{ txHash: string }>
```

The Exchange contract address is fetched dynamically from the CLOB API using `getContractAddresses(clobHost, chainId)`.

CLI equivalent: `npm run relayer:approve`

---

### `splitViaRelayer`

Splits USDC from the SAFE into binary outcome YES and NO shares by calling `ConditionalTokens.splitPosition`.

```typescript
splitViaRelayer(args: {
  conditionId: string   // bytes32 hex string (0x + 64 hex chars)
  shares: number        // collateral amount in share units (1 share = 1 USDC)
}): Promise<{ txHash: string; splitShares: number }>
```

**Amount encoding:** `shares` is converted to USDC base units via `parseUnits(String(shares), 6)`.

**On-chain call (via relayer):** `splitPosition(USDC_ADDRESS, ZeroHash, conditionId, [1n, 2n], amount)`

Throws if:

- `conditionId` does not match `/^0x[0-9a-fA-F]{64}$/`
- `shares <= 0` or non-finite
- Relayer returns no `transactionHash`
- Relayer state is `STATE_FAILED`
- Relayer state is neither `STATE_MINED` nor `STATE_CONFIRMED`

---

### `mergeViaRelayer`

Merges binary outcome YES and NO shares back to USDC from the SAFE by calling `ConditionalTokens.mergePositions`.

```typescript
mergeViaRelayer(args: {
  conditionId: string
  shares: number
}): Promise<{ txHash: string; mergedShares: number }>
```

**On-chain call (via relayer):** `mergePositions(USDC_ADDRESS, ZeroHash, conditionId, [1n, 2n], amount)`

The same error conditions as `splitViaRelayer` apply.

::: warning Fill status prerequisite
Shares acquired from fills must be at `MINED` status before merging. Attempting to merge shares at `MATCHED` status can cause the on-chain transaction to revert because the token transfer is not yet settled.
:::

---

### `redeemViaRelayer`

Redeems winning outcome shares for USDC from the SAFE after a market resolves.

```typescript
redeemViaRelayer(args: {
  conditionId: string
}): Promise<{ txHash: string }>
```

**On-chain call (via relayer):** `redeemPositions(USDC_ADDRESS, ZeroHash, conditionId, [1n, 2n])`

Unlike split and merge, no `shares` amount is required: the contract redeems all available winning shares for the given condition.

Throws on `STATE_FAILED` or missing `transactionHash`.

---

### `withdrawUsdcViaRelayer`

Transfers USDC from the SAFE to an arbitrary recipient address.

```typescript
withdrawUsdcViaRelayer(args: {
  to: string      // destination address (must start with 0x)
  amount: number  // USDC amount in whole units
}): Promise<{ txHash: string }>
```

**On-chain call (via relayer):** `USDC.transfer(to, amount)` where amount is encoded to 6-decimal base units.

Throws if `to` does not start with `0x`, `amount <= 0`, or the relayer returns no `transactionHash`.

CLI equivalent: `npm run relayer:withdraw-usdc -- --to <address> --amount <n>`

---

## Transaction lifecycle

Every operation follows the same lifecycle:

1. The function constructs a `Transaction` object (ABI-encoded `data`, `to` address, `value: '0'`).
2. `client.execute([tx, ...], label)` submits the batch to the relayer.
3. `response.wait()` polls until the relayer reports a terminal state.
4. The function checks `result.state`:
   - `STATE_MINED` or `STATE_CONFIRMED` — success, return `txHash`.
   - `STATE_FAILED` — throw with the transaction hash in the error message.
   - Any other state (e.g. pending after timeout) — throw with the unexpected state.

## SAFE transaction type

The relayer supports two transaction types, controlled by `POLYMARKET_RELAYER_TX_TYPE`:

| Value            | `RelayerTxType`       | Description                                    |
| ---------------- | --------------------- | ---------------------------------------------- |
| `SAFE` (default) | `RelayerTxType.SAFE`  | Standard Gnosis SAFE multi-sig proxy execution |
| `PROXY`          | `RelayerTxType.PROXY` | Alternative proxy execution path               |

For standard deployments, leave this at the default `SAFE`.

## ABI summary

The module encodes four contract interfaces using viem's `encodeFunctionData`:

| Contract                     | Functions used                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| USDC (ERC-20)                | `approve(address spender, uint256 amount)`, `transfer(address to, uint256 amount)` |
| ConditionalTokens (ERC-1155) | `setApprovalForAll(address operator, bool approved)`                               |
| ConditionalTokens (CTF)      | `splitPosition(...)`, `mergePositions(...)`, `redeemPositions(...)`                |

## Selecting relayer vs. direct mode per operation

Individual operation types can be independently configured via environment variables:

| Variable                    | Controls          | Values                             |
| --------------------------- | ----------------- | ---------------------------------- |
| `POLYMARKET_TX_MODE_SPLIT`  | Split operations  | `direct` (EOA) or `relayer` (SAFE) |
| `POLYMARKET_TX_MODE_MERGE`  | Merge operations  | `direct` or `relayer`              |
| `POLYMARKET_TX_MODE_REDEEM` | Redeem operations | `direct` or `relayer`              |

When set to `relayer`, the trading engine calls the corresponding `*ViaRelayer` function from this module. When set to `direct`, it calls the equivalent function from `src/blockchain/conditionalTokens.ts` using the EOA directly.

::: details Example: relayer for split only

```bash
POLYMARKET_TX_MODE_SPLIT=relayer
POLYMARKET_TX_MODE_MERGE=direct
POLYMARKET_TX_MODE_REDEEM=direct
```

This configuration routes splits through the SAFE/relayer while merge and redeem sign directly from the EOA. This is an advanced configuration; most deployments use the same mode for all three.
:::
