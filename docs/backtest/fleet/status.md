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

Example recap:

```
worker-1     main@2b0aaea  cores=10  free=118GB  worker=down  converter=down
worker-2     main@f22ca1c  cores=10  free=125GB  worker=down  converter=down
milan-m1     main@2b0aaea  cores=8   free=386GB  worker=down  converter=down
milan-m5     UNREACHABLE or probe failed
```

Above the recap, each reachable host prints its full status line including
the dataset inventory, so stale feeds ("binance newest = 5 days ago") and
missing datasets are visible at a glance.

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

- [Update Fleet (Ansible)](/backtest/fleet/ansible) — `npm run fleet:update`
- [Start the Fleet](/backtest/fleet/start) — `npm run fleet:start`
- [Sync Fleet Data](/backtest/fleet/data-sync) — `npm run fleet:data`
