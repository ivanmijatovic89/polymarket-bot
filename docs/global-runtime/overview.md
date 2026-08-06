---
title: Global Runtime and Mission Control
description: Run durable file-based missions through fresh Claude Code or Codex CLI sessions.
---

# Global Runtime and Mission Control

Global Runtime is a small daemon for long-running AI missions. A loop launches one fresh CLI session at a time, persists lifecycle metadata in MySQL, and relies on workspace files for mission memory and human communication. Mission Control is the dashboard UI for creating, observing, steering, pausing, resuming, and stopping those loops — on every machine in the fleet, from one place.

It uses the existing Claude Code and Codex CLI subscription logins. It does not call model APIs, coordinate models, choose research work, manage Git, or contain trading-specific behavior.

## Architecture

One Global Runtime daemon runs **per machine**; all daemons share the fleet's MySQL. Every run is stamped with the `machineId` of the daemon that created it and is owned by that machine forever — a daemon never adopts, recovers, or signals another machine's runs.

```text
Dashboard /mission-control  (one instance, any machine)
     |                    \
     | reads: shared MySQL \ commands: HTTP over Tailscale (bearer token)
     v                      v
runtime_runs / runtime_sessions      Global Runtime :3053 on m1-ivan
  (every machine's history)          Global Runtime :3053 on worker-1
                                     ... one daemon per machines.json runtimeUrl
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

Mission Control reads run history straight from the database, so lists and detail pages stay browsable while an owning machine is asleep; commands (create/start/stop/steer) and live workspace-file reads are forwarded to the owning machine's daemon and fail with a named 503 when it is offline. Machines are declared in `dashboard/src/data/machines.json` — an entry with a `runtimeUrl` (raw Tailscale IP, e.g. `http://100.107.149.100:3053`) is a Mission Control target.

Different loops may run concurrently inside one daemon, but active loops on the **same machine** cannot use equal or nested canonical workspace paths (the same path on two different machines is two different filesystems and does not conflict). A per-machine database advisory lease prevents a second daemon from starting on the same machine; a silently dead holder (sleep, kernel panic) is reaped by the lease connection's five-minute session timeout, so a restarted daemon waits at most ~5.5 minutes (`GLOBAL_RUNTIME_LEASE_WAIT_SECONDS`). Sessions within one loop are always sequential and fresh; continuity comes from files, not CLI conversation history.

Daemons that bind a tailnet address require a shared bearer token (`GLOBAL_RUNTIME_TOKEN`); the daemon refuses to bind a non-loopback host without one, and `/health` is the only unauthenticated route. The token lives in each machine's `.env` and on the dashboard host — it is never shipped to browsers.

## The contracts

### 1. Global Runtime contract

Each loop has a provider, model, effort, access mode, workspace, mission path, maximum session count, session delay, and files shown by Mission Control. The runtime owns process lifecycle only:

- launch a fresh CLI process in the configured workspace;
- register process lifecycle and stdio handlers before persisting the PID, then record session status, timestamps, heartbeat, token usage, summary, and errors;
- launch the next session only after `continue`;
- apply pause after the active session, stop immediately, and resume with a fresh session;
- keep one active owner per workspace;
- retry quota-limited sessions after `GLOBAL_RUNTIME_RATE_LIMIT_RETRY_SECONDS`;
- verify a runtime identity token before terminating a recorded provider process group, then reconcile interrupted sessions to `waiting` after an unclean daemon restart.

The runtime never interprets the mission domain.

`workspace-write` is enforced through each provider's native isolation. Codex receives
`--sandbox workspace-write`; Claude's Bash subprocesses receive command-line OS sandbox settings
that fail closed when sandboxing is unavailable and disallow unsandboxed command retries, while its
built-in file tools retain their working-directory boundary. `full-access` remains an explicit
operator choice.

`workspace-write` bounds **writes**, not reads: sessions can still read files outside the
workspace, so a workspace nested inside a larger repository exposes the surrounding code to the
mission. If the mission must not consult its surroundings, state that in the mission file (the
shared-loop example's "Do not inspect the parent repository" line exists for this reason).

For full read *and* write isolation, a run can set `sandboxSettingsPath` — the absolute path (on
the owning machine) of an [`@anthropic-ai/sandbox-runtime`](https://github.com/anthropics/sandbox-runtime)
settings file. The daemon then launches every session wrapped in `srt --settings <path>`: the OS
sandbox (macOS Seatbelt) is the isolation boundary, sibling directories are invisible, and network
access follows the settings file's domain allowlist. Because sandboxed processes cannot open raw
TCP to remote hosts, the daemon hosts its own loopback forwarders to MySQL and Redis on ephemeral
ports and rewrites each session's `DATABASE_HOST`/`DATABASE_PORT`/`REDIS_URL` to them. The ports
are daemon-owned rather than well-known so no other local process can claim them first and sit in
the middle of a session's database traffic.

::: warning
Whether a session can actually use those forwarders depends on the settings file: the sandbox must
permit loopback egress (`network.allowLocalBinding`). Verify it with your own settings before a
mission relies on database access — a sandbox that denies loopback simply leaves the forwarders
unused, and the session fails with `EPERM` when it tries to connect. Missions that only read and
write workspace files are unaffected either way.
:::

The provider CLIs'
own sandboxes are disabled inside srt (Seatbelt does not nest): Claude runs with
`--permission-mode bypassPermissions` and no inline seatbelt settings, Codex with
`--sandbox danger-full-access` — srt is the boundary. The settings path is validated at run
creation and must be a readable file on the owning machine.

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

Inbox appends are performed through a verified file handle. The runtime rejects paths that escape the canonical workspace, dangling final symlinks, hard-linked files, non-regular files, and files that change while they are being opened.

Mission, status, journal, inbox, and additional read-only paths must resolve to distinct files. None may use the reserved `.global-runtime/session-result.json` control path.

Run creation can set `isolatedStateFiles: true` instead of supplying explicit status, journal, and inbox paths. Global Runtime then generates one server-owned directory under `.global-runtime/runs/` for all three files. The isolation option cannot be combined with explicit state-file paths.

For steering, write the instruction in Mission Control. The active or next session reads `INBOX.md`, applies entries newer than the marker in `STATUS.md`, and advances that marker. If an answer is required before useful work can continue, the agent writes the question under `Needs human` and returns `wait`.

Mission 0.1, Mission 0.2, and later loops use this same contract. Their mission files define their work; the runtime and Mission Control do not need mission-specific communication protocols.

### 4. Mission Control contract

Mission Control communicates with the daemon through its localhost API. It may create and control loops, display persisted runtime/session state, read configured workspace files, and append inbox entries. It does not edit `STATUS.md`, `JOURNAL.md`, mission files, or result files.

Both the run list and run detail page show the selected account, requested and resolved model, wall-clock duration, uncached input, cache reads, cache writes, output, reasoning tokens, and estimated API-equivalent cost. Claude supplies `total_cost_usd` directly in its result event. Codex JSONL supplies token counts but no cost field or per-request context sizes, so the runtime estimates known GPT-5.6 models from their published standard token prices. Long-context pricing may differ. Subscription users are not necessarily charged that amount; it is a comparison estimate.

Cache counters are cumulative across every provider turn in a session. A session that makes ten model turns can report roughly ten reads of the same cached system/tool prefix. Cache reads therefore do not represent the size of one unique prompt.

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

Open `http://127.0.0.1:3051/mission-control`. Pick a machine, create a loop, verify the resolved workspace and mission file, then press **Start**.

Loops can also be created and controlled from the terminal with the [Mission CLI](/global-runtime/cli) (`npm run mission`), which resolves the same machine catalog and daemon APIs.

The daemon refuses to start on a machine that is not registered in `dashboard/src/data/machines.json`. It binds `127.0.0.1:3053` by default; set `GLOBAL_RUNTIME_HOST` to the machine's Tailscale IP (plus `GLOBAL_RUNTIME_TOKEN`) to make it reachable from Mission Control on another machine. The dashboard proxies requests server-side, so browsers never call daemons directly. See [Fleet installation](/global-runtime/fleet) for the multi-machine rollout runbook.

## Subscription profiles

With no `authHome`, Claude runs without a `CLAUDE_CONFIG_DIR` override and uses the same login as a normal terminal command. To select a separate subscription profile, set the loop's optional auth home:

- Claude Code: the runtime sets `CLAUDE_CONFIG_DIR` to the configured directory.
- Codex: the runtime sets `CODEX_HOME` to the configured directory.

The directory must already contain a valid CLI login. Runtime configuration stores only its path; it does not copy or expose credentials. Provider processes receive a minimal system environment rather than the daemon's full `.env`, so trading keys, database credentials, and storage credentials are not exposed to missions. `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `--no-session-persistence`, and Codex `--ephemeral` keep continuity under the workspace contract instead of hidden provider memory.

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

Pause does not terminate an active session; it prevents the next session. Stop sends `SIGTERM` to the CLI process group and escalates to `SIGKILL` after five seconds if needed. The stop request completes and the loop becomes `stopped` only after the provider task exits. Until then the persisted run remains active and recoverable, so an unclean daemon restart can still find and terminate the recorded process.

## Persistence and logs

Only two tables are added:

- `runtime_runs`: configuration and current loop state;
- `runtime_sessions`: one row per CLI invocation, including result, exact model, token/cache breakdown, estimated API-equivalent cost, the exact rendered session prompt, the contract version, and a SHA-256 hash of the mission file at session start.

The session prompt is rendered from the template in `src/global-runtime/session-contract.md`; edit that Markdown file (not code) to change the contract wording. The template is read once per session rather than cached at startup, so an edit applies to the next session a running daemon launches.

The file declares its own version in a leading marker, and that number is what lands in `runtime_sessions.contract_version`:

```markdown
<!-- contract-version: 1 -->
```

Bump it in the same edit that changes the wording, so sessions rendered from different contract texts stay distinguishable in the database. A missing or malformed marker, or a `{{placeholder}}` the renderer does not provide, fails the session loudly instead of shipping a half-rendered prompt to the provider.

Starting a session inserts its session row and advances `runtime_runs.current_session` in the same database transaction. The result-file path is prepared before that transaction, so a filesystem preparation failure does not consume a session number or make the loop unresumable.

Human-readable progress remains in workspace files. Raw JSONL and stderr are stored under `logs/global-runtime/run-<id>/` and are not exposed as a browser terminal or log viewer. Provider stdout and stderr respect file-stream backpressure so verbose sessions cannot create an unbounded in-memory log queue. A log stream failure stops the provider and records a controlled session error instead of crashing the daemon.

Runtime-owned schema and log artifacts are created exclusively with private file permissions.
Pre-existing files and symbolic links are rejected instead of followed, so a mission cannot redirect
the daemon's writes through a predictable artifact path.

The provider adapter waits for the child process `close` event before final parsing, ensuring stdout and stderr have closed and their final events have been captured even when a CLI exits while PID persistence is still pending.

## Recovery and troubleshooting

| Symptom | Behavior / fix |
| --- | --- |
| Runtime was killed during a session | Every launched provider carries a run/session identity token. On startup the runtime terminates the recorded process group only when that token still matches, then marks the session `failed` and the loop `waiting`. If identity cannot be verified, the process is not signaled and Mission Control asks the operator to confirm that no old provider remains before resuming. |
| Database lease connection was lost | The daemon immediately becomes unready, stops active sessions, closes its API and database pool, and exits unsuccessfully so a process supervisor can restart it. |
| Result file missing or invalid | The session becomes `invalid_result` and the loop waits. Fix the mission/agent behavior, then resume. |
| Workspace already locked | Stop or pause the active owner, or use a different worktree. |
| Provider quota reached | The loop shows `rate_limited` and retries automatically. Pause or stop if no retry is wanted. |
| CLI binary not found or login expired | The loop becomes `error`. Repair the CLI installation/login and resume. |
| Inbox path is rejected | Replace dangling symlinks or non-regular files with a regular inbox file inside the workspace. |
| Result path cannot be prepared | Repair `.global-runtime/` and resume. No session number is consumed by the failed preparation. |
| Dashboard says a machine is unreachable | Its daemon is down or the machine is offline/asleep. History stays browsable from the database; start the daemon on that machine (`npm run global-runtime`, or `npm run fleet:runtime:start`) to command it again. |
| Command answered with 409 "run N belongs to …" | The run is owned by another machine's daemon — ownership is stamped at creation and never moves. Send the command to the owning machine (Mission Control and the CLI route this automatically; a 409 usually means a stale `machines.json` mapping). |
| Run refuses to start: "workspace … overlaps the runtime log root" | The launch anchors that pin each run's immutable settings live under the log root, so a session that could write there could disarm its own pin. A mission whose workspace contains the daemon's `logs/global-runtime` (for example a workspace that IS the engine repo) is refused — point `GLOBAL_RUNTIME_LOG_DIR` outside the workspace (moving the existing `anchors/` directory with it, or every other run on that daemon loses its pin) and start it again. |
| Run refuses to start: "sandbox settings file … changed" | The srt settings file the run was launched with has different contents now. If you changed it on purpose, stop the daemon and update `sandboxSettingsSha256` in that run's anchor (or start a new run); otherwise treat it as tampering. |
| Run refuses to start: "immutable … changed since it was first launched" | The run's pinned launch settings (`provider`, `model`, `accessMode`, `authHome`, `workspacePath`, `sandboxSettingsPath`) differ from the anchor recorded at its first launch, so the row was edited outside Mission Control. Treat it as tampering until proven otherwise. To accept the new configuration deliberately: stop the daemon, edit that run's file under `logs/global-runtime/anchors/` to match (including `sandboxSettingsSha256`), and restart. **Deleting the anchor is not a recovery** — a run that has already started refuses to launch without one. Creating a fresh run is usually the safer answer. |
| Run refuses to start: "launch anchor … is unreadable" | The anchor is corrupt, truncated, or missing for a run that already started. Restore it from a backup, or stop the daemon and hand-write it (the five pinned fields plus `sandboxSettingsSha256`, the SHA-256 of the settings file) after confirming the run's configuration is legitimate. |
| Command answered with 401 | The daemon requires `GLOBAL_RUNTIME_TOKEN` and the caller sent none or a wrong one. Set the same token on the dashboard host / CLI machine as in the daemon's `.env`. |
| Session limit reached | The loop waits rather than extending itself. Press **Extend** in Mission Control (or `POST /runs/:id/extend` with a higher `maxSessions`), then resume; sessions continue in the same run. Extend raises the ceiling only — a run whose agent already returned `complete` is finished and cannot be extended. |

## Explicit V1 boundaries

Global Runtime does not provide model cooperation, consensus, shared model memory, research scheduling, automatic synthesis, Git automation, direct API calls, actual subscription billing, or a browser terminal. There is also no cross-machine reconciler: if a machine dies permanently, its `running` rows stay `running` until an operator intervenes on that machine (visible in Mission Control through heartbeat staleness and the offline chip). Those capabilities can be built as missions on top of these contracts without changing the runtime lifecycle.
