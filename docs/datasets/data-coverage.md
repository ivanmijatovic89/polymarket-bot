# Data Coverage — Single Source of Truth

One place for **"from when does each dataset / field exist"**. Update this file
whenever a new epoch boundary is discovered or a dataset is extended.

> Conventions: all dates UTC. "→ now" means continuously produced. Boundaries
> marked ~ were measured empirically by probing the source (method noted).

## Polymarket up/down markets (per Telonex catalog, `telonex_markets`)

| symbol | timeframe | first market | last synced | markets |
|---|---|---|---|---|
| btc | 15m | **2025-10-11** | 2026-07-11 | 24,712 |
| eth | 15m | **2025-10-11** | 2026-06-14 | 21,994 |
| sol | 15m | **2025-10-27** | 2026-06-14 | 21,033 |
| xrp | 15m | **2025-10-27** | 2026-06-14 | 21,063 |
| btc | 5m | **2026-02-12** | 2026-06-14 | 35,240 |
| eth / sol / xrp | 5m | **2026-02-18** | 2026-06-14 | ~33,280 each |

- "last synced" is our catalog's high-water mark (`telonex:sync` cadence), not
  the end of Polymarket's series — the markets keep running.
- **1h / 4h / 1d: not present in the Telonex catalog** (0 rows). TODO: confirm
  whether Telonex carries them at all or our sync filters them out.

## Gamma API `events[].eventMetadata` (per-market strike & settle price)

Measured 2026-07-20 by probing `gamma-api.polymarket.com/markets?slug=…&closed=true`
(binary search over 15m BTC slugs; spot-confirmed on 5m, ETH, SOL):

| field | exists from | notes |
|---|---|---|
| `eventMetadata.priceToBeat` | **~2026-02-19** (between 02-18 20:00 and 02-19 04:00) | the Chainlink open/strike price of the window |
| `eventMetadata.finalPrice` | **~2026-03-21** (between 12:00 and 18:00) | the Chainlink settle price — free resolution cross-check |

- Markets before these dates return `eventMetadata: null` — Polymarket did
  **not** backfill.
- The `polymarket.com/api/crypto/crypto-price` endpoint (authoritative
  open/close) only serves the **last ~30 days** — useless for bulk history;
  `eventMetadata` is the only historical priceToBeat source found.

## Telonex channels (`telonex_markets` availability columns)

| channel | from | notes |
|---|---|---|
| `trades`, `quotes`, `book_snapshot_5/25/full` | **2025-10-11** | full catalog span |
| `onchain_fills` | **2025-10-10** | |
| `crypto_prices` (Chainlink oracle ticks) | **2026-04-02** | per Telonex docs; NOT synced yet (needs subscription — Task 2) |

## Binance aggTrades (data.binance.vision daily dumps)

| item | value |
|---|---|
| Source coverage | years back (spot pairs since listing) |
| Our converted set | **2025-11-30 → yesterday** (daily `--sync` cron), BTCUSDT; ETH/SOL/XRP on demand |
| Timestamp unit switch | dumps carry **microseconds since 2025-01-01** (normalized to ms at convert) |
| Publication lag | ~1 day |

## Repo-side floors & knobs

| item | value |
|---|---|
| `TELONEX_DATASET_ELIGIBLE_FROM` | 2025-11-30 (env; markets below are excluded from the eligible backtest universe) |
| Binance feed latency default | 110 ms (measured p50 on the trading machine, 2026-07-16) |

## TODO / unknown boundaries (fill in when discovered)

- **"Orderbook v2"** — from when the v2 orderbook (format/channel) applies:
  not yet pinned down; owner note needed on what "v2" refers to (PMXT master
  v2? a Polymarket WS format change?).
- 1h / 4h / 1d market series start dates on Polymarket.
- First-ever Polymarket crypto up/down market (pre-Telonex-catalog history, if
  any exists before 2025-10-11).
