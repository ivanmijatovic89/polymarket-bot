---
title: Mission CLI
description: Terminal reference for creating and controlling Global Runtime loops.
---

# Mission CLI

`npm run mission` is a thin terminal client for the fleet's Global Runtime daemons (one per machine — see the [overview](/global-runtime/overview#architecture)). It calls the same APIs Mission Control uses; it never manages provider processes itself, so each daemon remains the single owner of its loops.

`create` targets a machine: `--machine <name|id>` from `dashboard/src/data/machines.json`, defaulting to the machine the command runs on (which then must have a `runtimeUrl` there). Per-run commands look the run's owning machine up in the shared database and talk to that machine's daemon over the tailnet; `list` reads the database directly, so it works even while daemons are offline. When daemons require auth, set `GLOBAL_RUNTIME_TOKEN` in the shell or `.env`. If a catalog has no `runtimeUrl` entries at all, everything falls back to `GLOBAL_RUNTIME_URL` (default `http://127.0.0.1:3053`).

The owning daemon must be running for commands (not for `list`):

```bash
npm run global-runtime
```

## Commands

| Command | Effect |
| --- | --- |
| `create` | Create a loop from flags on the target machine. Prints the new id; add `--start` to launch immediately. |
| `list` | All loops across all machines (from the database) with status, machine, provider, model, and session count. |
| `show <id>` | One loop in detail, including its session table. |
| `start <id>` | Start an idle loop. |
| `pause <id>` | Let the active session finish, then hold before the next one. |
| `resume <id>` | Continue a paused, waiting, rate-limited, stopped, or errored loop with a fresh session. |
| `stop <id>` | Terminate the active session's process group and stop the loop. |
| `extend <id>` | Raise `maxSessions` on the same run (`--max-sessions <n>`, raise-only). |
| `inbox <id> <message>` | Append a steering message to the loop's inbox file. |

`list` and `show` accept `--json` for scripting.

## Creating a loop

```bash
npm run mission -- create \
  --name "Research mission" \
  --provider claude \
  --model claude-opus-5 \
  --workspace ~/worktrees/research-a \
  --max-sessions 10 \
  --isolated \
  --start
```

Required flags: `--name`, `--provider` (`claude` or `codex`), `--model`, `--workspace`, `--max-sessions`.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--machine <name|id>` | this machine | Which machine's daemon creates (and owns) the loop — a `machines.json` name (`worker-1`) or 12-hex id. |
| `--sandbox-settings <path>` | none | Absolute path (on the owning machine) to an srt settings file; sessions then run inside the OS sandbox with DB/Redis tunneled — see the [overview](/global-runtime/overview#_1-global-runtime-contract). |
| `--mission <path>` | `MISSION.md` | Mission file, relative to the workspace. |
| `--effort <level>` | `high` | `low`–`max` plus `ultracode` (xhigh + workflow orchestration) for Claude; Codex accepts `low`–`ultra`. |
| `--access <mode>` | `workspace-write` | `full-access` maps to the provider's unrestricted mode. |
| `--auth-home <dir>` | provider default login | Sets `CLAUDE_CONFIG_DIR` / `CODEX_HOME` for a separate subscription profile. |
| `--delay <seconds>` | `20` | Pause between sessions. |
| `--isolated` | off | Server-generated status/journal/inbox paths under `.global-runtime/runs/`. |
| `--read-only <path>` | none | Extra file shown read-only in Mission Control; repeat the flag per file. |
| `--status-file`, `--journal-file`, `--inbox-file` | `STATUS.md`, `JOURNAL.md`, `INBOX.md` | Explicit state-file paths; not combinable with `--isolated`. |
| `--start` | off | Start the loop right after creating it. |

`--workspace` is resolved to an absolute path before it is sent, relative to the directory the command was run in (`npm run` moves the process to the repository root, so the CLI reads npm's `INIT_CWD` to recover the caller's directory). The printed `workspace:` line is the path the daemon received — check it before starting a loop. Validation happens in the daemon; invalid combinations return the same errors the dashboard shows.

## Continuing a capped loop

When a loop reaches its session limit it moves to `waiting` with "Session limit reached". Raise the limit and resume; the sessions continue on the same run, so history and metrics stay in one place:

```bash
npm run mission -- extend 12 --max-sessions 20
npm run mission -- resume 12
```

`extend` raises the session **ceiling**; it does not add work. A running loop keeps going only while the agent returns `continue` — once it returns `complete`, the run finishes regardless of how much allowance remains, and a completed run cannot be extended. Extending mid-run is safe: the loop re-reads the limit after every session, so the next session's prompt already states the new maximum (the [loop example](/global-runtime/examples) demonstrates this).

## Steering a running mission

```bash
npm run mission -- inbox 12 "Focus on the second hypothesis first."
```

The message is appended to the loop's inbox file with a timestamped id. The active or next session reads entries newer than the marker in the status file, exactly as described in the [communication contract](/global-runtime/overview#_3-human-communication-contract).

::: tip
Loop configuration can be kept as a small shell script per mission (a `create` invocation with all flags), which makes launches repeatable and reviewable in Git.
:::
