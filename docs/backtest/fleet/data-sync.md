---
title: Sync Fleet Data
description: Run data:sync:worker on every fleet machine with one command, so all workers hold the datasets their backtests will read.
---

# Sync Fleet Data

```bash
npm run fleet:data:sync -- btc:15m
```

Runs [`data:sync:worker`](/datasets/sync) on every host in
`ops/ansible/inventory.ini`: converted orderbook parquet, Binance aggTrades
and crypto_prices day files, all pulled R2 → local on each machine. The
market scope is the first argument (comma-separated pairs), mirroring
`data:sync`'s explicit-scope rule.

With `--dry-run`, the producer (from the `[producer]` inventory group) is
checked too — it runs a `data:sync:main` preflight against the upstream
sources (Telonex raw files, Gamma backfill, Binance/crypto_prices publishing,
R2 uploads) and gets its own table. The catalog step is skipped in this check
(its dry-run would download the ~1 GB catalog), so the verdict reads "up to
date relative to the known catalog". On real runs the producer is excluded:
its sync is `data:sync:main`, run directly or from cron.

The run ends with one aligned table — a row per machine, a column per sync
step, each cell the step status and its download count. With `--dry-run`
the result column becomes a verdict (`SYNCED ✓` / `BEHIND (N)`), the run
ends with a one-line `FLEET SYNCED: YES/NO`, and the command exits non-zero
when any machine is behind — so `npm run fleet:data:sync -- btc:15m -e
data_sync_extra='--dry-run' && echo synced` works in scripts. A failed or
unreachable host is reported and does not stop the others; after the recap,
the command exits non-zero in both real and dry-run modes. If one inventory
host is both producer and worker, it gets a separate row for each role so the
upstream and R2 checks remain visible independently.

```
machine   result  converted-btc-15m  binance-local-btc  crypto-prices-local-btc
-------------------------------------------------------------------------------
worker-1  OK      OK 2725            OK 5               OK 110
worker-2  OK      OK 3213            OK 5               OK 110
milan-m1  OK      OK 2989            OK 234             OK 110
```

```bash
# several pairs
npm run fleet:data:sync -- btc:15m,eth:15m

# only some hosts
npm run fleet:data:sync -- btc:15m --limit worker-1

# preflight only — every step reports what it would download
npm run fleet:data:sync -- btc:15m -e data_sync_extra='--dry-run'

# forward any data:sync flag the same way
npm run fleet:data:sync -- btc:15m -e data_sync_extra='--only binance --concurrency 6'
```

::: tip Requires the fleet to be updated first
`data:sync:worker` must exist in each worker's checkout — run
[`npm run fleet:update`](/backtest/fleet/update) first if the fleet is
behind. [`npm run fleet:status`](/backtest/fleet/status) shows each
machine's commit and current dataset inventory, so run it before and after.
:::

Typical operating order before a big backtest batch:

```bash
npm run fleet:status              # what state is everything in?
npm run fleet:update              # bring repos to origin/main
npm run fleet:data:sync -- btc:15m     # bring datasets up to date
npm run fleet:start               # start (or restart) the workers
```
