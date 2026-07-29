---
title: Global Runtime Loop Example
description: Run one shared three-session mission with Fable, Opus 4.8, Opus 5, or GPT-5.6.
---

# Global Runtime loop example

Mission Control provides one small end-to-end mission that can be started with four model configurations. Every model runs the same mission from `examples/global-runtime/shared-loop/MISSION.md`.

| Launcher | Provider    | Model                      |
| -------- | ----------- | -------------------------- |
| Fable    | Claude Code | `claude-fable-5`           |
| Opus 4.8 | Claude Code | `claude-opus-4-8`          |
| Opus 5   | Claude Code | `opus` (latest Opus alias) |
| GPT-5.6  | Codex       | `gpt-5.6`                  |

The mission intentionally requires three fresh sessions. Sessions 1 and 2 return `continue`; session 3 returns `complete`. This verifies that the outer loop starts the next process and that file-based memory survives between sessions.

## Run an example

Start the two local processes if they are not already running:

```bash
npm run global-runtime
npm run dashboard
```

Open `http://127.0.0.1:3051/mission-control`. Under **Shared loop example**, choose the model launcher, select a Claude account when applicable, and click **Start 3-session example**. Mission Control creates the loop with `maxSessions: 3`, starts session 1, and opens its detail page.

Claude examples offer two subscription profiles:

- **Default** uses the normal Claude Code login (`~/.claude`).
- **Balsa** sets `CLAUDE_CONFIG_DIR=~/.claude-balsa` for that CLI process.

The GPT-5.6 example uses the normal Codex login (`CODEX_HOME` is not overridden).

## Expected result

The loop should reach `completed` after three sessions. The detail page should show:

- three completed sessions;
- token usage reported by the CLI;
- populated `STATUS.md` and `JOURNAL.md`;
- `RESULT.md` showing that all three checkpoints passed.

All launchers use the same workspace and mission. Generated runtime files are ignored by Git. The workspace lock prevents two examples from running at the same time, so wait for one model to finish before starting another.

These are deliberately small tests, but each CLI still loads its normal startup instructions and tool context. Actual subscription usage can therefore be larger than the visible mission text.
