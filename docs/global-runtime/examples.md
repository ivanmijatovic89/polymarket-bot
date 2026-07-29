---
title: Global Runtime Loop Example
description: Run one shared session-limit-driven mission with Fable, Opus 5, or GPT-5.6.
---

# Global Runtime loop example

Mission Control provides one small end-to-end mission that can be started with three model configurations. Every model runs the same mission from `examples/global-runtime/shared-loop/MISSION.md`.

| Launcher | Provider    | Model                      |
| -------- | ----------- | -------------------------- |
| Fable    | Claude Code | `claude-fable-5`           |
| Opus 5   | Claude Code | `opus` (latest Opus alias) |
| GPT-5.6  | Codex       | `gpt-5.6-sol`              |

The mission is **session-limit-driven**: each session completes one checkpoint, returns `continue` while sessions remain, and returns `complete` on the final allowed session. The launcher creates the loop with `maxSessions: 3`, so by default it runs three fresh sessions. This verifies that the outer loop starts the next process and that file-based memory survives between sessions.

## Run an example

Start the two local processes if they are not already running:

```bash
npm run global-runtime
npm run dashboard
```

Open `http://127.0.0.1:3051/mission-control`. Under **Shared loop example**, choose the model launcher, select a Claude account when applicable, and click **Start 3-session example**. Mission Control creates the loop with `maxSessions: 3`, starts session 1, and opens its detail page.

Claude examples offer two subscription profiles:

- **Default** leaves `CLAUDE_CONFIG_DIR` unset and uses the same login as a normal `claude` terminal command.
- **Balsa** sets `CLAUDE_CONFIG_DIR=~/.claude-balsa` for that CLI process.

The GPT-5.6 example uses the normal Codex login (`CODEX_HOME` is not overridden).

## Demonstrate a mid-run extension

Because the mission finishes on the final *allowed* session, it also demonstrates `extend`. While the loop is running (before its last session starts), raise the limit:

```bash
npm run mission -- extend <id> --max-sessions 5
```

The next session's prompt already carries the new maximum, the loop runs past the original limit, and it completes on session 5 with summary `Loop example passed after 5 sessions.` Extending during the final session has no visible effect: that session's prompt was rendered with the old maximum, so the agent completes as instructed. Raising the limit never adds work on its own — a mission that has declared `complete` stays completed.

## Expected result

The loop should reach `completed` after the allowed number of sessions (three by default). The detail page should show:

- one completed session per allowed session, the last returning `complete`;
- duration, exact resolved model, token/cache breakdown, and estimated API-equivalent cost;
- populated `STATUS.md` and `JOURNAL.md`;
- `RESULT.md` listing one passed checkpoint per session.

All launchers use the same workspace and mission. Each launch asks Global Runtime for isolated state files, and the server creates fresh status, journal, and inbox paths under `.global-runtime/runs/`. Steering and memory from an older run therefore cannot leak into a new example. Generated runtime files are ignored by Git. The workspace lock prevents two examples from running at the same time, so wait for one model to finish before starting another.

These are deliberately small tests, but each CLI still loads its normal startup instructions and tool context. Each tool call can cause another model turn that rereads the cached prefix, so cumulative cache-read tokens can be much larger than the mission text. The displayed API-equivalent estimate is useful for model comparison even when the run uses a subscription and is not billed as an API request.
