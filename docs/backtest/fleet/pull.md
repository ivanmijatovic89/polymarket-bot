---
title: Pull Code
description: Pull new code onto every fleet machine and restart the workers onto it — one remote shell per host, seconds instead of a minute.
---

# Pull Code (`fleet:git:pull`)

```bash
npm run fleet:git:pull                       # pull the branch each worker is on
npm run fleet:git:pull -- feat/my-branch     # switch the fleet to a branch, then pull
npm run fleet:git:pull -- main --limit worker-1
```

Per machine, in a single remote shell: `git fetch` → optional branch switch →
`git merge --ff-only` → `npm install` **only if the lockfile moved** →
graceful drain + restart of the worker **only if the code actually changed**.

## Speed, measured on a three-machine fleet with one overseas host

| | `npm run fleet:git:pull` | [`npm run fleet:update`](/backtest/fleet/update) |
| --- | --- | --- |
| Round trips | **one shell per machine** | ~19 ansible tasks per machine |
| Takes | **~4 s** idle, **~7 s** with a restart | **~50 s** |
| Extra | — | repo/dirty/fast-forward pre-checks, per-step reporting |
| Use when | almost always | something is wrong and you need to see which step failed |

The speed difference is not about doing less work — it is that every ansible
task costs an SSH round trip, and the slowest (overseas) host pays for all of
them. `fleet:git:pull` runs the whole sequence as a single remote shell.

After it, workers are **running** the new code — no waiting for a
[self-update](/backtest/fleet/self-update) to pick it up. Nothing is
restarted when the code did not move, and a machine whose worker is stopped
just gets the code.

```
================ FLEET PULL ================
worker-1  ✅    7s  feat/fleet-status  a6ed241 → c5ec546  worker:restarted
worker-2  ✅    1s  main  c5ec546 → c5ec546  (already current)  worker:running, code unchanged
milan-m1  ✅   24s  main  a6ed241 → c5ec546  deps:installed  worker:not running
```

The column after the check mark is that machine's own elapsed time, so a
slow host is visible immediately (the wrapper's total is printed at the very
end).

The drain is graceful: in-flight market jobs finish before the worker
relaunches. A worker that outlasts `pull_drain_seconds` (default 120) is
reported as `DRAIN_TIMEOUT` and left alone rather than killed.

## Switching branches

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

## See also

- [Update Fleet](/backtest/fleet/update) — the verbose, per-step variant
- [Fleet Status](/backtest/fleet/status) — confirm which commit each worker loaded
- [Self-Update](/backtest/fleet/self-update) — how a worker adopts newer code on its own
