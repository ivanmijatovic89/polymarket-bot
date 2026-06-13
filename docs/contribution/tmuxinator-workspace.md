---
title: Tmuxinator Workspace
description: How to start, stop, and navigate the local tmuxinator workspace.
---

# Tmuxinator Workspace

The repository includes a local tmuxinator config at the project root:

```bash
.tmuxinator.yml
```

It starts the common local development services in one tmux window with a 2x2 pane layout.

## Start the Workspace

From the repository root:

```bash
tmuxinator start .tmuxinator.yml
```

The `SERVICES` window starts:

| Pane | Command |
| --- | --- |
| `DASHBOARD` | `DASHBOARD_ALLOWED_DEV_ORIGINS=100.100.49.80 npm run dashboard` |
| `DOCUMENTATION` | `cd docs && npm run dev` |
| `BACKTEST WORKER` | `./scripts/run-worker.sh --queues markets --market-concurrency 5` |
| `BACKTEST WORKER AGGREGATOR` | `./scripts/run-worker.sh --queues aggregate` |

## Stop the Workspace

This stops the tmux session and terminates all processes running in its panes:

```bash
tmux kill-session -t polymarket
```

If you are already inside the session, you can also press:

```text
Ctrl-b :
```

Then type:

```text
kill-session
```

and press Enter.

## Detach Without Stopping

Detach when you want to leave tmux but keep the processes running:

```text
Ctrl-b d
```

Reattach with:

```bash
tmux attach -t polymarket
```

## Move Between Panes

Use the tmux prefix, then an arrow key:

```text
Ctrl-b Left
Ctrl-b Right
Ctrl-b Up
Ctrl-b Down
```

Show pane numbers:

```text
Ctrl-b q
```

Then press the pane number you want.

## Restart After Config Changes

After changing `.tmuxinator.yml` or `.tmuxinator.tmux.conf`, restart the session:

```bash
tmux kill-session -t polymarket
tmuxinator start .tmuxinator.yml
```

## Telonex Download Fan-Out

The Telonex raw-file downloader can be scaled across multiple parallel processes.
Because it claims markets with `SELECT ... FOR UPDATE SKIP LOCKED`, any number of
processes cooperatively drain the **same** queue — each one just pulls the next
unclaimed market, so there is no need to split the slug-pattern across them.

The helper script `scripts/telonex-download-fanout.sh` launches N such processes,
each in its own pane of a single tmux window, so you can watch them all at once.

### Launch

The first argument is the number of panes; everything after it is forwarded
verbatim to `npm run telonex:download`. `--slug-pattern` is required.

```bash
# 6 panes, all draining btc 15m markets
./scripts/telonex-download-fanout.sh 6 --slug-pattern 'btc-updown-15m-%'

# or via the npm alias (note the `--` before the args)
npm run telonex:download:fanout -- 6 --slug-pattern 'btc-updown-15m-%'

# extra flags pass straight through to telonex:download
./scripts/telonex-download-fanout.sh 4 \
  --slug-pattern 'btc-updown-15m-%,eth-updown-15m-%' --limit 500 --concurrency 2
```

This runs in its **own** tmux session named `polymarket-telonex-downloader`,
independent of the `polymarket` workspace session. The panes are titled
`dl-1`…`dl-N`. If you launch from outside tmux the script attaches you to the new
session; if you launch from inside tmux it jumps you to the new window.

::: warning `--limit` is per process
`--limit` caps each process, not the run as a whole. `--limit 500` across 6 panes
can download up to ~3000 markets in total.
:::

### Stop

Graceful drain — press `Ctrl-C` in each pane. The downloader handles `SIGINT`,
finishes the in-flight file, and reverts any `processing` markets back to
`pending`.

Kill the whole fan-out at once:

```bash
tmux kill-session -t polymarket-telonex-downloader
```

Kill a single pane (e.g. scaling 6 → 5) by focusing it and pressing `Ctrl-b x`,
or by index:

```bash
tmux kill-pane -t polymarket-telonex-downloader:download.0
```

Killing this session does not affect the `polymarket` workspace session, and
vice-versa — they are independent.

## Telonex Convert Fan-Out

The `telonex:convert` step has the same shape and an analogous launcher,
`scripts/telonex-convert-fanout.sh`. It matters even more here: conversion is
**CPU-bound single-threaded JavaScript**, so raising one process's
`--concurrency` only overlaps I/O — real parallelism comes from running multiple
**processes**, which is exactly what this fan-out does. The converter also uses
`FOR UPDATE SKIP LOCKED`, so the panes cooperate safely on the same queue.

```bash
# 4 panes converting btc 15m to delta-typed, writing both locally and to R2
./scripts/telonex-convert-fanout.sh 4 --converter delta-typed --slug-pattern 'btc-updown-15m-%' --output both

# npm alias (note the `--` before the args)
npm run telonex:convert:fanout -- 4 --converter delta-typed --slug-pattern 'btc-updown-15m-%' --output both

# multiple slug patterns — comma-separated, drained IN ORDER:
# all of btc-15m first, then eth-15m, then sol-15m (chronological within each)
./scripts/telonex-convert-fanout.sh 6 --converter delta-typed --output both \
  --slug-pattern 'btc-updown-15m-%,eth-updown-15m-%,sol-updown-15m-%'

# everything 'done' that still needs delta-typed (no pattern — it is optional here)
./scripts/telonex-convert-fanout.sh 8 --converter delta-typed
```

When you pass several comma-separated patterns, all panes drain them in the order
listed — every `btc-updown-15m-%` market is processed before any
`eth-updown-15m-%`, and so on — and chronologically (oldest first) within each
pattern. All panes share one queue, so they cooperate rather than each restarting
from the top.

Differences from the download fan-out:

- **`--slug-pattern` is optional** — without it, convert processes every eligible
  `done` market.
- Runs in its own session **`polymarket-telonex-converter`**, window `convert`,
  panes titled `cv-1`…`cv-N`.

Stop it the same way:

```bash
tmux kill-session -t polymarket-telonex-converter          # whole fan-out
tmux kill-pane -t polymarket-telonex-converter:convert.0   # one pane
```

`Ctrl-C` in a pane drains gracefully: the converter finishes the in-flight
market and reverts any `in_progress` conversion rows back to `pending`.

## Check Running Sessions

```bash
tmux ls
```
