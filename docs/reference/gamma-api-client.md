---
title: Gamma API Client
description: Reference for the Gamma REST API client functions used to fetch market metadata and map it to the database schema.
---

# Gamma API Client

The Gamma API client is split across two source files:

- **`src/polymarket/gamma.ts`** — HTTP fetch functions and the mapping from raw API responses to the `markets` database table format.
- **`src/polymarket/gammaMarketMeta.ts`** — The `GammaMarketMeta` type and the `buildGammaMarketMeta` builder used at runtime by the trading bot and backtest engine.

The base URL is controlled by the `GAMMA_API_BASE_URL` environment variable (default: `https://gamma-api.polymarket.com`).

---

## Functions

### `fetchGammaMarketBySlug`

```typescript
fetchGammaMarketBySlug(args: {
  slug: string
}): Promise<Record<string, unknown> | null>
```

Fetches a single market from the Gamma REST API by its slug string.

**Behaviour:**

1. Requests `GET /markets?slug=<encoded-slug>`. Returns the first element of the response array.
2. If the market is not found (empty array), retries with `GET /markets?slug=<encoded-slug>&closed=true` to handle historical markets that are only returned when the `closed=true` filter is explicitly set.
3. Returns `null` if neither request finds a match.
4. Throws `Error` on non-2xx HTTP responses.

::: tip Historical slugs
Some resolved markets are omitted from the default `/markets` endpoint. The two-phase fetch (open then closed) is necessary to handle backtesting against older Parquet recordings.
:::

---

### `fetchGammaMarketBySlugAndMapApiResponseToMarketTable`

```typescript
fetchGammaMarketBySlugAndMapApiResponseToMarketTable(args: {
  slug: string
  filePath: string
  symbol: string
}): Promise<MarketDataForTable | null>
```

Combines `fetchGammaMarketBySlug` and `mapApiResponseToMarket` in a single call. Returns `null` on any error (network failure, mapping failure, or market not found). Used by the seed-from-parquet script and the recorder when `RECORD_LIVE_INSERT_DB=true`.

---

### `mapApiResponseToMarket`

```typescript
mapApiResponseToMarket(
  raw: Record<string, unknown>,
  slug: string,
  filePath: string,
  symbol: string
): MarketDataForTable | null
```

Maps a raw Gamma API response object to the `MarketDataForTable` shape required for inserting into the `markets` database table.

Returns `null` when required fields are absent:

| Check          | Condition                                             |
| -------------- | ----------------------------------------------------- |
| `polymarketId` | `raw.id` must be a non-empty string                   |
| `question`     | `raw.question` must be a non-empty string             |
| `outcomes`     | Parsed outcome array must contain at least one string |

**Field mapping:**

| Database column         | Gamma API field           | Transformation                                              |
| ----------------------- | ------------------------- | ----------------------------------------------------------- |
| `polymarket_id`         | `raw.id`                  | Cast to string                                              |
| `slug`                  | argument                  | Passed through                                              |
| `symbol`                | argument                  | Passed through (lowercased by caller)                       |
| `dataset`               | `filePath` argument       | Converted to a path relative to `process.cwd()`             |
| `question`              | `raw.question`            | Cast to string                                              |
| `condition_id`          | `raw.conditionId`         | Cast to string or `null`                                    |
| `outcomes`              | `raw.outcomes`            | JSON-parsed from string; filtered to string elements        |
| `outcome_prices`        | `raw.outcomePrices`       | JSON-parsed; normalised to uniform `number[]` or `string[]` |
| `resolved_outcome`      | derived                   | Outcome label whose price equals `1`; `null` if none        |
| `end_date`              | `raw.endDate`             | Parsed to `Date`                                            |
| `start_date`            | `raw.startDate`           | Parsed to `Date`                                            |
| `start_date_iso`        | `raw.startDate`           | Raw string preserved verbatim                               |
| `uma_resolution_status` | `raw.umaResolutionStatus` | Cast to string or `null`                                    |
| `clob_token_ids`        | `raw.clobTokenIds`        | JSON-parsed from string; filtered to string elements        |
| `active`                | `raw.active`              | Boolean, defaults to `false`                                |
| `closed`                | `raw.closed`              | Boolean, defaults to `false`                                |
| `volume`                | `raw.volume`              | Coerced to string or `null`                                 |
| `raw_json`              | `raw`                     | Entire response object stored verbatim                      |

**Resolved outcome detection:**

The `resolved_outcome` column is derived by scanning `outcomePrices` for an entry equal to `1`. The corresponding element at the same index in `outcomes` is returned. Returns `null` when arrays have mismatched lengths or no price equals `1`.

---

## `MarketDataForTable` Type

```typescript
type MarketDataForTable = {
  polymarketId: string
  slug: string
  symbol: string
  dataset: string | null
  question: string
  conditionId: string | null
  outcomes: string[]
  outcomePrices: string[] | number[] | null
  resolvedOutcome: string | null
  endDate: Date | null
  startDate: Date | null
  startDateIso: string | null
  umaResolutionStatus: string | null
  umaResolutionStatuses: unknown | null
  clobTokenIds: string[] | null
  active: boolean
  closed: boolean
  volume: string | null
  rawJson: Record<string, unknown>
}
```

This type is compatible with the Drizzle `markets` table insert type and is accepted by `insertMarket` in `src/db/markets.ts`.

---

## `GammaMarketMeta` Type

```typescript
type GammaMarketMeta = Record<string, unknown> & {
  slug: string
  outcomes: string[]
  clobTokenIds: string[]
  outcomeTokenMap: Record<string, string> // lowercased outcome → tokenId
  upAssetId: string | null
  downAssetId: string | null
  question?: string
}
```

`GammaMarketMeta` extends the raw API payload with pre-parsed, convenience fields used by the trading engine at runtime.

| Field             | Description                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `slug`            | Market slug.                                                                                      |
| `outcomes`        | Parsed string array of outcome labels.                                                            |
| `clobTokenIds`    | Parsed string array of CLOB token IDs, in the same order as `outcomes`.                           |
| `outcomeTokenMap` | Map from lowercased outcome label to its CLOB token ID.                                           |
| `upAssetId`       | Token ID of the outcome whose label contains `"up"` (case-insensitive). `null` if not detected.   |
| `downAssetId`     | Token ID of the outcome whose label contains `"down"` (case-insensitive). `null` if not detected. |
| `question`        | Market question text, if present in the raw payload.                                              |

---

### `buildGammaMarketMeta`

```typescript
buildGammaMarketMeta(
  raw: Record<string, unknown>,
  slug: string
): GammaMarketMeta | null
```

Constructs a `GammaMarketMeta` from a raw Gamma API payload or from the `raw_json` column of the `markets` table (enabling construction without a network call).

Returns `null` when:

| Condition                                  | Description                    |
| ------------------------------------------ | ------------------------------ |
| Fewer than 2 string outcomes after parsing | Not a valid binary market.     |
| Fewer than 2 CLOB token IDs after parsing  | Cannot map outcomes to assets. |

`outcomes` and `clobTokenIds` in Gamma API responses are JSON-encoded strings (e.g. `'["Up","Down"]'`). `buildGammaMarketMeta` parses these internally.

**Up/Down detection** scans `outcomes` left-to-right:

- `upAssetId` is set to the token ID of the first outcome label containing the substring `"up"`.
- `downAssetId` is set to the token ID of the first outcome label containing the substring `"down"`.

Both are `null` for markets whose outcome labels do not follow the `Up/Down` naming convention.

---

## Rate Limits

The Gamma API does not publish a formal rate limit. The client performs one HTTP request per market fetch (or two for historical markets). No request throttling or retry logic is implemented at the client layer; callers are responsible for avoiding excessive request rates.

::: warning Closed market fallback
The secondary `?closed=true` request is only made when the primary request returns an empty array. It does not indicate an error condition and is a normal part of the fetch flow for resolved markets.
:::
