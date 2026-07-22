---
title: Fleet Status
description: One read-only command that reports every fleet machine — reachability, git state, worker sessions, cores, disk, and per-dataset inventory.
---

# Fleet Status

```bash
npm run fleet:status
```

Read-only. For every host in `ops/ansible/inventory.ini` it reports:

- reachability (an offline machine shows as `UNREACHABLE`, the play continues)
- git branch + commit + dirty flag
- tmux sessions: backtest worker (`polymarket-backtest-worker`) and converter
  (`polymarket-telonex-converter`), with pane counts
- CPU cores and free disk
- dataset inventory — file count + newest file for every converted
  `symbol:timeframe`, Binance aggTrades pair, and crypto_prices asset (the
  same directories [data:sync](/datasets/sync) fills and reports)

The run ends with one aligned table — a row per machine (producer first),
a column per dataset, and each worker's gap shown relative to the producer:

```
machine   role      git            W/C  free   conv btc:15m          binance BTCUSDT  chainlink btcusd
------------------------------------------------------------------------------------------------------
ivan-mbp  producer  main@aadf718   --   58GB   25748·07-21           235·07-21        111·07-21
worker-1  worker    main@a6ed241   --   118GB  23023·07-21 (≈-2725)  229·07-15 (≈-6)  — (≈-111)
milan-m1  worker    main@a6ed241   --   386GB  19252·07-21 (≈-6496)  — (≈-235)        — (≈-111)
```

`(≈-N)` is an approximation (fewer files than the producer) — the exact
download plan is `npm run fleet:data -- <pairs> -e data_sync_extra='--dry-run'`.
`W/C` flags the backtest-worker / converter tmux sessions; `*` after a commit
means a dirty tree; an offline host shows as `✗ unreachable`.

The producer comes from a `[producer]` inventory group (see
`ops/ansible/inventory.example.ini`) — typically the local machine:

```ini
[producer]
ivan-mbp ansible_connection=local backtest_repo_dir=/Users/you/Sites/polymarket-bot
```

## How it works

`scripts/fleet-status.sh` runs `ops/ansible/status-workers.yml`, which
**pushes** `scripts/fleet-status-probe.mjs` (plain Node, zero dependencies)
to each host and runs it in the repo directory. Because the probe is copied
from the control machine, status works even on hosts whose repo checkout is
outdated or dirty — exactly the machines you most want to see.

Extra `ansible-playbook` arguments pass through:

```bash
npm run fleet:status -- --limit worker-1,worker-2
```

## See also

- [Update Fleet](/backtest/fleet/update) — `npm run fleet:update`
- [Start the Fleet](/backtest/fleet/start) — `npm run fleet:start`
- [Sync Fleet Data](/backtest/fleet/data-sync) — `npm run fleet:data`
