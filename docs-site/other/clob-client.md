---
title: CLOB Client
description: Reference for the CLOB client factory and the Polymarket Data API client, including credentials, EOA vs SAFE modes, and available operations.
---

# CLOB Client

The bot interacts with the Polymarket CLOB (Central Limit Order Book) through two separate clients:

- **`src/polymarket/clobClient.ts`** — wraps `@polymarket/clob-client` to handle credential formatting and configuration. Used for order placement, cancellation, and market data.
- **`src/polymarket/dataApi.ts`** — a lightweight fetch-based client for the Polymarket Data API (`https://data-api.polymarket.com`). Used for position history, portfolio value, and activity queries.

---

## CLOB Client Factory

### `createClobClient`

```typescript
createClobClient(opts?: CreateClobClientOptions): ClobClient
```

Creates and returns a configured `ClobClient` instance from `@polymarket/clob-client`. Configuration is loaded from environment variables by default and can be overridden per-instance.

```typescript
type CreateClobClientOptions = {
  config?: PolymarketConfig
  overrides?: {
    host?: string
    chainId?: number
    privateKey?: string
    creds?: PolymarketConfig['creds']
    signatureType?: number
    funder?: string
  }
}
```

| Option      | Description                                                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config`    | Pre-loaded `PolymarketConfig`. When absent, config is loaded from environment variables via `loadPolymarketConfigFromEnv`.                            |
| `overrides` | Per-field overrides applied on top of the resolved config. Useful in tests or when constructing multiple clients with slightly different credentials. |

### Required Credentials

The factory validates the following before constructing the client. Missing values throw immediately.

| Requirement    | Environment Variables                                                 |
| -------------- | --------------------------------------------------------------------- |
| Private key    | `PRIVATE_KEY` or `POLYMARKET_PRIVATE_KEY`                             |
| API key        | `POLYMARKET_API_KEY` or `CLOB_API_KEY`                                |
| API secret     | `POLYMARKET_API_SECRET` or `CLOB_SECRET`                              |
| API passphrase | `POLYMARKET_API_PASSPHRASE`, `CLOB_PASSPHRASE`, or `CLOB_PASS_PHRASE` |

::: danger Missing credentials
If any required credential is absent, `createClobClient` throws synchronously. This error will propagate to the top-level CLI entry point and abort startup.
:::

### Credential Format Conversion

The Gamma/CLOB internal representation uses `{ apiKey, secret, passphrase }`. The underlying `ClobClient` constructor expects `{ key, secret, passphrase }`. `createClobClient` performs this conversion automatically.

---

## EOA vs SAFE (Relayer) Mode

The signature type is controlled by `CLOB_SIGNATURE_TYPE`:

| `CLOB_SIGNATURE_TYPE` | Mode               | Description                                                                                                          |
| --------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `0` (default)         | **EOA**            | Orders are signed directly by the `PRIVATE_KEY` wallet. `CLOB_FUNDER` is ignored.                                    |
| `2`                   | **SAFE / Relayer** | Orders are signed by the EOA but funded through the SAFE wallet address in `CLOB_FUNDER`. `CLOB_FUNDER` is required. |

When `signatureType=2`, the `funder` parameter is passed to the `ClobClient` constructor as the sixth argument. The underlying library uses this to construct a SAFE-compatible signature.

::: warning SAFE mode requirements
When operating in SAFE mode (`CLOB_SIGNATURE_TYPE=2`), `CLOB_FUNDER` must be set and the SAFE wallet must have sufficient USDC balance and CTF approval. The trading bot verifies this at startup.
:::

---

## Configuration Reference

All configuration fields resolved by `loadPolymarketConfigFromEnv`:

| Field                 | Environment Variable     | Default                                                |
| --------------------- | ------------------------ | ------------------------------------------------------ |
| CLOB host             | `CLOB_API_URL`           | `https://clob.polymarket.com`                          |
| Chain ID              | `CLOB_CHAIN_ID`          | `137` (Polygon mainnet)                                |
| Signature type        | `CLOB_SIGNATURE_TYPE`    | `0`                                                    |
| Funder (SAFE address) | `CLOB_FUNDER`            | _(absent)_                                             |
| REST poll interval    | `CLOB_POLL_INTERVAL_MS`  | `1000` ms                                              |
| Market WS URL         | `POLYMARKET_WS_URL`      | `wss://ws-subscriptions-clob.polymarket.com/ws/market` |
| User WS URL           | `POLYMARKET_USER_WS_URL` | `wss://ws-subscriptions-clob.polymarket.com/ws/user`   |
| Gamma base URL        | `GAMMA_API_BASE_URL`     | `https://gamma-api.polymarket.com`                     |

---

## Data API Client

The Data API client (`src/polymarket/dataApi.ts`) provides read-only access to per-user position and activity data. All requests are unauthenticated — the `user` parameter is a public wallet address.

Base URL: `https://data-api.polymarket.com`

---

### `fetchPositions`

```typescript
fetchPositions(query: FetchPositionsOptions): Promise<Position[]>
```

Fetches open positions for a user address.

```typescript
type FetchPositionsOptions = {
  user: string // wallet address (required)
  limit?: number
  offset?: number
  sortBy?: 'SIZE' | 'VALUE' | 'PNL'
  sortDirection?: 'ASC' | 'DESC'
  redeemable?: boolean // filter to only redeemable positions
  mergeable?: boolean // filter to only mergeable positions
  sizeThreshold?: number // minimum position size
  market?: string // conditionId filter (comma-separated)
  eventId?: string // event filter (comma-separated)
  title?: string // partial title filter
}
```

**`Position` fields:**

| Field                | Type              | Description                                      |
| -------------------- | ----------------- | ------------------------------------------------ |
| `proxyWallet`        | `string`          | Polymarket proxy wallet address.                 |
| `asset`              | `string`          | CLOB token ID (asset ID).                        |
| `conditionId`        | `string`          | On-chain condition ID.                           |
| `size`               | `number`          | Current position size in shares.                 |
| `avgPrice`           | `number`          | Average entry price.                             |
| `initialValue`       | `number`          | USDC value at entry.                             |
| `currentValue`       | `number`          | Current USDC value.                              |
| `cashPnl`            | `number`          | Unrealised cash PnL.                             |
| `percentPnl`         | `number`          | Unrealised PnL as a percentage.                  |
| `totalBought`        | `number`          | Total USDC spent buying this position.           |
| `realizedPnl`        | `number`          | Realised PnL from partial closes.                |
| `percentRealizedPnl` | `number`          | Realised PnL as a percentage.                    |
| `curPrice`           | `number`          | Current mid price.                               |
| `redeemable`         | `boolean`         | Whether the position can be redeemed.            |
| `mergeable`          | `boolean`         | Whether the position can be merged.              |
| `title`              | `string`          | Market title.                                    |
| `slug`               | `string`          | Market slug.                                     |
| `outcome`            | `string`          | Outcome label for this position.                 |
| `outcomeIndex`       | `number`          | Outcome index.                                   |
| `oppositeOutcome`    | `string`          | The other outcome label.                         |
| `oppositeAsset`      | `string`          | CLOB token ID for the opposite outcome.          |
| `endDate`            | `string \| null`  | Market end date.                                 |
| `negativeRisk`       | `boolean \| null` | Whether the market uses negative-risk mechanics. |

---

### `fetchRedeemablePositions`

```typescript
fetchRedeemablePositions(user: string): Promise<Position[]>
```

Convenience wrapper. Calls `fetchPositions` with `redeemable: true` and `limit: 1000`.

---

### `fetchAllPositions`

```typescript
fetchAllPositions(user: string, limit?: number): Promise<Position[]>
```

Returns all positions for the user without filters. Default `limit` is `1000`.

---

### `fetchPortfolioValue`

```typescript
fetchPortfolioValue(user: string): Promise<number>
```

Returns the total current value of all open positions in USDC. Returns `0` on HTTP error or unexpected response format.

---

### `fetchClosedPositions`

```typescript
fetchClosedPositions(query: FetchClosedPositionsOptions): Promise<ClosedPosition[]>
```

Fetches resolved (historical) positions for a user.

```typescript
type FetchClosedPositionsOptions = {
  user: string
  limit?: number
  offset?: number
  sortBy?: 'RESOLVED_AT' | 'REALIZED_PNL'
  sortDirection?: 'ASC' | 'DESC'
}
```

Returns an empty array when the API responds with HTTP 404 (no closed positions).

**Notable `ClosedPosition` fields:**

| Field                | Type     | Description                               |
| -------------------- | -------- | ----------------------------------------- |
| `conditionId`        | `string` | On-chain condition ID.                    |
| `realizedPnl`        | `number` | Net realised PnL for the closed position. |
| `percentRealizedPnl` | `number` | Realised PnL as a percentage.             |
| `resolvedAt`         | `string` | ISO timestamp of market resolution.       |
| `winningOutcome`     | `string` | The outcome that resolved to 1.           |

---

### `fetchActivity`

```typescript
fetchActivity(query: FetchActivityOptions): Promise<Activity[]>
```

Fetches the full activity history for a user: trades, splits, merges, redeems, rewards, conversions, and maker rebates.

```typescript
type FetchActivityOptions = {
  user: string
  limit?: number
  offset?: number
  type?: ActivityType | ActivityType[]
  market?: string // conditionId (comma-separated)
  start?: number // unix timestamp
  end?: number // unix timestamp
  sortBy?: 'TIMESTAMP' | 'TOKENS' | 'CASH'
  sortDirection?: 'ASC' | 'DESC'
  side?: 'BUY' | 'SELL'
}

type ActivityType =
  | 'TRADE'
  | 'SPLIT'
  | 'MERGE'
  | 'REDEEM'
  | 'REWARD'
  | 'CONVERSION'
  | 'MAKER_REBATE'
```

**`Activity` fields:**

| Field             | Type                           | Description                      |
| ----------------- | ------------------------------ | -------------------------------- |
| `proxyWallet`     | `string`                       | Polymarket proxy wallet address. |
| `timestamp`       | `number`                       | Unix timestamp of the activity.  |
| `conditionId`     | `string`                       | Market condition ID.             |
| `type`            | `ActivityType`                 | Activity type.                   |
| `size`            | `number`                       | Number of shares involved.       |
| `usdcSize`        | `number`                       | USDC amount involved.            |
| `price`           | `number \| undefined`          | Trade price (for `TRADE` type).  |
| `side`            | `'BUY' \| 'SELL' \| undefined` | Trade side (for `TRADE` type).   |
| `asset`           | `string \| undefined`          | CLOB token ID.                   |
| `transactionHash` | `string \| undefined`          | On-chain transaction hash.       |
| `slug`            | `string \| undefined`          | Market slug.                     |
| `outcome`         | `string \| undefined`          | Outcome label.                   |

Returns an empty array when the API responds with HTTP 404.
