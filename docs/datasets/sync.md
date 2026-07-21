---
title: Machine Roles & Sync
description: One command per machine role to bring every dataset up to date — data:sync:main for the producer, data:sync:worker for backtest workers.
---

# Machine Roles & Sync

Every machine in the setup plays one of two data roles. The **main device**
(producer) pulls from the upstream sources — Telonex, Gamma, Binance — and
mirrors everything to R2. **Workers** pull from R2 to local disk before
running backtests. One command per role brings every dataset that role needs
up to date:

::: code-group

```bash [main device]
npm run data:sync:main -- --market btc:15m
```

```bash [worker]
npm run data:sync:worker -- --market btc:15m
```

:::

The scope is **explicit on purpose** — there is no default market, so a bare
invocation prints usage and exits. `--market` is repeatable and per-pair, so
uneven scopes are expressible directly:

```bash
npm run data:sync:main -- --market btc:15m --market eth:5m --market eth:15m
```

## What each role syncs

| Step | main | worker | Underlying command |
| --- | :-: | :-: | --- |
| Telonex catalog (`telonex_markets`) | ✓ | | `telonex:sync` |
| priceToBeat + finalPrice backfill | ✓ | | `telonex:sync-pricetobeat-and-final-price` |
| Raw orderbook files (Telonex → R2) | ✓ | | `telonex:download` |
| Convert to delta-typed (→ R2) | ✓ | | `telonex:convert` |
| Binance aggTrades day files (→ R2) | ✓ | | `binance:download-aggtrades --sync` + `binance:upload-aggtrades-r2` |
| Chainlink crypto_prices day files (→ R2) | ✓ | | `telonex:crypto-prices:download --sync` + `:upload-r2` |
| Converted parquet R2 → local | | ✓ | `telonex:download-converted-r2-to-local` |
| Binance aggTrades R2 → local | | ✓ | `binance:download-aggtrades-r2-to-local` |
| crypto_prices R2 → local | | ✓ | `telonex:crypto-prices:download-r2-to-local` |

Orderbook steps are scoped per `symbol:timeframe` pair (slug patterns); the
Binance and crypto_prices feeds are **timeframe-agnostic**, so they run once
per distinct symbol regardless of how many timeframes are requested.

`data:sync` adds no sync logic of its own — it only sequences the commands
above and reports. Each underlying command stays independently runnable.

## One mechanism for every situation

Because every underlying command is idempotent and incremental (self-healing
`--sync` ranges, claim-based download/convert, skip-if-exists R2 pulls), the
same invocation covers all three situations:

- **Daily delta** — data is current up to yesterday: only the newest files
  are fetched. Run the same command every day, manually or from cron.
- **Gap-fill** — data stops weeks ago: the missing range is detected and
  fetched, nothing else.
- **Full backfill** — a new symbol or timeframe with no local data: history
  is fetched from each dataset's coverage epoch (see
  [Data Coverage](/datasets/data-coverage)).

::: tip Backtests during a sync are safe
Writers finish files atomically (`tmp` → rename) and Telonex markets become
eligible only once their conversion is recorded in the DB, so a backtest
started mid-sync sees fewer markets, never broken ones. If a backtest
requests a feed window that is not yet synced, it **hard-errors** loudly
instead of computing on stale data — re-run those slugs after the sync with
[`--extend`](/backtest/extending-a-run).
:::

## Options

| Flag | Meaning |
| --- | --- |
| `--market <symbol>:<timeframe>` | Repeatable, required. E.g. `btc:15m`. |
| `--dry-run` | Preflight only. Forwarded to every step that supports it natively; the two that do not (`telonex:download`, `telonex:convert`) print the exact command they would run. |
| `--plan` | Print the resolved step list with dependencies and exit. Runs nothing, touches nothing. |
| `--only a,b` / `--skip a,b` | Filter steps by id prefix (e.g. `--only binance`, `--skip catalog,convert`). |
| `--concurrency N` | Forwarded to steps that support it. |

Step ids are shown by `--plan`. On the main role:
`catalog`, `pricetobeat`, `orderbook-download`, `convert`,
`binance-download-<sym>`, `binance-upload-<sym>`,
`crypto-prices-download-<sym>`, `crypto-prices-upload-<sym>`.
On the worker role: `converted-<sym>-<tf>`, `binance-local-<sym>`,
`crypto-prices-local-<sym>`.

## Failure handling

Steps run sequentially in dependency order. When a step fails, its dependents
are marked `SKIPPED` while independent branches keep going — a Telonex outage
does not stop the Binance mirror, and vice versa. The run ends with a
per-step summary (status + duration) and a **non-zero exit code if anything
failed**, which is what a cron or fleet wrapper should alert on.

After a real (non-dry) run, a local dataset inventory is printed for the
requested scope — file count and newest file per dataset. The same numbers
are what a fleet status check reads per machine.

```
[data:sync] summary:
  OK      catalog  42.1s
  OK      pricetobeat  12.3s
  ...
[data:sync] local dataset inventory:
  converted btc 15m:  18635 files, newest btc-updown-15m-1753142400.parquet
  binance aggTrades BTCUSDT:  234 files, newest BTCUSDT-aggTrades-2026-07-21.parquet
  crypto_prices btcusd:  111 files, newest btcusd-crypto-prices-2026-07-21.parquet
```

## Requirements per role

- **main**: `TELONEX_API_KEY`, database access, R2 credentials, and Gamma
  reachability. The first run for a brand-new pair is a full backfill — expect
  it to take a while (bounded below by each dataset's epoch and by
  `TELONEX_DATASET_ELIGIBLE_FROM`).
- **worker**: database access and R2 credentials only.

## See also

- [Data Coverage](/datasets/data-coverage) — per-dataset epochs and verified holes
- [Telonex Overview](/datasets/telonex/overview) — the orderbook pipeline the main role drives
- [Price Feeds](/datasets/price-feeds/overview) — the Binance / Chainlink / priceToBeat feed docs
