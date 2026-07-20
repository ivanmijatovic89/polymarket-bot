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
| `polymarket.com/api/crypto/crypto-price` endpoint | authoritative open/close, but **only ~last 30 days** | measured |
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

Measured 2026-07-20 by probing `gamma-api.polymarket.com/markets?slug=…&closed=true`
(binary search over 15m BTC slugs; spot-confirmed on 5m and eth/sol):

| field | exists from | notes |
|---|---|---|
| `events[].eventMetadata.priceToBeat` | **~2026-02-19** (between 02-18 20:00 and 02-19 04:00) | the Chainlink open/strike of the window; `eventMetadata: null` before — **no backfill** |
| `events[].eventMetadata.finalPrice` | **~2026-03-21** (between 12:00 and 18:00) | the Chainlink settle price — free resolution cross-check |

This is the only bulk-history source for priceToBeat found (the
`crypto-price` endpoint is capped at ~30 days).

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
