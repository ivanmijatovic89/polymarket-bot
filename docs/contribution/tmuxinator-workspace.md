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
| `BACKTEST WORKER` | `npm run backtest:worker -- --queues markets --market-concurrency 5` |
| `BACKTEST WORKER AGGREGATOR` | `npm run backtest:worker -- --queues aggregate` |

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

## Check Running Sessions

```bash
tmux ls
```
