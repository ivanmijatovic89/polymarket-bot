---
title: Global Runtime Smoke Tests
description: One-click Fable, Opus 4.8, Opus 5, and GPT-5.6 examples for Mission Control.
---

# Global Runtime smoke tests

Mission Control includes four small end-to-end examples. Each example uses low effort, permits exactly one session, avoids research and network access, and writes a short `RESULT.md` before completing.

| Example  | Provider    | Model                      | Workspace                          |
| -------- | ----------- | -------------------------- | ---------------------------------- |
| Fable    | Claude Code | `claude-fable-5`           | `examples/global-runtime/fable/`   |
| Opus 4.8 | Claude Code | `claude-opus-4-8`          | `examples/global-runtime/opus/`    |
| Opus 5   | Claude Code | `opus` (latest Opus alias) | `examples/global-runtime/opus-5/`  |
| GPT-5.6  | Codex       | `gpt-5.6`                  | `examples/global-runtime/gpt-5.6/` |

## Run an example

Start the two local processes if they are not already running:

```bash
npm run global-runtime
npm run dashboard
```

Open `http://127.0.0.1:3051/mission-control`. Under **Quick smoke tests**, select a Claude account when applicable and click **Run smoke test**. Mission Control creates the loop, starts it, and opens its detail page.

Claude examples offer two subscription profiles:

- **Default** uses the normal Claude Code login (`~/.claude`).
- **Balsa** sets `CLAUDE_CONFIG_DIR=~/.claude-balsa` for that CLI process.

The GPT-5.6 example uses the normal Codex login (`CODEX_HOME` is not overridden).

## Expected result

The loop should reach `completed` after one session. The detail page should show:

- one completed session;
- token usage reported by the CLI;
- populated `STATUS.md` and `JOURNAL.md`;
- `RESULT.md` containing the selected model name.

Generated runtime files are ignored by Git. Re-running a template creates another run record but reuses its example workspace, so do not start two runs for the same template at the same time.

These are deliberately small tests, but each CLI still loads its normal startup instructions and tool context. Actual subscription usage can therefore be larger than the visible mission text.
