---
title: Price Feeds — Overview & Source Decision
description: The source-of-truth decision record for the backtest price feeds (Chainlink, Binance, price to beat), with implementation status and links to the per-feed pages.
---

# Price Feeds: Overview & Source Decision

This document records the source-of-truth decision for making the **Chainlink**
and **Binance** price feeds available in **backtests**, so strategies can read
`ctx.plugins.externalFeeds.*` in replay exactly as they do live. A third feed,
**price to beat** (the per-market Chainlink open/strike from Gamma), joined
later and is covered in [Status](#status) with its own page.

Everything below was **measured against the live APIs**, not taken from vendor
marketing. Each claim carries its evidence.

::: tip Cross-cutting concern
The recommended Chainlink source is the **Telonex** `crypto_prices` channel,
even though the price-feeds pipeline is otherwise Telonex-independent. It is
filed here because the feeds serve backtests of these crypto up/down markets;
the data source is orthogonal to which analytics pipeline consumes it.
:::

## The problem

Live trading exposes two external price feeds to strategies via
`ctx.plugins.externalFeeds` (see `src/trading/feeds/README.md`):

- `rtdsPolymarketCryptoPrices.chainlink` / `.binance` — Polymarket RTDS crypto prices
- `binanceWsSpotPrice` — direct Binance spot (aggTrade last price)

These are **live-only**. Backtests register no external-feeds plugin, so any
strategy that gates on them behaves differently in replay. We want the same
feeds, point-in-time-accurate, during backtests.

## The accuracy insight that drives everything

Polymarket's 15m/1h crypto up/down markets are **resolved by Chainlink Data
Streams** — not by Binance, and not by the classic on-chain Chainlink
price-feed aggregators (`getRoundData`, which update only on heartbeat/deviation
and would not match). Binance is only a *correlated secondary signal*.

Resolution is decided by tiny Chainlink open-vs-close gaps. Measured example from
Polymarket's own resolution endpoint (a past BTC window):

```
GET https://polymarket.com/api/crypto/crypto-price?symbol=btc&eventStartTime=...&variant=fifteen&endDate=...
→ {"openPrice":64677.399715,"closePrice":64668.890492,"completed":true}
```

An **~$8** open→close move flips UP↔DOWN. Therefore **Binance cannot be used to
infer resolution** — only to compute signals. The Chainlink series is mandatory
for anything resolution-aware.

## Decision

| Feed | Source | Cost | Accuracy | Coverage |
|------|--------|------|----------|----------|
| **Chainlink** | Telonex **`crypto_prices`** channel | Included in existing Telonex Polymarket plan | 100% — it *is* the resolution feed | **From 2026-04-02**, daily updates |
| **Binance** | `data.binance.vision` public dumps (aggTrades) | Free, no auth | 100% — same aggTrade stream as live | Years |

### Chainlink → Telonex `crypto_prices`

Per Telonex's own docs (`https://telonex.io/llms.txt`):

> **Crypto Prices**: Chainlink oracle price feeds (BTC, ETH, SOL, XRP, BNB, DOGE,
> HYPE) broadcast by Polymarket's real-time data service — the exact ticks
> Polymarket uses to resolve crypto-prediction markets, with source
> (`timestamp_us`), server-emit (`server_timestamp_us`) and collector-receive
> (`local_timestamp_us`) timestamps. Available from 2026-04-02.

- It is a **Polymarket channel**, so it is covered by the existing Telonex
  Polymarket plan (`TELONEX_API_KEY`) at no extra cost — the repo already pulls
  Polymarket `book_snapshot_full` through the same account. (Telonex pricing:
  Single Exchange $99/mo, Pro $199/mo.)
- Download route (same base as the existing sync,
  `src/telonex/download-raw-files.ts`):
  `https://api.telonex.io/v1/downloads/polymarket/crypto_prices/{date}` —
  confirmed live (`401 {"detail":"Invalid or missing API key"}` without a key).
- Microsecond timestamps are ideal for a point-in-time as-of join in backtests.
- **Hard limit:** nothing anywhere covers Chainlink before **2026-04-02**.
  Pre-April backtests cannot have this feed.

### Binance → data.binance.vision (aggTrades)

The live `binanceWsSpotPrice` feed
(`src/trading/feeds/binanceWsSpotPriceClient.ts`)
uses the `aggTrade` last-trade price. The public **aggTrades dumps are the same
event stream**, so they reproduce the live feed exactly. Verified reachable:

```
HEAD https://data.binance.vision/data/spot/daily/aggTrades/BTCUSDT/BTCUSDT-aggTrades-2025-05-01.zip → 200 (~14 MB/day, with .CHECKSUM)
```

1s klines (`.../klines/BTCUSDT/1s/...`, ~78 MB/month) are a leaner ~99.9%
alternative, but **aggTrades is the chosen granularity** for exactness. Telonex
also sells a separate Binance exchange dataset (Pro $199/mo) — unnecessary, the
public dumps are free and identical.

## Alternatives evaluated and rejected

| Option | Verdict | Why |
|--------|---------|-----|
| Chainlink Data Streams REST/Candlestick API | ✗ | Gated/enterprise access ("contact Chainlink"), HMAC auth — not self-serve. |
| Polymarket `crypto-price` endpoint | ⚠ partial | Authoritative open/close, but **only last 30 days** (`symbol=btc` lowercase). Best used to *certify* a live recording within 30 days, not for bulk history. |
| PMData (pmdata.dev) | ✗ | Chainlink is paywalled on **Plus $49/mo**; free tier excludes it. |
| HuggingFace `aliplayer1/polymarket-crypto-updown` (+ forks) | ⚠ fixture only | Real Chainlink (`source: chainlink`), but only **~1 stale month** (2026-03-26 → 04-26), MIT. Usable as a build/test fixture; no ongoing coverage. |
| HuggingFace `MAICHEN/*` (btc1h, BTC-15min, …) | ✗ | Gated (manual approval); Chainlink presence unverifiable without access. |
| Telonex Binance dataset | ✗ (redundant) | $199 Pro; `data.binance.vision` is free and identical. |
| On-chain Chainlink aggregators (`getRoundData`) | ✗ | Wrong product — heartbeat/deviation feed, does not match Data Streams resolution. |

## Status

All three feeds are **IMPLEMENTED** and strategy-driven (declared via
`ExternalFeedsRequestPlugin`; backtests fulfill them automatically, like
live). The details below live on the per-feed pages:

- **Binance** (`binanceWsSpotPrice`) — downloader, backtest as-of provider,
  live recorder + verification harness. See
  [Binance aggTrades: Feed](./binance/feed.md).
- **priceToBeat** (`polymarketPriceToBeat`) — the Chainlink open/strike per
  market, backfilled from Gamma into `telonex_markets.price_to_beat`, replayed
  with the measured availability lag. See
  [Price to Beat](./price-to-beat.md).
- **Chainlink** (`rtdsCryptoPrices`) — Telonex `crypto_prices` pipeline,
  two-clock as-of provider, RTDS recorder + verification harness; resolution
  replication reproduces actual outcomes at 99.80%. Hard-error policy wherever
  requested and unavailable — it is the resolution price. See
  [Chainlink crypto_prices: Feed](./chainlink/feed.md).
  `rtdsPolymarketCryptoPrices.binance` remains live-only (the channel carries
  only the chainlink stream — use `binanceWsSpotPrice`).

## Integration approach (original design sketch — implemented for Binance)

- Add a **backtest-side variant of**
  `ExternalFeedsPlugin` (`src/strategy/plugins/ExternalFeedsPlugin.ts`)
  that does an **as-of lookup**: value at-or-before `tick.snapshot.timestamp`,
  **never after** (no lookahead). It returns the identical
  `ExternalFeedsSnapshot` shape
  (`src/trading/feeds/externalFeeds.ts`), so
  strategies read `ctx.plugins.externalFeeds` the same way live and in replay.
- Backtests build the runner in
  `src/backtest/runSingleMarket.ts` and currently
  register no external feeds; this is where the plugin would be wired.
- Per-window historical series (Chainlink from Telonex, Binance from
  data.binance.vision) load into a timestamp-indexed structure once per episode.

### Plumbing wrinkle for the Telonex fetch

`crypto_prices` is a **per-symbol** price series, not per outcome-token. The
existing raw-file downloader expands `(date, asset_id)` candidates and
`telonex_markets` carries `*_from/_to` ranges for the *other* channels but **not**
`crypto_prices`. So the fetch is keyed differently from the `book_snapshot_full`
path — small additions, not a blocker.

## Open items before implementation — all RESOLVED

Kept as part of the decision record; both were closed by the `crypto_prices`
implementation:

1. ~~**One authenticated `crypto_prices` pull** to lock the exact column names~~
   — done; the schema is documented in
   [Chainlink crypto_prices: Feed](./chainlink/feed.md).
2. ~~Confirm the existing Telonex plan is the Polymarket one~~ — confirmed; the
   full pipeline runs through the existing `TELONEX_API_KEY`.

## Sources

- Telonex docs: `https://telonex.io/llms.txt`, `https://telonex.io/docs/exchanges/polymarket`, `https://telonex.io/docs/schemas/crypto-prices`
- Binance public data: `https://github.com/binance/binance-public-data`, `https://data.binance.vision/`
- Polymarket resolution endpoint: `https://polymarket.com/api/crypto/crypto-price`
- Chainlink ↔ Polymarket resolution: Chainlink Data Streams power Polymarket's fast crypto settlement (Chainlink / Polymarket announcements)
