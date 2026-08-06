---
title: Fleet Installation
description: Runbook for installing one Global Runtime daemon per machine behind a single Mission Control.
---

# Fleet Installation

This guide brings up Global Runtime daemons across the fleet: one daemon per machine, all sharing the fleet's MySQL, all controlled from one Mission Control. Read the [architecture overview](/global-runtime/overview#architecture) first if the ownership model (runs belong to the machine that created them) is unfamiliar.

## Prerequisites

- All machines joined to the same Tailscale tailnet, with reachable raw `100.x` IPs.
- The shared MySQL reachable from every machine (`DATABASE_HOST` in each `.env`).
- The repository cloned and `npm install` run on every machine.

## 0. Upgrade order from the single-daemon era

Pre-#213 daemons took one fleet-wide lease and recovered runs **without a machine filter** — one still running against the migrated database would adopt and terminate other machines' runs. Do this once, in order:

1. Stop every existing Global Runtime daemon in the fleet.
2. Apply the migration against the shared database: `npm run db:migrate`.
3. Update every checkout that might start a daemon (`npm run fleet:git:pull`, and any laptop by hand).
4. Start the per-machine daemons (below).

New daemons refuse to start while the legacy fleet-wide lease is held, so a forgotten old daemon produces a clear error instead of silent damage — but a stale checkout started *after* the new ones will still misbehave, which is why step 3 covers every machine.

::: warning
Old code inserts runs without `machine_id`; after the migration those inserts fail outright. That is intended — it is the loud half of the same version-skew problem.
:::

## 1. Generate and distribute the token

All daemons, the dashboard host, and every CLI machine share one bearer token:

```bash
openssl rand -hex 32
```

Add it to `.env` on **each** of those machines:

```ini
GLOBAL_RUNTIME_TOKEN=<the same value everywhere>
```

Distribution is manual by design — the token never lives in Git or `machines.json`.

::: danger
A daemon bound to a tailnet address without a token would let any process on the tailnet — including sandboxed mission sessions — control runs. The daemon refuses that bind, but do not work around it.
:::

::: danger
**Sandboxed missions must not be able to read the daemon's `.env`.** srt allows reads everywhere by default, so a settings file that does not deny the engine repo's `.env` hands the mission this token — plus `DATABASE_*` and any trading keys. Every sandbox settings file used on a daemon machine needs the engine `.env` under `filesystem.denyRead`, and `chmod 600 .env` is a sensible second layer.
:::

## 2. Register the machine in the catalog

Every daemon machine needs a `runtimeUrl` in `dashboard/src/data/machines.json`, keyed by its machine id:

```json
"527674ef4858": {
  "name": "worker-1",
  "runtimeUrl": "http://100.107.149.100:3053"
}
```

The machine id is printed by any engine command that logs machine identity, or directly:

```bash
npx tsx -e "import('./src/machines/identity.js').then(m => console.log(m.getMachineId()))"
```

A machine without a `runtimeUrl` is invisible to Mission Control's machine picker; a machine missing from the catalog entirely refuses to start a daemon at all. Commit the catalog change and `fleet:git:pull` so every checkout agrees.

## 3. Log in the provider CLIs

Each machine runs missions under its **own** CLI logins. On every daemon machine:

```bash
claude   # complete the interactive login, then exit
codex    # if Codex missions will run here
```

::: warning
This step cannot be automated — subscription logins are interactive and per-user. On worker-1 this is the one manual step of the rollout. Verify with `claude --version` and a trivial prompt before starting missions.
:::

## 4. Configure and start the daemon

In the machine's `.env`, bind the daemon to its Tailscale IP:

```ini
GLOBAL_RUNTIME_HOST=100.107.149.100   # this machine's tailnet IP
GLOBAL_RUNTIME_TOKEN=<shared token>
```

Then start it:

::: code-group

```bash [manually (tmux)]
tmux new-session -d -s polymarket-global-runtime 'npm run global-runtime'
```

```bash [via ansible]
# Machines flagged global_runtime_enabled=true in ops/ansible/inventory.ini
npm run fleet:runtime:start
```

```bash [at boot (launchd)]
# Always-on machines (Mac minis). Renders and installs the plist + boot helper.
./ops/macos/global-runtime/install.zsh --user worker-1
```

:::

The startup log confirms identity and bind: `worker-1 (527674ef4858) listening on http://100.107.149.100:3053 [bearer auth]`.

Verify from the dashboard host:

```bash
curl http://100.107.149.100:3053/health
```

## 5. Verify from Mission Control

The dashboard's Mission Control API requires the shared token (`MISSION_CONTROL_TOKEN`, falling back to `GLOBAL_RUNTIME_TOKEN`), because loopback alone is not a boundary — a sandboxed mission session runs on the same host and can reach loopback ports. Unlock a browser once per machine by visiting `http://127.0.0.1:3051/mission-control/unlock?token=<the token>`; the token is then stored in an httpOnly cookie that page scripts and other local processes cannot read. Scripts can send the `x-mission-control-token` header instead.

Keep the dashboard on loopback and reach it remotely through an **SSH tunnel** (`ssh -L 3051:127.0.0.1:3051 <host>`), which preserves the loopback `Host` the guard requires. `tailscale serve` forwards its own MagicDNS `Host` and is rejected by design.

On the dashboard host (which also needs `GLOBAL_RUNTIME_TOKEN` in its `.env`), open `http://127.0.0.1:3051/mission-control`:

1. The machine-health strip shows a green chip for the new machine.
2. The **New loop** form lists it in the Machine picker.
3. Create a throwaway smoke loop on it (the `smoke/` protocol in the external protocols repo is made for this), start it, steer it once via the inbox, and stop it.

Or from any machine with the CLI:

```bash
npm run mission -- create --machine worker-1 --name "smoke" \
  --provider claude --model claude-haiku-4-5 --workspace /path/to/smoke \
  --max-sessions 2 --isolated --start
npm run mission -- list
```

## Rollout order

Bring machines up one at a time, verifying step 5 after each: first the dashboard host (m1-ivan), then worker-1, then the remaining machines as needed. Nothing coordinates between daemons at startup, so order only matters for verification convenience.

## Operating the fleet

| Task | Command |
| --- | --- |
| Daemon status everywhere | `npm run fleet:runtime:status` |
| Start daemons | `npm run fleet:runtime:start` |
| Stop daemons (graceful) | `npm run fleet:runtime:stop` |
| Attach to a daemon | `tmux attach -t polymarket-global-runtime` on the machine |

The ansible plays only touch hosts with `global_runtime_enabled=true` in `ops/ansible/inventory.ini`.

::: tip
A machine that goes offline keeps its runs: Mission Control still shows their history from the database, marked with an offline chip. Commands resume working the moment the daemon is back — nothing needs re-registering.
:::

## Known operational behavior

- **Laptop sleep ends a run.** The lease connection is reaped after five minutes of silence, so a daemon whose machine sleeps longer than that shuts itself down on wake and its active session ends in `error`. Resume it from Mission Control. Long unattended loops belong on an always-on machine.
- **Logs are not rotated.** `logs/global-runtime/daemon.log`, `boot.log`, and the per-session `run-*/session-*.jsonl` files grow until removed; prune those periodically on always-on machines. Do **not** delete `logs/global-runtime/anchors/` — those files pin each run's immutable launch settings, and a run whose anchor is missing refuses to start rather than silently re-pinning.
- **Sandbox tunnels use ephemeral ports.** The daemon opens its own loopback forwarders per process and passes those ports to each sandboxed session, so it never collides with (or trusts) the fixed 13306/16379 forwarders a manual `run.sh` may hold.
