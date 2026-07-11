---
title: Check Balances and Approvals
description: How to verify wallet balances and on-chain token approvals for EOA and SAFE wallets before running the trading bot.
---

# Check Balances and Approvals

The `check:balances` command inspects both the EOA wallet and, when configured, the SAFE multisig wallet to confirm that all prerequisites for trading are satisfied. It is also run automatically during trading-bot startup to prevent the bot from launching in an unready state.

## When to use this command

Run this command:

- Before starting the bot for the first time after a new deployment.
- After depositing USDC to either the EOA or SAFE wallet.
- After running `relayer:approve` or `eoa:approve` to confirm approvals landed on-chain.
- Any time the bot refuses to start with an approval or balance error.

## Running the command

```bash
npm run check:balances
```

The script reads configuration from environment variables. No arguments are accepted.

## Required environment variables

| Variable                                  | Required        | Default                       | Description                                                      |
| ----------------------------------------- | --------------- | ----------------------------- | ---------------------------------------------------------------- |
| `PRIVATE_KEY` or `POLYMARKET_PRIVATE_KEY` | Yes (EOA check) | —                             | Hex private key of the EOA wallet                                |
| `POLYGON_RPC_URL`                         | No              | `https://polygon-rpc.com`     | Polygon JSON-RPC endpoint                                        |
| `CLOB_API_URL` or equivalent              | No              | `https://clob.polymarket.com` | CLOB host used to resolve contract addresses                     |
| `CLOB_CHAIN_ID`                           | No              | `137`                         | Chain ID (Polygon mainnet)                                       |
| `CLOB_FUNDER`                             | No              | —                             | SAFE wallet address; enables the SAFE balance check when set     |
| `POLYMARKET_TX_MODE_SPLIT`                | No              | `direct`                      | Set to `relayer` to apply strict exit-code semantics (see below) |

::: tip Using a custom RPC
The default public Polygon RPC can be slow. For production use, set `POLYGON_RPC_URL` to a private endpoint (e.g. Alchemy, Ankr, QuickNode).
:::

## What is checked

The command runs two sequential checks: one for the EOA wallet and one for the SAFE wallet (only when `CLOB_FUNDER` is set).

### For each wallet the following is verified

**USDC balance** — The wallet's USDC (ERC-20) balance on Polygon. A balance of zero is a fatal error; the bot cannot place orders without collateral.

**POL (native) balance** — The wallet's POL (native MATIC) balance. A balance of zero is a fatal error; gas is required for every on-chain transaction.

**USDC allowance for the Exchange contract** — The ERC-20 allowance granted to the Polymarket Exchange contract. Must be non-zero to allow the exchange to debit USDC when orders are filled.

**USDC allowance for the ConditionalTokens (CTF) contract** — The ERC-20 allowance granted to the CTF contract. Required for split and merge operations.

**ERC-1155 approval for the Exchange contract** — The `isApprovedForAll` flag on the ConditionalTokens contract, granting the Exchange contract the right to transfer any outcome token on behalf of the wallet. This approval covers all markets simultaneously.

### Console output format

Each check emits a line per field:

```
[blockchain] EOA wallet address: 0x...
[blockchain] EOA exchange contract: 0x...
[blockchain] EOA conditional token contract: 0x...
[blockchain] EOA POL balance: 1.234 POL
[blockchain] EOA USDC balance: 500.000000 USDC
[blockchain] EOA USDC allowance for Exchange: 115792089237316195... USDC
[blockchain] EOA USDC allowance for CTF: 115792089237316195... USDC
[blockchain] EOA conditional tokens approved (ERC1155): YES
```

When `CLOB_FUNDER` is set, the same lines repeat with the `SAFE` label.

### Error messages

If any check fails, the script prints a red error line and throws:

| Error                             | Meaning                                 | Fix                                            |
| --------------------------------- | --------------------------------------- | ---------------------------------------------- |
| `USDC balance is 0`               | No USDC in the wallet                   | Deposit USDC to the wallet                     |
| `POL balance is 0`                | No gas token                            | Send POL to the wallet for gas                 |
| `USDC allowance is 0`             | Exchange not approved to spend USDC     | Run `npm run eoa:approve` or `relayer:approve` |
| `Conditional tokens not approved` | Exchange cannot transfer outcome tokens | Run `npm run eoa:approve` or `relayer:approve` |

## Exit-code behavior

| Scenario                                                   | Exit code |
| ---------------------------------------------------------- | --------- |
| All checks pass                                            | `0`       |
| EOA check fails                                            | `1`       |
| SAFE check fails (when `CLOB_FUNDER` is set)               | `1`       |
| `POLYMARKET_TX_MODE_SPLIT=relayer` and either wallet fails | `1`       |

::: warning Bot startup dependency
The trading bot calls this check on startup and aborts if exit code is non-zero. Fix all reported errors before attempting to start the bot.
:::

## Interpreting large allowance values

A USDC allowance of `115792089237316195423570985008687907853269984665640564039457584007913129639935` (or similar large number) means an unlimited (`uint256 max`) approval was granted. This is the standard pattern used by `eoa:approve` and `relayer:approve`.

## Fixing missing approvals

If approvals are missing, use the appropriate command for your execution mode:

**EOA mode:**

```bash
npm run eoa:approve
```

**Relayer/SAFE mode:**

```bash
npm run relayer:approve
```

See [SAFE Relayer CLI](./relayer-cli.md) and [Deposit, Approve, Withdraw, Check Balance](/other/DepositApproveWithdrawCheckBalance) for full details.
