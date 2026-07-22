---
title: Stop the Fleet
description: Stop the managed backtest worker session on every machine — graceful drain first, force only if a worker outlasts the grace period.
---

# Stop the Fleet

```bash
npm run fleet:stop
```

Stops the managed tmux session (`polymarket-backtest-worker`) on every host
in `ops/ansible/inventory.ini`. The converter session
(`polymarket-telonex-converter`) is **not** touched — it has its own
lifecycle.

## What it does per machine

1. **Managed session** — sends `Ctrl-C` to the worker session. The worker
   **drains**: it finishes the market jobs already in flight and stops
   claiming new ones, so no BullMQ locks are left to expire.
   `run-worker.sh` forwards the signal and then exits its self-update loop.
2. **Unmanaged workers** — a worker started outside that session (e.g.
   `npm run worker:markets` typed over ssh) is still a worker, so it gets a
   `SIGTERM`, which drains it exactly the same way. Reported as
   `stopped (drained, unmanaged process)`.
3. Waits up to `stop_grace_seconds` (default **120**) for everything to
   exit on its own.
4. Anything still alive after the grace period is killed — and said so, so
   an interrupted job is never silently hidden.

Each machine ends up in exactly one state:

```
================ FLEET STOP ================
worker-1  ✅ stopped (drained)
worker-2  ➖ was not running
milan-m1  🔴 killed after grace period — a job may have been interrupted
```

`⚠️ unreachable` appears for hosts that could not be reached; the others
still stop.

## Options

```bash
# only some machines
npm run fleet:stop -- --limit worker-1

# a long-running job needs more time to finish
npm run fleet:stop -- -e stop_grace_seconds=300

# emergency: kill immediately, no drain (reported as ⚠️ killed)
npm run fleet:stop -- -e stop_force=true
```

Typical use: stop the fleet before a heavy maintenance task (a large
conversion fan-out that wants the cores), then bring it back with
[`npm run fleet:start`](/backtest/fleet/start).

## See also

- [Start the Fleet](/backtest/fleet/start) — `npm run fleet:start`
- [Fleet Status](/backtest/fleet/status) — check what is running
