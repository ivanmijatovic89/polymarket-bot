---
title: pte CLI
description: Run any Polymarket Twin Engine command from any directory — built for external protocol workspaces.
---

# `pte` — the global engine CLI

`pte` (Polymarket Twin Engine) is a small wrapper that runs any engine command **with the working directory set to this repository**, no matter where you call it from. It exists for external protocol workspaces (`polymarket-protocols/<name>`): an agent working there can run backtests, checks, and reports without ever changing folders.

```bash
pte backtest --strategy-file strategies/my.v1.ts --input-mode telonex-delta --read-from local --symbol btc --limit 20
pte strategy:check -- --repo "$PWD"
pte fleet:status
pte tsx src/cli/pnl-report.ts --symbol btc
pte --dir            # prints the repo path
pte                  # lists all npm scripts
```

## How it works

- `pte <npm-script> [args...]` runs `npm run <script> -- [args...]` inside the repo.
- `pte npm|npx|tsx|node|git <...>` runs the command verbatim inside the repo (the repo's `node_modules/.bin` is on `PATH`, so `pte tsx ...` needs no global tsx).
- The `cd` happens only inside the script's own process — your shell (and an agent's cwd) stays where it was.
- Relative paths in engine code (`.env`, `data/events/`, `drizzle/`) resolve correctly because the process cwd **is** the repo. This also sidesteps the cwd-relative `.env` loading in `src/config/env.ts`.

## Installation

The script lives **in the repo** at `scripts/pte` and derives the repo path from its own location — one symlink per machine, and `git pull` is the update mechanism:

```bash
ln -sfn "$(pwd)/scripts/pte" ~/.local/bin/pte
```

::: tip Fleet machines
Workers get the symlink automatically: `fleet:git:pull` ensures it on every run (see `ops/ansible/pull-workers.yml`). Nothing to maintain per machine.
:::

::: warning
`pte` requires `~/.local/bin` on your `PATH` and a zsh interpreter (macOS default). The one machine-specific thing is the checkout location — irrelevant to `pte`, since the path is derived, not configured.
:::
