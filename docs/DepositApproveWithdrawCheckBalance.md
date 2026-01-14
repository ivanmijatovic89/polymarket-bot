# Deposit, Approve, Withdraw, Check Balances (SAFE + Relayer)

This guide explains the helper commands for funding your SAFE wallet, approving tokens, withdrawing funds, and checking balances/approvals.

## Prerequisites

Set these in your `.env`:

- `PRIVATE_KEY` (EOA signer)
- `POLYGON_RPC_URL`
- CLOB credentials:
  - `POLYMARKET_API_KEY`
  - `POLYMARKET_API_SECRET`
  - `POLYMARKET_API_PASSPHRASE`
- Builder (Relayer) credentials:
  - `POLYMARKET_BUILDER_API_KEY`
  - `POLYMARKET_BUILDER_API_SECRET`
  - `POLYMARKET_BUILDER_API_PASSPHRASE`
- Relayer settings:
  - `POLYMARKET_RELAYER_URL` (default: `https://relayer-v2.polymarket.com/`)
  - `POLYMARKET_RELAYER_CHAIN_ID=137`
  - `POLYMARKET_RELAYER_TX_TYPE=SAFE`
- Split mode:
  - `POLYMARKET_TX_MODE_SPLIT=relayer`
- SAFE funder:
  - `CLOB_FUNDER=<safeAddress>`
  - `CLOB_SIGNATURE_TYPE=2`

If you don't know your SAFE address yet:

```bash
npm run relayer:show-safe
```

## 1) Deposit USDC (EOA → SAFE)

Deposits USDC from your EOA (the wallet behind `PRIVATE_KEY`) to the SAFE address.
This is an on-chain transfer, so **your EOA pays gas**.

```bash
npm run relayer:deposit-usdc -- --to 0xYourSafeAddressHere --amount 5
```

## 2) Approve tokens (SAFE → CTF + Exchange)

Approves:
- USDC for the CTF contract (split)
- USDC for the Exchange contract (buy settlement)
- ERC1155 approval for the Exchange (sell settlement)

Executed **gasless** via the relayer SAFE.

```bash
npm run relayer:approve
```

## 3) Withdraw USDC (SAFE → EOA)

Withdraws USDC from SAFE to your EOA address.
Executed **gasless** via the relayer SAFE.

```bash
npm run relayer:withdraw-usdc -- --to 0xYourEoaAddressHere --amount 5
```

## 4) Check balances + approvals (EOA + SAFE)

Logs balances and approvals for both wallets.

```bash
npm run check:balances
```

If `POLYMARKET_TX_MODE_SPLIT=relayer`, this command exits non‑zero if either wallet is missing approvals or balance.
