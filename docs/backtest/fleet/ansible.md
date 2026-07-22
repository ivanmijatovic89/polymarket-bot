---
title: Worker Fleet Ansible
description: Proactively update backtest worker machine checkouts with Ansible, while preserving the worker self-update safety gate.
---

# Worker Fleet Ansible

Worker self-update is intentionally lazy: a worker updates when it receives a
job whose producer commit is newer than the code it loaded. That is the
correctness layer. It prevents a stale worker from running a strategy registry
that cannot contain the job's strategy code.

Ansible is the operational layer on top. It lets you update worker checkouts
before they receive a job, so the fleet is already on fresh `origin/main` when
you launch a backtest. The commit gate still remains active, so proactive
updates improve operator workflow without weakening determinism.

## What This Solves

Without Ansible, a quiet worker can stay on old code indefinitely. That is safe:
the first new-code job will be delayed, the worker will exit with code `75`, and
`scripts/run-worker.sh` will pull and relaunch it. But it costs time at the
start of the run, and stale workers are visible on the dashboard until they are
given work.

With Ansible, you can run one command after merging or pushing:

```bash
npm run fleet:update
```

That command connects to every worker in the inventory, fast-forwards the repo,
installs dependencies only if needed, and restarts the managed worker process
only when that process was already running and the checkout changed.

## Architecture

```mermaid
flowchart TD
    A[Main machine] --> B["scripts/update-worker-fleet.sh"]
    B --> C["ansible-playbook update-workers.yml"]
    C --> D[Worker 1]
    C --> E[Worker 2]
    C --> F[Worker N]

    D --> G["git fetch origin"]
    G --> H{"checkout update needed?"}
    H -- No --> I["leave worker running"]
    H -- "Update needed" --> J["verify fast-forward"]
    J --> K{"managed tmux<br/>session running?"}
    K -- Yes --> L["stop managed tmux session"]
    K -- No --> M["leave worker stopped"]
    L --> N["git checkout main"]
    M --> N
    N --> O["git merge --ff-only origin/main"]
    O --> P["npm ci if package-lock changed"]
    P --> Q{"session was running?"}
    Q -- Yes --> R["start scripts/run-worker.sh"]
    Q -- No --> S["do not start worker"]
```

`scripts/run-worker.sh` is still the process that runs the worker. Ansible does
not bypass it. That matters because the wrapper already knows how to handle
worker exit code `75`, reinstall dependencies after lazy self-update, and avoid
infinite relaunch loops when a needed commit is unreachable.

## Files

| File | Purpose |
| --- | --- |
| `ops/ansible/update-workers.yml` | The playbook that updates worker checkouts and restarts already-running managed sessions when needed. |
| `ops/ansible/start-workers.yml` | The playbook that starts missing managed worker sessions. |
| `ops/ansible/inventory.example.ini` | Example inventory. Copy it to `inventory.ini` and edit hosts. |
| `ops/ansible/ansible.cfg` | Local Ansible defaults used by the wrapper. |
| `scripts/update-worker-fleet.sh` | Local wrapper that runs the playbook against `ops/ansible/inventory.ini`. |
| `scripts/start-worker-fleet.sh` | Local wrapper that starts missing managed worker sessions. |

`ops/ansible/inventory.ini` is intentionally ignored by Git because it can
contain private hostnames, users, IPs, or per-machine command overrides.

## Inventory

Create your local inventory:

```bash
cp ops/ansible/inventory.example.ini ops/ansible/inventory.ini
```

Example:

```ini
[backtest_workers]
worker-1 ansible_host=worker-1-ansible backtest_repo_dir=/Users/worker-1/Sites/polymarket-bot
worker-2 ansible_host=100.64.0.25 backtest_repo_dir=/Users/worker-2/Sites/polymarket-bot backtest_worker_command="./scripts/run-worker.sh --queues markets --market-concurrency 8"
```

The inventory variables are:

| Variable | Required | Default |
| --- | --- |
| `backtest_repo_dir` | Yes | none |
| `backtest_branch` | No | `main` |
| `backtest_remote` | No | `origin` |
| `backtest_tmux_bin` | No | auto-detect from `PATH`, `/opt/homebrew/bin/tmux`, or `/usr/local/bin/tmux` |
| `backtest_worker_shell` | No | `/bin/zsh` |
| `backtest_worker_log_dir` | No | `<backtest_repo_dir>/logs/workers` |
| `backtest_worker_session` | No | `polymarket-backtest-worker` |
| `backtest_worker_command` | No | `./scripts/run-worker.sh --queues markets --market-concurrency 5` |

Override `backtest_worker_command` per host when different machines should use
different concurrency or queue ownership.

## Managed tmux Session

The current version uses a named tmux session instead of `launchd`:

```text
polymarket-backtest-worker
```

The update playbook only starts this session again when it was already running
and a checkout update required stopping it. Starting missing sessions is handled
by [Start Worker Fleet](/backtest/fleet/start).

The managed session command is:

```bash
tmux new-session -d \
  -s polymarket-backtest-worker \
  -c "$repo" \
  "exec ./scripts/run-worker.sh --queues markets --market-concurrency 5"
```

If a worker is currently running manually in another terminal or tmux pane, stop
that process once before switching to the managed session.

## Update Flow

For each host, the playbook:

1. Verifies the repository exists.
2. Fails if tracked files are dirty.
3. Reads the current `HEAD`.
4. Fetches `origin`.
5. Checks whether the managed tmux session exists.
6. Decides whether the checkout must change.
7. Verifies the target branch can fast-forward to `origin/main`.
8. Stops the managed tmux session before any working-tree mutation when a
   checkout update is needed.
9. Checks out `main` and runs `git merge --ff-only origin/main`.
10. Runs `npm ci` only if `package-lock.json` changed.
11. Starts the managed tmux session again only if it was running before the
    update.

This is deliberately conservative. A dirty or diverged checkout is an operator
problem, not something the playbook should repair automatically.

## Running It

Normal update:

```bash
npm run fleet:update
```

The wrapper prints total elapsed time and the Ansible exit code at the end:

```text
[update-worker-fleet] elapsed=00:00:18 exit=0
```

This command does not start missing workers. To start workers that are not
running, use the composed start command. It runs the update phase first, then
starts only missing managed tmux sessions:

```bash
npm run fleet:start
```

Pass Ansible flags through the wrapper:

```bash
npm run fleet:update -- --check
npm run fleet:update -- --limit worker-1
npm run fleet:update -- -v
```

Use another inventory file:

```bash
ANSIBLE_INVENTORY=/path/to/inventory.ini npm run fleet:update
```

## Failure Modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Repository not found` | The worker was not provisioned yet, or `backtest_repo_dir` is wrong. | Clone the repo or override `backtest_repo_dir`. |
| `Tracked working tree is dirty` | Local edits exist on the worker checkout. | Commit/stash/remove them, or use a separate experimental checkout. |
| `cannot fast-forward` | The worker branch diverged from `origin/main`. | Inspect the branch manually; do not let automation guess. |
| `tmux is required to start managed workers` | tmux is missing on that worker, or it is installed outside the detected paths. | Run `brew install tmux`, or set `backtest_tmux_bin` in inventory. |
| `env: node: No such file or directory` in worker log | The configured worker shell does not load Node/NVM setup. | Fix the worker shell startup files, or set `backtest_worker_shell` to the shell you use manually. |
| Worker still shows old commit | The managed session was not the process shown on the dashboard. | Stop old manual workers and let the managed tmux session be the only worker process. |

## Warnings

The wrapper uses `ops/ansible/ansible.cfg`, which sets
`interpreter_python = auto_silent`. This suppresses Ansible's noisy Python
interpreter discovery warning on macOS workers. It does not pin a specific
Python path; if a worker later has a broken Python install, Ansible will still
fail when it cannot run modules.

Deprecation warnings are also disabled for this fleet command so normal update
output stays focused on host state.

The same config enables SSH pipelining. Pipelining reduces Ansible's per-task
SSH overhead by streaming module execution through the existing SSH connection
instead of doing as much temporary file setup on the remote host.

## Dashboard

Workers publish the branch and commit they loaded at startup. The dashboard
shows both:

- **Branch** - the loaded branch name, usually `main`; detached checkouts show
  `detached`.
- **Commit** - the loaded commit SHA; green means it matches `origin/main`,
  amber means it is behind or unknown.

These are loaded values, not live `git rev-parse` values. If Ansible advances
files on disk but a process has not restarted yet, the dashboard still shows
the old loaded commit, which is the correct signal.

## Relationship to Self-Update

Ansible does not replace [Worker Self-Update](/backtest/fleet/self-update).

- Ansible keeps the fleet fresh before jobs arrive.
- Self-update protects correctness when a worker is still stale.
- The producer dirty-tree guard still prevents uncommitted strategy code from
  being enqueued into distributed workers.

The invariant stays the same: workers either run code that contains the job's
producer commit, or they defer the job and relaunch.

## Future Extensions

This page is the place to continue the worker fleet work. Good next additions:

- `provision-worker.yml` for Homebrew, Node.js, tmux, repo clone, and `.env`.
- `launchd` instead of tmux for reboot-safe workers.
- Separate inventories for markets-only workers and aggregate-capable machines.
- Data prewarm commands for converted parquet files.
- Fleet health checks that compare dashboard heartbeats with Ansible inventory.
