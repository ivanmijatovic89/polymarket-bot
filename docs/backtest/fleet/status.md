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

The run ends with a plain-text summary (also written to
`/tmp/fleet-status-summary.txt`):

```
================ FLEET STATUS ================
worker-1  main@a6ed241 · 10 cores · 118GB free · worker down · converter down
    converted btc:15m    23023 files   newest 2026-07-22 01:15
    binance   BTCUSDT      229 days    newest 2026-07-15
    chainlink          — none —
worker-2  main@a6ed241 · 10 cores · 125GB free · worker down · converter down
    converted btc:15m    19028 files   newest 2026-07-22 01:45
    binance   BTCUSDT      229 days    newest 2026-07-15
    chainlink          — none —
milan-m1  main@a6ed241 · 8 cores · 386GB free · worker down · converter down
    converted btc:15m    19252 files   newest 2026-07-21 23:00
    binance            — none —
    chainlink          — none —
```

Stale feeds ("binance newest = a week ago") and missing datasets are
visible at a glance; an offline host shows as `✗ UNREACHABLE`.

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
