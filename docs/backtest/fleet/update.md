---
title: Update Fleet
description: Proactively update backtest worker machine checkouts with Ansible, while preserving the worker self-update safety gate.
---

# Update Fleet

Implemented with Ansible (`ops/ansible/update-workers.yml`).

Worker self-update is intentionally lazy: a worker updates when it receives a
job whose producer commit is newer than the code it loaded. That is the
correctness layer. It prevents a stale worker from running a strategy registry
that cannot contain the job's strategy code.

Ansible is the operational layer on top. It lets you update worker checkouts
before they receive a job, so the fleet is already on fresh `origin/main` when
you launch a backtest. The commit gate still remains active, so proactive
updates improve operator workflow without weakening determinism.


## Quick pull vs full update

Two speeds, measured on a three-machine fleet with one overseas host:

| | `npm run fleet:git:pull` | `npm run fleet:update` |
| --- | --- | --- |
| Does | fetch → (optional branch switch) → `merge --ff-only` → `npm install` **only if the lockfile moved** → drain + restart the worker **only if the code actually changed** | the same, plus repo/dirty/fast-forward pre-checks and per-step reporting |
| Round trips | **one shell per machine** | ~19 ansible tasks per machine |
| Takes | **~4 s** idle, **~7 s** with a restart | **~50 s** |
| Use when | almost always | you want the verbose pre-flight and per-step audit trail |

The speed difference is not about doing less work — it is that every ansible
task costs an SSH round trip, and the slowest (overseas) host pays for all of
them. `fleet:git:pull` runs the whole sequence as a single remote shell.

After it, workers are **running** the new code — no waiting for a
[self-update](/backtest/fleet/self-update) to pick it up. Nothing is
restarted when the code did not move, and a machine whose worker is stopped
just gets the code.

```
================ FLEET PULL ================
worker-1  ✅ feat/fleet-status  a6ed241 → c5ec546  worker:restarted
worker-2  ✅ main  c5ec546 → c5ec546  (already current)  worker:running, code unchanged
milan-m1  ✅ main  a6ed241 → c5ec546  deps:installed  worker:not running
```

The drain is graceful: in-flight market jobs finish before the worker
relaunches. A worker that outlasts `pull_drain_seconds` (default 120) is
reported as `DRAIN_TIMEOUT` and left alone rather than killed.

### Switching branches

```bash
npm run fleet:git:pull -- feat/my-branch
npm run fleet:git:pull -- main
```

Because the restart is part of the command, switching works in **any**
direction. That matters: moving *backwards* (feature branch → main) would
otherwise leave workers running the feature code indefinitely — their loaded
commit already contains everything a main-built job needs, so self-update
never fires.

Neither command resets a local branch that already exists (it might hold
unpushed commits) — the branch is checked out and fast-forwarded; only a
branch the machine has never used is created from the fetched remote ref.

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
