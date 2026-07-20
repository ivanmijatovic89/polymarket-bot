# Data Coverage — Single Source of Truth

One place for **"from when does each dataset / field exist"**, organized by
source. Only stable epoch boundaries live here (dates that never change once
discovered) — no sync high-water marks or row counts, those go stale.

> Conventions: all dates UTC. Boundaries marked ~ were measured empirically by
> probing the source (method noted). Official = stated in the source's docs.

## Polymarket

| fact | value | how known |
|---|---|---|
| First 15m up/down markets (btc, eth) | **2025-10-11** | earliest catalog entries; matches Telonex's official coverage start, so the series may predate it |
| First 15m up/down markets (sol, xrp) | **2025-10-27** | earliest catalog entries |
| First 5m up/down markets (btc) | **2026-02-12** | earliest catalog entries |
| First 5m up/down markets (eth, sol, xrp) | **2026-02-18** | earliest catalog entries |
| 1h / 4h / 1d series | **unknown** | not in the Telonex catalog (0 rows) — TODO: confirm whether Telonex carries them or our sync filters them |
| Resolution source | Chainlink Data Streams (not Binance, not on-chain `getRoundData`) | official docs + resolution endpoint |
| RTDS WS (`crypto_prices_chainlink` topic) | live Chainlink ticks; a sponsored Chainlink API key exists for 15m-market traders | official docs |

## Telonex

Official ([telonex.io/docs/exchanges/polymarket](https://telonex.io/docs/exchanges/polymarket)):

| channel | coverage from | notes |
|---|---|---|
| Off-chain (`trades`, `quotes`, `book_snapshot_5/25/full`) | **2025-10-11** | event-driven, not interval-sampled |
| `onchain_fills` / `all_onchain_fills` | **market inception** | |
| `crypto_prices` (Chainlink oracle ticks) | **2026-04-02** | per-symbol `asset_id` (e.g. `btcusd`); NOT synced by us yet (needs subscription — Task 2) |

- **Reliability boundary**: Telonex states coverage **before 2026-01-19 may
  contain occasional gaps**; 2026-01-19 onward is the most reliable window.
  (Our `TELONEX_DATASET_ELIGIBLE_FROM=2025-11-30` floor predates this — keep in
  mind for pre-January backtests.)
- Updated daily within hours of midnight UTC.
- Availability per asset/slug can be queried live: `GET /v1/availability/polymarket?slug=…`.

## Gamma API

Measured 2026-07-20 from the **complete backfill** of all 179,285 cataloged
markets (`telonex:sync-pricetobeat-and-final-price`; per-market ground truth,
supersedes the earlier probe estimates):

### `events[].eventMetadata.priceToBeat` (Chainlink open/strike)

| series | exists from |
|---|---|
| 15m btc / eth / sol / xrp | **2026-02-18 23:45 UTC** |
| 5m btc | **2026-02-19 00:05 UTC** |
| 5m eth / sol / xrp | **2026-03-18 23:00 UTC** (a month later!) |

- `eventMetadata: null` before those dates — Polymarket did **not** backfill.
- **Holes after full rollout** (~1.7k markets, symbol-symmetric ⇒ platform-side
  writer outages, not fetch errors): Mar 23 (72), **Apr 1 (708)**, Apr 24 (44),
  May 3–4 (628), May 20 (16), May 22 (153), Jun 2 (17), Jun 16 (3),
  Jul 5–6 (21). Clean otherwise. Re-verified 2026-07-20: a random 20-market
  sample re-fetched from Gamma still returns empty metadata — these are
  permanent platform-side gaps, not transient fetch errors.
- **Backtest policy**: markets before their SERIES' epoch (recording not yet
  started) replay with an absent key, quietly; post-epoch markets with no
  strike **hard-error** in strike-requesting backtests (exclude those windows
  from batches — the data does not exist anywhere).

### `events[].eventMetadata.finalPrice` (Chainlink settle)

Present from the same 2026-02-18/19 start, then **patchy/absent roughly
Feb 24 → Mar 21**, consistent after **~2026-03-21 ~15:00 UTC**. Net effect:
~22.6k markets have a strike but no settle (concentrated in that gap).

### Documentation status (investigated 2026-07-20, exhaustively)

- The `eventMetadata` **container** is official: in Gamma's OpenAPI spec
  (`gamma-api.polymarket.com/openapi.json`, `Event.eventMetadata`) and typed in
  the v2 SDKs since their launch (`Polymarket/ts-sdk` created **2026-04-02** —
  the April "v2 wave"; same day Telonex's `crypto_prices` coverage begins).
- The **contents** (`priceToBeat`, `finalPrice`) are typed as
  `record<string, unknown>` and are documented **nowhere** — not on
  docs.polymarket.com (full-text checked), not in the OpenAPI spec, not in
  either SDK. The dates above exist only in our measurements.
- This is the only bulk-history source for priceToBeat found (the
  resolution endpoint serves ~30 days).

## Binance aggTrades (data.binance.vision)

| fact | value |
|---|---|
| Source coverage | years back (per spot pair, since listing) |
| Daily-dump timestamp unit | **microseconds since 2025-01-01** (was ms before; normalized to ms at convert — proven equal to WS `T`) |
| Publication lag | ~1 day |
| Our sync floor | `TELONEX_DATASET_ELIGIBLE_FROM − 1 day` (= 2025-11-29), daily `--sync` cron |

## Repo-side knobs tied to these dates

| item | value |
|---|---|
| `TELONEX_DATASET_ELIGIBLE_FROM` | 2025-11-30 (env; lower bound of the eligible backtest universe) |
| `BACKTEST_BINANCE_FEED_LATENCY_MS` | 110 (measured p50 on the trading machine, 2026-07-16) |

## TODO / unknown boundaries (fill in when discovered)

- **"Orderbook v2"** — from when the v2 orderbook applies: owner note needed on
  what "v2" refers to (PMXT master v2? a Polymarket WS format change?).
- 1h / 4h / 1d up/down series start dates on Polymarket.
- Whether 15m markets existed before 2025-10-11 (Telonex coverage start could
  be masking earlier Polymarket history).
