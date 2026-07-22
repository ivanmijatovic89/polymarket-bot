---
title: Start Worker Fleet
description: Safely update worker checkouts, then start missing managed tmux backtest worker sessions.
---

# Start Worker Fleet

`npm run fleet:start` (wrapper: `scripts/start-worker-fleet.sh`) brings the
worker fleet to the desired running state. It first runs the same safe
checkout update used by `npm run fleet:update`, then starts the managed tmux worker session on
hosts where that session is missing.

## Responsibility

This wrapper composes two phases:

```text
start-worker-fleet.sh
  -> ansible-playbook update-workers.yml
    -> fast-forward checkout
    -> npm ci if package-lock changed
    -> restart only already-running managed sessions that had to stop for update

  -> ansible-playbook start-workers.yml
    -> if tmux session is missing:
         tmux new-session ... "exec ./scripts/run-worker.sh ..."
```

If the update phase fails, the start phase is skipped. That prevents starting a
worker on a dirty, diverged, or otherwise unsafe checkout.

## Normal Use

Dry run:

```bash
npm run fleet:start -- --check
```

Update checkouts if needed, then start missing managed sessions:

```bash
npm run fleet:start
```

Limit to one host:

```bash
npm run fleet:start -- --limit worker-1
```

The wrapper prints elapsed time and the Ansible exit code:

```text
[start-worker-fleet] elapsed=00:00:08 exit=0
```

## Idempotency

The start phase checks for the tmux session before starting anything:

```bash
tmux has-session -t polymarket-backtest-worker
```

So repeated runs are safe:

- if all workers are already running, it starts nothing new;
- if two of three machines are running, it starts only the missing third;
- if a host is offline, Ansible reports that host as unreachable and does not
  affect the others.

## What It Starts

By default, each host gets a detached tmux session named:

```text
polymarket-backtest-worker
```

The default command inside that session is:

```bash
./scripts/run-worker.sh --queues markets --market-concurrency 5
```

The playbook looks for tmux in `PATH`, `/opt/homebrew/bin/tmux`, and
`/usr/local/bin/tmux`. If a worker uses a different tmux path, override it in
`ops/ansible/inventory.ini`:

```ini
worker-1 ansible_host=worker-1-ansible backtest_repo_dir=/Users/worker-1/Sites/polymarket-bot backtest_tmux_bin=/custom/bin/tmux
```

The worker command runs through `/bin/zsh -lic` inside tmux. This intentionally
matches the environment you get when you SSH into the worker and start the
worker manually, so NVM/Homebrew setup from your shell startup files is
available. If a worker uses a different shell, set `backtest_worker_shell`:

```ini
worker-1 ansible_host=worker-1-ansible backtest_repo_dir=/Users/worker-1/Sites/polymarket-bot backtest_worker_shell=/bin/bash
```

Override it per host in `ops/ansible/inventory.ini`:

```ini
[backtest_workers]
worker-1 ansible_host=worker-1-ansible backtest_repo_dir=/Users/worker-1/Sites/polymarket-bot
milan ansible_host=milan-ansible backtest_repo_dir=/Users/milan/Projects/polymarket-bot backtest_worker_command="./scripts/run-worker.sh --queues markets --market-concurrency 8"
```

## Verify

Check tmux sessions:

```bash
ssh worker-1-ansible 'tmux ls'
ssh milan-ansible 'tmux ls'
```

Check worker logs:

```bash
ssh worker-1-ansible 'tail -n 100 ~/Sites/polymarket-bot/logs/workers/polymarket-backtest-worker.log'
ssh milan-ansible 'tail -n 100 ~/Projects/polymarket-bot/logs/workers/polymarket-backtest-worker.log'
```

Attach to logs:

```bash
ssh worker-1-ansible
tmux attach -t polymarket-backtest-worker
```

Detach without stopping the worker:

```text
Ctrl-b, then d
```

## Relationship to update-worker-fleet

Use the two commands like this:

```bash
npm run fleet:update -- --check
npm run fleet:update
npm run fleet:start -- --check
npm run fleet:start
```

`update-worker-fleet.sh` updates code and restarts only sessions that were
already running and needed a checkout update. `start-worker-fleet.sh` runs that
same update phase first, then starts missing sessions.

## Missing tmux

If the start phase reports that tmux is missing, install it on that worker:

```bash
ssh worker-1-ansible 'brew install tmux'
ssh milan-ansible 'brew install tmux'
```

Then rerun:

```bash
npm run fleet:start
```

## Worker exits immediately

If tmux starts and immediately disappears, inspect the worker log first:

```bash
ssh worker-1-ansible 'tail -n 100 ~/Sites/polymarket-bot/logs/workers/polymarket-backtest-worker.log'
```

An error like `env: node: No such file or directory` means the worker shell did
not initialize the same environment you use manually. Make sure the shell set in
`backtest_worker_shell` loads your NVM/Homebrew setup, or move that setup into a
startup file loaded by that shell.
