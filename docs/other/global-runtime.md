---
title: Global Runtime and Mission Control
description: Run durable file-based missions through fresh Claude Code or Codex CLI sessions.
---

# Global Runtime and Mission Control

Global Runtime is a small local daemon for long-running AI missions. A loop launches one fresh CLI session at a time, persists lifecycle metadata in MySQL, and relies on workspace files for mission memory and human communication. Mission Control is the dashboard UI for creating, observing, steering, pausing, resuming, and stopping those loops.

It uses the existing Claude Code and Codex CLI subscription logins. It does not call model APIs, coordinate models, choose research work, manage Git, or contain trading-specific behavior.

## Architecture

```text
Dashboard /mission-control
          |
          | local Next.js proxy
          v
Global Runtime :3053 ---- runtime_runs / runtime_sessions (MySQL)
          |
          +---- Claude Code CLI ---- workspace A
          +---- Codex CLI --------- workspace B

Each workspace contains:
MISSION.md     agent's assignment
STATUS.md      current state and questions
JOURNAL.md     append-only milestone history
INBOX.md       append-only user steering
.global-runtime/session-result.json
```

Different loops may run concurrently, but active loops cannot share a canonical workspace path. Sessions within one loop are always sequential and fresh; continuity comes from files, not CLI conversation history.

## The contracts

### 1. Global Runtime contract

Each loop has a provider, model, effort, access mode, workspace, mission path, maximum session count, session delay, and files shown by Mission Control. The runtime owns process lifecycle only:

- launch a fresh CLI process in the configured workspace;
- register process lifecycle and stdio handlers before persisting the PID, then record session status, timestamps, heartbeat, token usage, summary, and errors;
- launch the next session only after `continue`;
- apply pause after the active session, stop immediately, and resume with a fresh session;
- keep one active owner per workspace;
- retry quota-limited sessions after `GLOBAL_RUNTIME_RATE_LIMIT_RETRY_SECONDS`;
- reconcile interrupted sessions to `waiting` after an unclean daemon restart.

The runtime never interprets the mission domain.

### 2. Session completion contract

Before exit, every agent writes `.global-runtime/session-result.json`:

```json
{
  "action": "continue",
  "summary": "Finished evaluating the first hypothesis."
}
```

The file must contain only `action` and `summary`. Actions are:

| Action | Meaning |
| --- | --- |
| `continue` | Start the next fresh session after the configured delay. |
| `complete` | The mission is finished. |
| `wait` | Human input or an external change is required. |

The runtime deletes the previous result before every session. A missing, malformed, or schema-invalid result safely moves the loop to `waiting`; it never guesses that work should continue.

Claude and Codex are also asked to return the same object as structured final output. That output is retained for diagnostics, while the workspace control file is the lifecycle authority.

### 3. Human communication contract

These three files are sufficient for communication across any number of fresh sessions:

- `STATUS.md`: the agent rewrites this concise snapshot with current work, completed work, next step, blockers, a `Needs human` section, and `Inbox processed through: <entry-id>`.
- `JOURNAL.md`: the agent appends short milestone entries. It must not paste raw CLI output.
- `INBOX.md`: Mission Control appends timestamped, uniquely identified user messages. Agents read new entries but never edit this file.

Inbox appends are performed through a verified file handle. The runtime rejects paths that escape the canonical workspace, dangling final symlinks, non-regular files, and files that change while they are being opened.

For steering, write the instruction in Mission Control. The active or next session reads `INBOX.md`, applies entries newer than the marker in `STATUS.md`, and advances that marker. If an answer is required before useful work can continue, the agent writes the question under `Needs human` and returns `wait`.

Mission 0.1, Mission 0.2, and later loops use this same contract. Their mission files define their work; the runtime and Mission Control do not need mission-specific communication protocols.

### 4. Mission Control contract

Mission Control communicates with the daemon through its localhost API. It may create and control loops, display persisted runtime/session state, read configured workspace files, and append inbox entries. It does not edit `STATUS.md`, `JOURNAL.md`, mission files, or result files.

## Setup

Requirements:

- Node.js 20;
- the repository's MySQL connection variables;
- installed and logged-in `claude` and/or `codex` CLIs;
- a separate workspace or Git worktree for every simultaneously active loop.

Apply the two-table migration and start both processes:

```bash
npm run db:migrate
npm run global-runtime

# second terminal
npm run dashboard
```

Open `http://127.0.0.1:3051/mission-control`. Create a loop, verify the resolved workspace and mission file, then press **Start**.

The runtime binds to `127.0.0.1:3053` by default. The dashboard proxies requests server-side, so browsers never call the daemon directly.

## Subscription profiles

With no `authHome`, Claude runs without a `CLAUDE_CONFIG_DIR` override and uses the same login as a normal terminal command. To select a separate subscription profile, set the loop's optional auth home:

- Claude Code: the runtime sets `CLAUDE_CONFIG_DIR` to the configured directory.
- Codex: the runtime sets `CODEX_HOME` to the configured directory.

The directory must already contain a valid CLI login. Runtime configuration stores only its path; it does not copy or expose credentials. `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `--no-session-persistence`, and Codex `--ephemeral` keep continuity under the workspace contract instead of hidden provider memory.

## State transitions

```text
idle --start--> running --continue--> running
                     |--complete----> completed
                     |--wait--------> waiting --resume--> running
                     |--pause-------> paused  --resume--> running
                     |--quota-------> rate_limited --retry--> running
                     |--failure-----> error --resume--> running
                     |--stop--------> stopped --resume--> running
```

Pause does not terminate an active session; it prevents the next session. Stop sends `SIGTERM` to the CLI process group and escalates to `SIGKILL` after five seconds if needed.

## Persistence and logs

Only two tables are added:

- `runtime_runs`: configuration and current loop state;
- `runtime_sessions`: one row per CLI invocation, including result and token usage.

Starting a session inserts its session row and advances `runtime_runs.current_session` in the same database transaction. The result-file path is prepared before that transaction, so a filesystem preparation failure does not consume a session number or make the loop unresumable.

Human-readable progress remains in workspace files. Raw JSONL and stderr are stored under `logs/global-runtime/run-<id>/` and are not exposed as a browser terminal or log viewer.

The provider adapter waits for the child process `close` event before final parsing, ensuring stdout and stderr have closed and their final events have been captured even when a CLI exits while PID persistence is still pending.

## Recovery and troubleshooting

| Symptom | Behavior / fix |
| --- | --- |
| Runtime was killed during a session | On startup the session becomes `failed` and the loop becomes `waiting`. Review files and resume. |
| Result file missing or invalid | The session becomes `invalid_result` and the loop waits. Fix the mission/agent behavior, then resume. |
| Workspace already locked | Stop or pause the active owner, or use a different worktree. |
| Provider quota reached | The loop shows `rate_limited` and retries automatically. Pause or stop if no retry is wanted. |
| CLI binary not found or login expired | The loop becomes `error`. Repair the CLI installation/login and resume. |
| Inbox path is rejected | Replace dangling symlinks or non-regular files with a regular inbox file inside the workspace. |
| Result path cannot be prepared | Repair `.global-runtime/` and resume. No session number is consumed by the failed preparation. |
| Dashboard says runtime unavailable | Start `npm run global-runtime` and verify `GLOBAL_RUNTIME_URL`. |
| Session limit reached | The loop waits rather than extending itself. Create a larger loop or deliberately change the mission plan. |

## Explicit V1 boundaries

Global Runtime does not provide model cooperation, consensus, shared model memory, research scheduling, automatic synthesis, Git automation, direct API calls, exact subscription cost, multi-host execution, or a browser terminal. Those capabilities can be built as missions on top of these contracts without changing the runtime lifecycle.
