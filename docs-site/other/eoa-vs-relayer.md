---
title: EOA vs Relayer Execution Mode
description: The two wallet configurations supported by the bot — direct EOA signing and SAFE multisig via the Polymarket relayer — and how to choose between them.
---

# EOA vs Relayer Execution Mode

The bot supports two ways to sign and submit on-chain transactions. The choice affects how orders are placed, how funds are held, and how split/merge/redeem operations are executed.

## EOA mode

**EOA (Externally Owned Account)** is the simpler setup. Your private key signs every transaction directly. The CLOB API authenticates via L1 or L2 signatures derived from that key.

```
Your private key → signs CLOB orders + on-chain txs
Your EOA wallet → holds USDC + approvals
```

**When to use EOA:**

- Getting started or running a single bot
- Lower operational overhead
- When fund custody is not a concern

**Required environment variables:**

```bash
PRIVATE_KEY=0x...                  # or POLYMARKET_PRIVATE_KEY
POLYMARKET_API_KEY=...
POLYMARKET_API_SECRET=...
POLYMARKET_API_PASSPHRASE=...
CLOB_SIGNATURE_TYPE=0              # default, can be omitted
```

**Setup checklist:**

1. Fund your EOA wallet with USDC on Polygon
2. Run `npm run check:balances` to verify balance and approvals
3. If approvals are missing: `npm run eoa:approve && npm run eoa:approve-ctf`
4. Set `DRY_RUN=false` and start the bot

---

## Relayer / SAFE mode

**Relayer mode** uses a [SAFE multisig wallet](https://safe.global) to hold funds. Your EOA still signs transactions, but it acts as a delegate — the SAFE is the actual owner of the positions. Polymarket's relayer service posts the transactions on-chain, paying gas on your behalf.

```
Your private key (EOA) → signs on behalf of SAFE
SAFE wallet → holds USDC + positions
Polymarket relayer → submits on-chain txs (pays gas)
```

**When to use Relayer:**

- You want on-chain access control (multiple signers)
- You want to separate custody (SAFE) from signing (EOA)
- You are running large positions where on-chain settlement matters
- You want Polymarket to cover gas costs

**Required environment variables:**

```bash
PRIVATE_KEY=0x...                          # EOA that signs on behalf of SAFE
POLYMARKET_API_KEY=...
POLYMARKET_API_SECRET=...
POLYMARKET_API_PASSPHRASE=...

CLOB_FUNDER=0x...                          # SAFE wallet address
CLOB_SIGNATURE_TYPE=2                      # required for SAFE mode

POLYMARKET_BUILDER_API_KEY=...
POLYMARKET_BUILDER_API_SECRET=...
POLYMARKET_BUILDER_API_PASSPHRASE=...

# Controls which operations go via relayer vs direct EOA tx
POLYMARKET_TX_MODE_SPLIT=relayer           # or: direct
POLYMARKET_TX_MODE_MERGE=relayer           # or: direct
POLYMARKET_TX_MODE_REDEEM=relayer          # or: direct
```

**Setup checklist:**

1. Deploy the SAFE: `npm run relayer:deploy-safe`
2. Verify the address: `npm run relayer:show-safe`
3. Approve the SAFE to spend USDC: `npm run relayer:approve`
4. Deposit USDC into the SAFE: `npm run relayer:deposit-usdc`
5. Run `npm run check:balances` to confirm both EOA and SAFE are funded and approved
6. Set `DRY_RUN=false` and start the bot

::: warning
The trading bot startup checks balances and approvals on both wallets. If either is missing, the bot aborts before connecting to any markets. Run `npm run check:balances` before going live.
:::

---

## Comparison

|                         | EOA                     | Relayer / SAFE                                     |
| ----------------------- | ----------------------- | -------------------------------------------------- |
| Fund custody            | EOA wallet              | SAFE multisig                                      |
| Gas                     | Paid by EOA             | Paid by relayer                                    |
| Setup complexity        | Low                     | Medium                                             |
| On-chain access control | No                      | Yes (SAFE owners)                                  |
| Signature type          | `CLOB_SIGNATURE_TYPE=0` | `CLOB_SIGNATURE_TYPE=2`                            |
| Split/merge/redeem      | Direct EOA tx           | Via relayer or direct (configurable per operation) |

---

## Mixing modes per operation

In Relayer mode, you can route each operation type independently using `POLYMARKET_TX_MODE_*`:

```bash
POLYMARKET_TX_MODE_SPLIT=relayer    # splits go via Polymarket relayer
POLYMARKET_TX_MODE_MERGE=direct     # merges sent directly from EOA
POLYMARKET_TX_MODE_REDEEM=relayer   # redemptions go via relayer
```

Setting any of these to `direct` means the EOA signs and broadcasts the transaction itself, paying gas from the EOA wallet. The SAFE still holds the funds — only the submission path changes.

::: tip
If you are unsure which mode to use, start with EOA. You can migrate to Relayer/SAFE later by deploying a SAFE, transferring USDC, and updating the environment variables.
:::
