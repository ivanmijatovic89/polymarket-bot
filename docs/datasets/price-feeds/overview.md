# Backtest Price Feeds: Chainlink + Binance — Source Decision

This document records the source-of-truth decision for making the **Chainlink**
and **Binance** price feeds available in **backtests**, so strategies can read
`ctx.plugins.externalFeeds.*` in replay exactly as they do live.

Everything below was **measured against the live APIs**, not taken from vendor
marketing. Each claim carries its evidence.

> Note: this is a cross-cutting concern. The recommended Chainlink source is the
> **Telonex** `crypto_prices` channel, even though the price-feeds pipeline
> is otherwise Telonex-independent. It is filed here because the feeds serve
> backtests of these crypto up/down markets; the data source is orthogonal to
> which analytics pipeline consumes it.

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

- **Binance → IMPLEMENTED** (strategy-driven: declaring
  `ExternalFeedsRequestPlugin` with a `binanceWsSpotPrice` request enables the
  feed in backtests automatically, like live): downloader, backtest as-of
  provider, live recorder + verification harness. See
  [Binance aggTrades Feed](./binance/feed.md).
- **priceToBeat → IMPLEMENTED** (strategy-driven via
  `polymarketPriceToBeat: { enabled: true }`): the Chainlink open/strike per
  market, backfilled from Gamma `events[].eventMetadata` into
  `telonex_markets.price_to_beat` by
  `npm run telonex:sync-pricetobeat-and-final-price` (run it after
  `telonex:sync`). Replay models the live availability lag: the key appears
  **~2.7s after window start by default** (`BACKTEST_PRICE_TO_BEAT_LATENCY_MS`,
  measured p50 by the feeds:parity harness — p90 3.5s, max 5.4s;
  live the endpoint publishes the open price ~10–60s late — the live client
  logs the real lag on every resolve, re-tune the default from those logs).
  Markets before their series' recording epoch (per-series dates in
  [Data Coverage](../data-coverage.md)) get an absent key, as do markets
  settled <30h ago (pipeline-lag grace: Telonex catalogs daily and the
  backfill waits 3h after settle — warned, not errored, so record-today /
  backtest-tonight keeps working); other post-epoch markets without backfill —
  or inside a verified Polymarket-side hole — hard-error. If a hard error
  turns out to be a transiently-empty Gamma answer that got stamped as
  permanent, re-fetch with
  `npm run telonex:sync-pricetobeat-and-final-price -- --refetch-nulls`.
  `final_price` (Chainlink settle) is captured in
  the same pass for future resolution cross-checks.
- **Chainlink via Telonex `crypto_prices` → IMPLEMENTED** (strategy-driven via
  `rtdsCryptoPrices` in the request plugin; explicit `chainlinkSymbols` or
  slug-derived): dataset pipeline (download `--sync` → R2 mirror → worker
  pull), two-clock as-of provider (visibility on Polymarket's broadcast time
  ~1s after the round time + measured bot leg; emitted `tsMs` = round time,
  live parity), RTDS recorder + verification harness, and a resolution
  replication check — deriving UP/DOWN from the series reproduces actual
  market outcomes at **99.80%** with bit-exact strike matches. Hard-error
  policy everywhere the feed is requested and unavailable (including
  pre-2026-04-02 markets — it is the resolution price). See
  [Chainlink crypto_prices Feed](./chainlink/feed.md).
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

## Open items before implementation

1. **One authenticated `crypto_prices` pull** to lock the exact column names
   (`llms.txt` gives the three timestamps and the coin list, but not the final
   `price`/`symbol`/`source` spelling).
2. Confirm the existing Telonex plan is the Polymarket one (it must be — the
   `book_snapshot_full` sync already works through it).

## Sources

- Telonex docs: `https://telonex.io/llms.txt`, `https://telonex.io/docs/exchanges/polymarket`, `https://telonex.io/docs/schemas/crypto-prices`
- Binance public data: `https://github.com/binance/binance-public-data`, `https://data.binance.vision/`
- Polymarket resolution endpoint: `https://polymarket.com/api/crypto/crypto-price`
- Chainlink ↔ Polymarket resolution: Chainlink Data Streams power Polymarket's fast crypto settlement (Chainlink / Polymarket announcements)
