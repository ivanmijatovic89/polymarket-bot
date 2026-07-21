---
title: Create CLOB API Key
description: How to derive or create Polymarket CLOB API credentials from an EOA private key.
---

# Create CLOB API Key

Polymarket's Central Limit Order Book (CLOB) uses an application-level API key separate from the wallet private key. This key, together with a secret and passphrase, authenticates REST and WebSocket requests to the CLOB. The credentials are derived deterministically from the EOA private key via a signature-based derivation scheme, so re-running the command on the same key always produces the same credentials.

## What the credentials are

| Field          | Environment variable        | Description                            |
| -------------- | --------------------------- | -------------------------------------- |
| API Key        | `POLYMARKET_API_KEY`        | UUID-format identifier for the session |
| API Secret     | `POLYMARKET_API_SECRET`     | Used to sign HMAC request signatures   |
| API Passphrase | `POLYMARKET_API_PASSPHRASE` | Additional authentication factor       |

These three values together authenticate all order placement, cancellation, and account queries.

::: warning Credentials are wallet-scoped
Each EOA address has exactly one set of CLOB credentials. Running this command again with the same private key returns the same credentials. If you have multiple bots each with their own private key, run this command once per wallet.
:::

## Prerequisites

- Node.js v20
- An EOA private key (hex string, with or without `0x` prefix)
- Network access to the CLOB API (default: `https://clob.polymarket.com`)

## Running the command

Pass the private key as a flag:

```bash
npm run clob:api-key -- --private-key 0xYOUR_PRIVATE_KEY
```

Or pass it as a positional argument:

```bash
npx tsx src/cli/create-clob-api-key.ts 0xYOUR_PRIVATE_KEY
```

::: danger Keep the private key off your shell history
Prefer reading the key from a file or environment variable rather than typing it directly in the terminal. Shell history logs the full command.

```bash
npm run clob:api-key -- --private-key "$(cat ~/.polymarket/pk.txt)"
```

:::

## Optional environment variables

| Variable        | Default                       | Description                          |
| --------------- | ----------------------------- | ------------------------------------ |
| `CLOB_API_URL`  | `https://clob.polymarket.com` | CLOB host to derive credentials from |
| `CLOB_CHAIN_ID` | `137`                         | Chain ID (Polygon mainnet)           |

You do not need to set these for standard Polymarket Polygon mainnet use.

## Example output

```
# CLOB API credentials (save to your .env.botX)
POLYMARKET_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
POLYMARKET_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
POLYMARKET_API_PASSPHRASE=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# EOA address: 0xYourEoaAddress
```

The output is formatted as shell variable assignments ready to paste into an `.env` file.

## Where to put the credentials

Copy the three `POLYMARKET_API_*` lines into your bot's `.env` file (or `.env.botX` for multi-bot setups):

```bash
# .env or .env.botA
PRIVATE_KEY=0xYOUR_PRIVATE_KEY
POLYMARKET_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
POLYMARKET_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
POLYMARKET_API_PASSPHRASE=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

::: tip Multi-bot credential isolation
When running multiple bots with different wallets, place each wallet's credentials in its own `.env.botX` file and set `BOT_ENV=botX` before starting that bot instance. See [Multiple Bots](/live-trading/multiple-bots) for the full setup.
:::

## Troubleshooting

**`Missing key/secret/passphrase in response`** — The CLOB API returned an unexpected response shape. Verify `CLOB_API_URL` is reachable and that the private key is valid.

**`failed: invalid private key`** — The supplied key is not a valid 32-byte hex string. Ensure it is 64 hex characters (optionally prefixed with `0x`).

**Network errors** — Check that `CLOB_API_URL` is accessible from your environment. Corporate firewalls or VPNs can block outbound HTTPS to Polymarket domains.
