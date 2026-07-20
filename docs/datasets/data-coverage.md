# Data Coverage — Single Source of Truth

One place for **"from when does each dataset / field exist"**, organized by
source. Only stable epoch boundaries live here (dates that never change once
discovered) — no sync high-water marks or row counts, those go stale.

> Conventions: all dates UTC. Boundaries marked ~ were measured empirically by
> probing the source (method noted). Official = stated in the source's docs.

## Polymarket

### MASTER TABLE — per symbol & timeframe, from when do I have each dataset

| series | markets exist from | Telonex orderbook (our catalog) from | priceToBeat from | Binance spot feed from |
|---|---|---|---|---|
| **15m btc** | 2025-10-11 (series birth, Gamma-verified) | 2025-10-11 (backtest floor: 2025-11-30) | **2026-02-18 23:45** | 2025-11-29 (BTCUSDT synced daily) |
| **15m eth** | 2025-10-11 | 2025-10-11 (floor 2025-11-30) | **2026-02-18 23:45** | not downloaded yet (one command) |
| **15m sol** | 2025-10-27 | 2025-10-27 (floor 2025-11-30) | **2026-02-18 23:45** | not downloaded yet |
| **15m xrp** | 2025-10-27 | 2025-10-27 (floor 2025-11-30) | **2026-02-18 23:45** | not downloaded yet |
| **5m btc** | 2026-02-12 | 2026-02-12 | **2026-02-19 00:05** | 2025-11-29 |
| **5m eth** | 2026-02-18 | 2026-02-18 | **2026-03-18 23:00** | not downloaded yet |
| **5m sol** | 2026-02-18 | 2026-02-18 | **2026-03-18 23:00** | not downloaded yet |
| **5m xrp** | 2026-02-18 | 2026-02-18 | **2026-03-18 23:00** | not downloaded yet |
| 1h btc ("hourly") | 2025-05-28 | ✗ not in catalog (our sync filter) | ~2026-03-18/19 (measured) | n/a until cataloged |
| 4h btc | 2025-10-14 | ✗ not in catalog | spot-checked ≥ late Mar 2026 | n/a until cataloged |
| 1d btc ("daily") | 2025-03-15 | ✗ not in catalog | spot-checked ≥ late Mar 2026 | n/a until cataloged |

Reading guide: "Telonex orderbook from" = when our backtest catalog has the
market (series birth, since Telonex coverage starts 2025-10-11 and every synced
series was born on/after that); the env floor `TELONEX_DATASET_ELIGIBLE_FROM`
(2025-11-30) additionally bounds the *eligible backtest universe*. Chainlink
feed (Task 2) will add a column when built — Telonex `crypto_prices` exists
from 2026-04-02 for all symbols.

### Up/down market series details

| series | market slug format | notes |
|---|---|---|
| 5m / 15m (all symbols) | `btc-updown-15m-<epochSec>` | machine format, our parsers handle it |
| 4h (btc; eth/sol also have series) | `btc-updown-4h-<epochSec>` — **same machine format** | series `btc-up-or-down-4h` (id 10331) |
| 1h "hourly" (btc; eth also) | `bitcoin-up-or-down-<month>-<day>-<year>-<N>pm-et` — **human date, ET hours** | series `btc-up-or-down-hourly` (id 10114); our slug parsers do NOT handle this |
| 1d "daily" (btc) | `bitcoin-up-or-down-on-<month>-<day>-<year>` — human date | series `btc-up-or-down-daily` (id 41, created 2023, relaunched 2025-03) |

- **Why 1h/4h/1d are absent from our catalog**: our own sync filter —
  `telonex:sync:crypto:5m-15min` pulls only the 5m/15m slug patterns. 4h could
  join with a pattern change alone (same slug format); 1h/1d would also need
  slug-parser support for the human-date formats. Whether Telonex records
  those series needs an API key to confirm.
- Resolution source: **Chainlink Data Streams** (not Binance, not on-chain
  `getRoundData`) — official docs + resolution endpoint.
- RTDS WS (`crypto_prices_chainlink` topic): live Chainlink ticks; a sponsored
  Chainlink API key exists for 15m-market traders (official docs).

### Gamma API — `events[].eventMetadata` (part of Polymarket)

Measured 2026-07-20 from the **complete backfill** of all 179,285 cataloged
markets (`telonex:sync-pricetobeat-and-final-price`; per-market ground truth,
supersedes the earlier probe estimates):

#### `eventMetadata.priceToBeat` (Chainlink open/strike)

| series | exists from |
|---|---|
| 15m btc / eth / sol / xrp | **2026-02-18 23:45 UTC** |
| 5m btc | **2026-02-19 00:05 UTC** |
| 5m eth / sol / xrp | **2026-03-18 23:00 UTC** (a month later!) |
| 1h "hourly" (btc) | **~2026-03-18/19** (probed: Feb 17 / Feb 19 / Mar 1 events null; Mar 18/19+ have it — same rollout wave as 5m alts) |
| 4h / 1d | present on recent markets (spot-checked ≥ late Mar 2026); exact epochs unmeasured — not in our catalog yet |

Code (`gammaPriceToBeatEpochMs`) carries the 15m/5m epochs exactly and
PROVISIONAL, deliberately-late epochs for 1h (**2026-03-20**) and 4h/1d
(**2026-04-01**). Safe because a backfilled strike always feeds regardless of
epoch — the epoch only classifies null strikes (quiet-absent vs hard-error);
tighten from `MIN(market_start_ms) WHERE price_to_beat IS NOT NULL` per series
once those series enter the catalog.

- `eventMetadata: null` before those dates — Polymarket did **not** backfill.
- **Holes after full rollout** (~1.7k markets = 1.36% since Apr 2026,
  symbol-symmetric ⇒ platform-side writer outages, not fetch errors):
  Mar 23 (72), **Apr 1 (708)**, Apr 24 (44), May 3–4 (628), May 20 (16),
  May 22 (153), Jun 2 (17), Jun 16 (3), Jul 5–6 (21). Clean otherwise.
  Re-verified 2026-07-20: a random 20-market sample re-fetched from Gamma
  still returns empty metadata — permanent gaps, not transient fetch errors.
- **Backtest policy**: markets before their SERIES' epoch (recording not yet
  started) replay with an absent key, quietly; post-epoch markets with no
  strike **hard-error** in strike-requesting backtests (exclude those windows
  from batches — the data does not exist anywhere).

#### `eventMetadata.finalPrice` (Chainlink settle)

Present from the same 2026-02-18/19 start, then **patchy/absent roughly
Feb 24 → Mar 21**, consistent after **~2026-03-21 ~15:00 UTC**. Net effect:
~22.6k markets have a strike but no settle (concentrated in that gap).

#### Documentation status (investigated 2026-07-20, exhaustively)

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
- Exact `eventMetadata` epochs for the 1h/4h/1d series (measure by backfill
  once those series enter the catalog).
- Whether Telonex records the 1h/4h/1d series (needs `TELONEX_API_KEY`).
