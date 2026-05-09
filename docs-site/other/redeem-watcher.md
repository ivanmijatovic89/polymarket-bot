---
title: Redeem Watcher
description: How to run the periodic redemption daemon that monitors resolved Polymarket positions and automatically redeems winning conditional tokens.
---

# Redeem Watcher

The redeem watcher is a long-running daemon that polls your wallet's positions on a configurable interval, identifies positions that are eligible for redemption (i.e., the market has resolved and the token is worth $1.00), and submits redemption transactions automatically.

A local state file tracks which `conditionId`s have already been redeemed, so the watcher skips positions it has already processed even across restarts.

## Running the watcher

```bash
npm run redeem-watcher
```

Variant shortcuts are also available:

```bash
npm run redeem-watcher:relayer   # force relayer mode
npm run redeem-watcher:direct    # force EOA direct mode
```

Or invoke directly:

```bash
npx tsx src/cli/redeem-watcher.ts
```

## Prerequisites

### Relayer mode (default)

```bash
CLOB_FUNDER=0x<safeAddress>          # SAFE wallet address
POLYMARKET_BUILDER_API_KEY=...
POLYMARKET_BUILDER_API_SECRET=...
POLYMARKET_BUILDER_API_PASSPHRASE=...
```

### Direct (EOA) mode

```bash
PRIVATE_KEY=0x<eoaPrivateKey>
```

Set `POLYMARKET_TX_MODE_REDEEM=direct` to use EOA mode.

## Configuration

| Environment variable            | Default                                  | Description                                                                                                    |
| ------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `POLYMARKET_TX_MODE_REDEEM`     | `relayer`                                | Redemption method: `relayer` or `direct`                                                                       |
| `REDEEM_WATCH_INTERVAL_MS`      | `30000`                                  | Polling interval in milliseconds                                                                               |
| `REDEEM_STATE_PATH`             | `data/redeem/redeemed.json`              | Path to the JSON file tracking already-redeemed condition IDs                                                  |
| `POLYMARKET_EOA_GAS_MULTIPLIER` | `2`                                      | Gas multiplier applied to on-chain transactions in direct mode                                                 |
| `POLYGON_RPC_URL`               | `https://polygon-bor-rpc.publicnode.com` | RPC endpoint used in direct mode                                                                               |
| `WEB_UI_HOST`                   | —                                        | If set alongside `WEB_UI_PORT`, the watcher notifies the trading bot's web UI after each successful redemption |
| `WEB_UI_PORT`                   | —                                        | See above                                                                                                      |

## How it works

### Tick loop

On each tick the watcher:

1. Calls the Polymarket data API (`fetchAllPositions`) to retrieve all positions for the redeem address.
2. Splits positions into **redeemable** (market resolved, token redeemable) and **pending** (market still open or awaiting resolution).
3. Prints a summary table of both lists to the console.
4. For each redeemable position whose `conditionId` is not already in the state file, submits a redemption transaction.
5. On success, adds the `conditionId` to the in-memory set and persists the state file.

The loop then schedules itself to run again after `REDEEM_WATCH_INTERVAL_MS` milliseconds.

### Relayer vs direct mode

| Mode      | How redemption is submitted                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `relayer` | Calls `redeemViaRelayer` — the transaction is submitted through the Polymarket builder API using the SAFE wallet (`CLOB_FUNDER`)                 |
| `direct`  | Calls `redeemBinaryOutcomePositions` — the transaction is signed by the EOA private key and broadcast directly to Polygon via the configured RPC |

The redeem address is determined by the mode:

- **relayer**: `CLOB_FUNDER` (SAFE address)
- **direct**: derived from `PRIVATE_KEY`

::: danger Missing address aborts startup
If the required address for the selected mode is absent (`CLOB_FUNDER` for relayer, `PRIVATE_KEY` for direct), the watcher throws and exits before the first tick.
:::

### State file

The state file is a JSON object:

```json
{
  "redeemedConditionIds": ["0xabc...", "0xdef..."]
}
```

The directory is created automatically if it does not exist. On each successful redemption the file is written synchronously before moving to the next position.

## Console output

On each tick the watcher prints:

```
[redeem-watcher] tick @ May 09, 2026 14:30:00 | 12 positions (3 redeemable, 9 pending)

  Redeemable:
  Slug                              Size    Outcome   Value    Start               Ago
  ──────────────────────────────────────────────────────────────────────────────────────
  btc-updown-15m-1716825600          100    Up        $100.00  May 09 2026 14:00   30m
  ...

  Pending:
  ...
```

After a successful redemption:

```
[redeem-watcher] redeemed {
  slug: "btc-updown-15m-1716825600",
  conditionId: "0x...",
  txHash: "0x...",
  redeemedValue: 100
}
```

## Web UI balance refresh

If both `WEB_UI_HOST` and `WEB_UI_PORT` are set, the watcher opens a WebSocket connection to the trading bot's web UI endpoint (`ws://<host>:<port>/ws`) and sends a `refresh_balance` command after each successful redemption. This keeps the UI's balance display current without waiting for the bot's own refresh cycle. The connection is re-established automatically if it drops.

::: tip Running alongside the trading bot
Run the redeem watcher as a separate process alongside the trading bot. It does not interfere with the bot's order flow and can safely redeem positions from completed windows while the bot is trading the current window.
:::
