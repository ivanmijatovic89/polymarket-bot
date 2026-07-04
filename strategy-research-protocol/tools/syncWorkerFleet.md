# Tool: syncWorkerFleet

## Purpose

Fast-forward remote backtest worker checkouts to the pushed `main` commit
before submitting research backtests.

## Use When

- After the Researcher commits and pushes research code to `main`.
- Before submitting smoke or evidence runs that may be consumed by remote
  workers.
- Before extending a run when remote workers may be behind the current pushed
  commit and you want to avoid lazy self-update delays.

## Do Not Use When

- The backtest will run only sequentially on the local machine.
- The tree is dirty or the research commit has not been pushed.
- You need to provision a new worker machine.

## Inputs

- Local `ops/ansible/inventory.ini` configured for the active worker fleet.
- Workers tracking the same branch as the protocol branch policy, currently
  `main`.

## Implementation

Current implementation: script

```bash
./scripts/update-worker-fleet.sh
```

## Source Of Truth

- [`docs/backtest/worker-fleet-ansible.md`](../../docs/backtest/worker-fleet-ansible.md)
- [`docs/backtest/worker-self-update.md`](../../docs/backtest/worker-self-update.md)
- [`strategy-research-protocol/RUNNING.md`](../RUNNING.md)

## Output

- Ansible per-host update status.
- Non-zero exit when a worker checkout is dirty, diverged, unreachable, or
  otherwise cannot safely update.

## After Success

- Continue to [`strategy-research-protocol/tools/runBacktest.md`](./runBacktest.md).
- No protocol memory files are updated by this tool.

## If It Fails

- Do not submit remote-worker backtests.
- Fix the worker checkout, inventory, network, or pushed branch state, then run
  the tool again.
