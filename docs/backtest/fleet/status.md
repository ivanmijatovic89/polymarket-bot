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
a column per dataset. It is a pure **inventory**: what each machine HAS
(file counts + newest dates). It never claims something is missing — that
is [`fleet:data:sync --dry-run`](/backtest/fleet/data-sync)'s job, which compares
against R2 and gives per-machine verdicts:

```
machine   role      git            W/C  free   conv btc:15m  binance BTCUSDT  chainlink btcusd
----------------------------------------------------------------------------------------------
ivan-mbp  producer  main@a1762a7   --   55GB   25748·07-21   235·07-21        111·07-21
worker-1  worker    main@a1762a7   W-   112GB  25748·07-21   234·07-20        111·07-21
milan-m1  worker    main@a1762a7   --   376GB  22241·07-21   234·07-20        111·07-21
```

Counts can legitimately differ between machines without anything being
wrong (e.g. the producer holds pre-eligibility historical files workers
never need, or a day file not yet mirrored to R2) — which is exactly why
this table does not render gaps. `W/C` flags the backtest-worker /
converter tmux sessions; `*` after a commit means a dirty tree; an offline
host shows as `✗ unreachable`. A reachable host whose probe cannot run
(for example, Node is missing or the repo path is wrong) shows as
`✗ probe failed` with its exit code and a short error instead.

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
- [Sync Fleet Data](/backtest/fleet/data-sync) — `npm run fleet:data:sync`
