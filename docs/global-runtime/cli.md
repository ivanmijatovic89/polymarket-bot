---
title: Mission CLI
description: Terminal reference for creating and controlling Global Runtime loops.
---

# Mission CLI

`npm run mission` is a thin terminal client for the Global Runtime daemon. It calls the same localhost API that Mission Control uses; it never manages provider processes itself, so the daemon remains the single owner of every loop.

The daemon must already be running:

```bash
npm run global-runtime
```

The daemon URL comes from `GLOBAL_RUNTIME_URL` (default `http://127.0.0.1:3053`). If the daemon is unreachable, every command fails with a hint to start it.

## Commands

| Command | Effect |
| --- | --- |
| `create` | Create a loop from flags. Prints the new id; add `--start` to launch immediately. |
| `list` | All loops with status, provider, model, and session count. |
| `show <id>` | One loop in detail, including its session table. |
| `start <id>` | Start an idle loop. |
| `pause <id>` | Let the active session finish, then hold before the next one. |
| `resume <id>` | Continue a paused, waiting, stopped, or errored loop with a fresh session. |
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
| `--mission <path>` | `MISSION.md` | Mission file, relative to the workspace. |
| `--effort <level>` | `high` | `low`–`max` for Claude; Codex also accepts `ultra`. |
| `--access <mode>` | `workspace-write` | `full-access` maps to the provider's unrestricted mode. |
| `--auth-home <dir>` | provider default login | Sets `CLAUDE_CONFIG_DIR` / `CODEX_HOME` for a separate subscription profile. |
| `--delay <seconds>` | `20` | Pause between sessions. |
| `--isolated` | off | Server-generated status/journal/inbox paths under `.global-runtime/runs/`. |
| `--read-only <path>` | none | Extra file shown read-only in Mission Control; repeat the flag per file. |
| `--status-file`, `--journal-file`, `--inbox-file` | `STATUS.md`, `JOURNAL.md`, `INBOX.md` | Explicit state-file paths; not combinable with `--isolated`. |
| `--start` | off | Start the loop right after creating it. |

The workspace path is resolved to an absolute path before it is sent. Validation happens in the daemon — invalid combinations return the same errors the dashboard shows.

## Continuing a capped loop

When a loop reaches its session limit it moves to `waiting` with "Session limit reached". Raise the limit and resume; the sessions continue on the same run, so history and metrics stay in one place:

```bash
npm run mission -- extend 12 --max-sessions 20
npm run mission -- resume 12
```

## Steering a running mission

```bash
npm run mission -- inbox 12 "Focus on the second hypothesis first."
```

The message is appended to the loop's inbox file with a timestamped id. The active or next session reads entries newer than the marker in the status file, exactly as described in the [communication contract](/global-runtime/overview#_3-human-communication-contract).

::: tip
Loop configuration can be kept as a small shell script per mission (a `create` invocation with all flags), which makes launches repeatable and reviewable in Git.
:::
