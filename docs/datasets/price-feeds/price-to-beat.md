---
title: Price to Beat Feed
description: How backtests fulfill the polymarketPriceToBeat feed from telonex_markets.price_to_beat — the Gamma backfill, the availability-lag model, and the missing-data policy.
---

# Price to Beat Feed for Backtests

The "price to beat" is the Chainlink open/strike price a crypto up/down market
must beat to resolve UP. Live, the bot fetches it per market from the Gamma
API; in backtests the same value is served from the database with a measured
availability lag, so strategies see it at the same point in the window as they
would live.

**Source:** Gamma API `events[].eventMetadata.priceToBeat`, backfilled into
`telonex_markets.price_to_beat`.
Source decision and sibling feeds: [Overview & Source Decision](/datasets/price-feeds/overview).
Per-series coverage epochs and verified holes: [Data Coverage](/datasets/data-coverage).

## Usage

The feed is strategy-driven, like every external feed: declare it in the
strategy's `ExternalFeedsRequestPlugin` and both live trading and backtests
fulfill it automatically. No CLI flag is involved.

```typescript
requiredFeeds: {
  polymarketPriceToBeat: { enabled: true },
}
```

Strategies read it from the tick-scoped snapshot:

```typescript
const ptb = ctx.plugins.externalFeeds?.polymarketPriceToBeat
// { symbol, eventStartTimeIso, endDateIso, openPrice, apiTimestampMs?, receivedAtMs }
```

Field reference: [External Feeds Plugin](/plugins/plugin-external-feeds#polymarketpricetobeat).

## How it works

1. `npm run telonex:sync` catalogs markets into `telonex_markets`.
2. `npm run telonex:sync-pricetobeat-and-final-price` (run it after
   `telonex:sync`) fetches Gamma `events[].eventMetadata` per market and
   stores `price_to_beat`. The Chainlink settle price (`final_price`) is
   captured in the same pass for future resolution cross-checks.
3. During replay, the backtest provider serves the stored strike for the
   traded market — but not immediately: the key appears **~2.7&nbsp;s after
   window start** by default, modeling when the value becomes visible live.

The 2.7&nbsp;s default is the live p50 measured by the
[Parity Harness](/datasets/price-feeds/parity-harness) (p90 3.5&nbsp;s, max
5.4&nbsp;s; 2026-07-21). Live, the Gamma endpoint publishes the open price
~10–60&nbsp;s late and the live client logs the real lag on every resolve —
re-tune the default from those logs when the harness is re-run.

## Availability & missing-data policy

| Market situation | Replay behavior |
| --- | --- |
| Before the series' recording epoch | Key absent, quiet — Polymarket never backfilled these. |
| Settled less than 30&nbsp;h ago | Key absent, **warned** — pipeline-lag grace (Telonex catalogs daily; the backfill waits 3&nbsp;h after settle), so record-today / backtest-tonight keeps working. |
| Post-epoch, no strike backfilled, or inside a verified Polymarket-side hole | **Hard error** — the data does not exist anywhere; exclude those windows from batches. |

Per-series epochs (15m series start 2026-02-18 23:45 UTC; 5m and 1h later)
and the full verified-hole list (~1.36% of markets since Apr 2026,
platform-side outages) live in [Data Coverage](/datasets/data-coverage) — the
single source of truth. The epochs are carried in code by
`gammaPriceToBeatEpochMs`.

::: tip Recovering a suspicious hard error
All post-2026-03-21 null strikes were re-fetched exhaustively on 2026-07-21
and confirmed permanent. But if a new hard error is suspected to be a
transiently-empty Gamma answer that got stamped as permanent, re-fetch just
the nulls:

```bash
npm run telonex:sync-pricetobeat-and-final-price -- --refetch-nulls
```

:::

## Env vars

| Variable | Default | Meaning |
| --- | --- | --- |
| `BACKTEST_PRICE_TO_BEAT_LATENCY_MS` | `2700` | Delay after window start before the key becomes visible in replay (measured live p50). |

## Gotchas

- **The API fields are documented nowhere.** The `eventMetadata` container is
  in Gamma's OpenAPI spec, but `priceToBeat` / `finalPrice` are typed
  `record<string, unknown>` and undocumented — the coverage dates exist only
  in our measurements. This backfill is the only bulk-history source found
  (the resolution endpoint serves ~30 days).
- **`final_price` has its own gap**: patchy/absent roughly Feb 24 → Mar 21,
  2026 — ~22.6k markets have a strike but no settle. Consistent after
  ~2026-03-21 15:00 UTC.
- **Run the backfill after every catalog sync.** A market present in
  `telonex_markets` but never visited by the backfill replays as a hard error
  in strike-requesting backtests, even though the strike exists on Gamma.
