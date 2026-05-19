---
title: SAFE Relayer CLI
description: How to use the relayer CLI to deploy a SAFE wallet, approve tokens, deposit and withdraw USDC for Polymarket trading.
---

# SAFE Relayer CLI

The relayer CLI provides subcommands for managing a Gnosis SAFE wallet used as the funding source in Relayer/SAFE execution mode. In this mode the SAFE wallet holds the USDC and outcome token positions, while the EOA signs transactions on behalf of the SAFE via Polymarket's relayer service.

Use the EOA-direct subcommands (`eoa-approve`, `eoa-approve-ctf`, `deposit-usdc`) when operating in EOA mode. Use `deploy-safe`, `show-safe`, and `approve` when operating in Relayer/SAFE mode.

## Choosing between EOA and Relayer/SAFE mode

| Criterion         | EOA mode      | Relayer/SAFE mode                                          |
| ----------------- | ------------- | ---------------------------------------------------------- |
| Wallet type       | Plain EOA     | Gnosis SAFE (multisig)                                     |
| Who holds funds   | EOA           | SAFE                                                       |
| Who signs         | EOA directly  | EOA signs on behalf of SAFE                                |
| Gas payment       | EOA pays gas  | Relayer sponsors gas                                       |
| Required env vars | `PRIVATE_KEY` | `PRIVATE_KEY` + `POLYMARKET_BUILDER_API_*` + `CLOB_FUNDER` |
| Setup steps       | `eoa:approve` | `relayer:deploy-safe` → `relayer:approve`                  |

## Subcommands

### `deploy-safe`

Deploys a new Gnosis SAFE proxy contract via the Polymarket relayer service. The SAFE address is deterministic given the EOA, so this only deploys if the SAFE does not yet exist on-chain.

```bash
npm run relayer:deploy-safe
```

**Output:**

```
[relayer][deploy-safe] proxyAddress= 0xYourSafeAddress
[relayer][deploy-safe] txHash= 0x...
```

After deployment, set `CLOB_FUNDER=0xYourSafeAddress` in your `.env` file. The SAFE address must then receive USDC and have approvals set (see `approve` below) before trading can begin.

**Required env vars:** `PRIVATE_KEY`, `POLYMARKET_BUILDER_API_KEY`, `POLYMARKET_BUILDER_API_SECRET`, `POLYMARKET_BUILDER_API_PASSPHRASE`

---

### `show-safe`

Displays the SAFE address without deploying. If `CLOB_FUNDER` is already set, it echoes that value. Otherwise it computes the expected deterministic address from the EOA.

```bash
npm run relayer:show-safe
```

**Output:**

```
[relayer][show-safe] safeAddress= 0xYourSafeAddress
[relayer][show-safe] Tip: set CLOB_FUNDER to this address
```

Use this before `deploy-safe` to preview the address, or after deployment to confirm the value to use for `CLOB_FUNDER`.

**Required env vars:** `PRIVATE_KEY`, `POLYMARKET_BUILDER_API_KEY`, `POLYMARKET_BUILDER_API_SECRET`, `POLYMARKET_BUILDER_API_PASSPHRASE`

---

### `approve`

Grants the necessary ERC-20 and ERC-1155 approvals from the SAFE wallet via the relayer. Submits three transactions atomically in a single relayer call:

1. USDC → ConditionalTokens contract: unlimited ERC-20 allowance (required for `split`)
2. USDC → Exchange contract: unlimited ERC-20 allowance (required for order fills)
3. ConditionalTokens → Exchange: `setApprovalForAll(true)` (required to transfer outcome tokens)

```bash
npm run relayer:approve
```

**Output:**

```
[relayer][approve] txHash= 0x...
```

Run this once after deploying the SAFE. Re-run it after any approval reset.

**Required env vars:** `PRIVATE_KEY`, `POLYMARKET_BUILDER_API_KEY`, `POLYMARKET_BUILDER_API_SECRET`, `POLYMARKET_BUILDER_API_PASSPHRASE`, `CLOB_API_URL` (optional, defaults to `https://clob.polymarket.com`)

---

### `deposit-usdc`

Transfers USDC from the EOA to a target address (typically the SAFE) using an on-chain ERC-20 transfer signed directly by the EOA.

```bash
npm run relayer:deposit-usdc -- --to 0xSafeAddress --amount 500
```

| Flag               | Required | Description                                                            |
| ------------------ | -------- | ---------------------------------------------------------------------- |
| `--to`             | Yes      | Recipient address (the SAFE address)                                   |
| `--amount`         | Yes      | Amount in whole USDC (e.g. `500` = 500 USDC)                           |
| `--gas-price-gwei` | No       | Override gas price in Gwei; defaults to `2x` current network gas price |
| `--nonce`          | No       | Override transaction nonce                                             |

**Output:**

```
[relayer][deposit-usdc] submitted txHash= 0x...
[relayer][deposit-usdc] confirmed txHash= 0x...
```

If the transaction is not confirmed within 60 seconds, the command prints the hash and exits without waiting further. Check the Polygon explorer for status.

::: tip Gas price default
The command defaults to double the current network gas price to reduce the chance of a stuck transaction on Polygon's fee market. Use `--gas-price-gwei` to override.
:::

**Required env vars:** `PRIVATE_KEY`

---

### `withdraw-usdc`

Transfers USDC out of the SAFE to an arbitrary address via the relayer service.

```bash
npm run relayer:withdraw-usdc -- --to 0xDestinationAddress --amount 250
```

| Flag       | Required | Description                       |
| ---------- | -------- | --------------------------------- |
| `--to`     | Yes      | Recipient EOA or contract address |
| `--amount` | Yes      | Amount in whole USDC              |

**Output:**

```
[relayer][withdraw-usdc] txHash= 0x...
```

**Required env vars:** `PRIVATE_KEY`, `POLYMARKET_BUILDER_API_KEY`, `POLYMARKET_BUILDER_API_SECRET`, `POLYMARKET_BUILDER_API_PASSPHRASE`

---

### `eoa-approve`

Grants all three required approvals directly from the EOA (for EOA mode). Submits three separate on-chain transactions:

1. USDC → ConditionalTokens: unlimited allowance
2. USDC → Exchange: unlimited allowance
3. ConditionalTokens → Exchange: `setApprovalForAll(true)`

```bash
npm run eoa:approve
```

**Required env vars:** `PRIVATE_KEY`

---

### `eoa-approve-ctf`

Grants only the USDC → ConditionalTokens allowance from the EOA. Use when only the CTF allowance needs to be set or reset without touching the Exchange allowance.

```bash
npm run eoa:approve-ctf
```

**Required env vars:** `PRIVATE_KEY`

---

## Common environment variables

| Variable                                  | Default                              | Description                                                     |
| ----------------------------------------- | ------------------------------------ | --------------------------------------------------------------- |
| `PRIVATE_KEY` or `POLYMARKET_PRIVATE_KEY` | —                                    | EOA private key                                                 |
| `POLYGON_RPC_URL`                         | `https://polygon-rpc.com`            | Polygon JSON-RPC endpoint                                       |
| `CLOB_API_URL`                            | `https://clob.polymarket.com`        | Used to resolve Exchange and CTF contract addresses             |
| `CLOB_CHAIN_ID`                           | `137`                                | Chain ID                                                        |
| `CLOB_FUNDER`                             | —                                    | SAFE address; read by `show-safe` and referenced at bot startup |
| `POLYMARKET_BUILDER_API_KEY`              | —                                    | Builder API key (relayer subcommands only)                      |
| `POLYMARKET_BUILDER_API_SECRET`           | —                                    | Builder API secret                                              |
| `POLYMARKET_BUILDER_API_PASSPHRASE`       | —                                    | Builder API passphrase                                          |
| `POLYMARKET_RELAYER_URL`                  | `https://relayer-v2.polymarket.com/` | Relayer endpoint                                                |
| `POLYMARKET_RELAYER_CHAIN_ID`             | `137`                                | Relayer chain ID                                                |
| `POLYMARKET_RELAYER_TX_TYPE`              | `SAFE`                               | Transaction type: `SAFE` or `PROXY`                             |

## Setup sequence for Relayer/SAFE mode

```bash
# 1. Preview the SAFE address before deploying
npm run relayer:show-safe

# 2. Deploy the SAFE (safe to run if already deployed; no-op in that case)
npm run relayer:deploy-safe

# 3. Set CLOB_FUNDER=<proxyAddress> in your .env file, then deposit USDC
npm run relayer:deposit-usdc -- --to 0xYourSafeAddress --amount 500

# 4. Grant on-chain approvals from the SAFE via the relayer
npm run relayer:approve

# 5. Verify all balances and approvals
npm run check:balances
```

::: warning Approval prerequisite
`relayer:approve` must be run after every new SAFE deployment and whenever approvals are revoked. The bot startup check (`check:balances`) will fail until approvals are in place.
:::
