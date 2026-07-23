---
title: 'ADR: Publication-Lag Guard'
description: Why markets younger than TELONEX_DATASET_MIN_AGE_DAYS are neither cataloged nor eligible, why the default is 3 days, and how to change it safely.
---

# ADR: Publication-Lag Guard (`TELONEX_DATASET_MIN_AGE_DAYS`)

**Status:** accepted, implemented 2026-07-22 · **Default:** 3 days · **Issue:** [#146](https://github.com/ivanmijatovic89/polymarket-bot/issues/146)

## Context

A market exists on Polymarket the moment its window opens, but its **complete
dataset** materializes only days later, because every source publishes on its
own schedule (all measured, not assumed — 2026-07):

| Source | What | Available |
| --- | --- | --- |
| Telonex catalog | market row (asset ids, ranges) | same/next day |
| Telonex raw day files (`book_snapshot_full`) | orderbook replay input | **~T+1** |
| Telonex `crypto_prices` day files | Chainlink feed | **~T+1/T+2** (skipped-unpublished until then) |
| Binance `data.binance.vision` aggTrades dumps | Binance feed | **~T+2** |
| Gamma `priceToBeat` | strike backfill | ~3 h after settle (own 30 h grace) |

Cataloging markets before their day files exist caused three concrete
problems:

1. **Backtest batches picked unfulfillable markets.** Run 812
   (`--latest --limit 200`, 2026-07-22): 96/200 markets hard-errored on
   missing feed days — the entire ~2-day publication tail.
2. **Partial-download churn.** `telonex:download` claimed fresh markets,
   got `no_file`, marked them `partial` and re-queued them daily until
   Telonex published.
3. **Misleading operational numbers.** Producer/fleet dry-run counts
   included work nobody could perform yet, so `FLEET SYNCED` and queue
   sizes could not be trusted as verdicts.

## Decision

One threshold, **`TELONEX_DATASET_MIN_AGE_DAYS`** (integer days, default
**3**), enforced at two points:

1. **Ingress — `telonex:sync`** skips matched markets younger than the
   threshold (logged: `skipped N younger than 3d (publication-lag guard)`).
   They enter on a later sync, by which time every source has published —
   so downloads complete on the first pass.
2. **Egress — eligibility** (`buildEligibleWhere` in
   `src/db/telonexMarkets.ts`) caps `market_start_ms` at the same
   threshold, overriding even an explicit `toMs`. This guarantees
   *eligible ⇒ complete dataset exists* regardless of how a row entered
   the DB (pre-guard rows, manual inserts, future tools).

**Why 3 days:** the slowest source (Binance dumps) is ~T+2; one extra day
absorbs weekends/hiccups. **Why days, not hours:** all sources publish in
whole-day files, so sub-day precision is false precision.

## Alternatives considered and rejected

- **Skip the newest days in backtest selection only** — leaves the sync
  churn and the misleading queue counts; also every selection surface
  (CLI, dashboard, research protocol) would need its own filter.
- **Ingress filter only** — correct end-state, but rows already cataloged
  young (pre-guard era) would still surface through eligibility until they
  age; the egress cap closes that permanently.
- **Fixed hour threshold (48 h)** — a time guess with false precision;
  publication is daily and T+2 was observed regularly.
- **Data-driven ceiling** (derive the boundary from the newest feed day
  files actually on disk) — more precise and self-adjusting, but more code
  and per-machine variance. Kept as the designated upgrade path (below).
- **Deleting the already-synced young data** — pointless risk: the data is
  early, not wrong; conversions were made only from complete raw sets
  (`upload_status='done'`), and the egress cap hides young rows until they
  are valid. Everything converges by itself.

## Consequences

- Backtests see a market ~3 days after its window — irrelevant for
  research on history, and the explicit trade-off of this ADR.
- The catalog is no longer a same-day record of market existence; it is a
  record of markets whose data pipeline can complete.
- Feed downloads (`binance`, `crypto_prices`) are unaffected — they already
  self-limit to published days.
- `priceToBeat` backfill improves: markets enter the catalog long past its
  30 h settle-grace, so they are backfilled in the same `data:sync` run
  that catalogs them.

## Changing the threshold

Set `TELONEX_DATASET_MIN_AGE_DAYS` in `.env` (loaded via
`src/config/telonex.ts`):

- **Lowering** takes effect on the next `telonex:sync` (younger markets get
  cataloged immediately) and instantly widens eligibility.
- **Raising** instantly narrows eligibility; already-cataloged younger rows
  remain in the DB as a harmless transient tail that ages past the new
  threshold on its own. Nothing needs cleaning.
- **`0` disables the guard** (both points) — only sensible for
  orderbook-only experiments that accept feed hard-errors.

## Upgrade path

When a fixed number of days stops being good enough (e.g. multi-symbol
fleets with different lags), replace the constant in
`telonexDatasetMaxStartMs()` (`src/config/telonex.ts`) with a data-driven
boundary — e.g. the newest day present across the feed datasets. Both
enforcement points consume that single function; nothing else changes.
