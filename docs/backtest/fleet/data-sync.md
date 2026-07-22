---
title: Sync Fleet Data
description: Run data:sync:worker on every fleet machine with one command, so all workers hold the datasets their backtests will read.
---

# Sync Fleet Data

```bash
npm run fleet:data -- btc:15m
```

Runs [`data:sync:worker`](/datasets/sync) on every host in
`ops/ansible/inventory.ini`: converted orderbook parquet, Binance aggTrades
and crypto_prices day files, all pulled R2 → local on each machine. The
market scope is the first argument (comma-separated pairs), mirroring
`data:sync`'s explicit-scope rule.

Each host prints the tail of its sync output (per-step summary + local
inventory), followed by a one-line-per-host recap. A failed or unreachable
host is reported and does not stop the others.

```bash
# several pairs
npm run fleet:data -- btc:15m,eth:15m

# only some hosts
npm run fleet:data -- btc:15m --limit worker-1

# preflight only — every step reports what it would download
npm run fleet:data -- btc:15m -e data_sync_extra='--dry-run'

# forward any data:sync flag the same way
npm run fleet:data -- btc:15m -e data_sync_extra='--only binance --concurrency 6'
```

::: tip Requires the fleet to be updated first
`data:sync:worker` must exist in each worker's checkout — run
[`npm run fleet:update`](/backtest/fleet/ansible) first if the fleet is
behind. [`npm run fleet:status`](/backtest/fleet/status) shows each
machine's commit and current dataset inventory, so run it before and after.
:::

Typical operating order before a big backtest batch:

```bash
npm run fleet:status              # what state is everything in?
npm run fleet:update              # bring repos to origin/main
npm run fleet:data -- btc:15m     # bring datasets up to date
npm run fleet:start               # start (or restart) the workers
```
