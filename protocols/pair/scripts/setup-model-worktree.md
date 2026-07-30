# Pair protocol — safety kit

Guard scripts for the `protocols/pair/` models (design: `protocols/pair/VISION.md`
§Safety kit). They live inside the protocol for self-containment, and the
pre-commit hook **protects this directory from model commits** (its own path is
on the blocked list), so models cannot weaken their guardrails through the
normal commit flow. Only the human edits these files.

## setup-model-worktree.sh

```bash
protocols/pair/scripts/setup-model-worktree.sh fable   # create/refresh model worktree
protocols/pair/scripts/setup-model-worktree.sh gpt
```

**Relationship to the future launcher**: this script is the PREPARE half.
The launcher (built later, in P1 — e.g. `run-model.sh fable`) will call this
script as its first step (it is idempotent — safe to run on every launch),
then start the tmux session + the model loop. Until the launcher exists, the
human runs this script directly, once per model.

Creates `../polymarket-bot-pair-<model>` with:

- **Generated minimal `.env`** — `DRY_RUN=true` hardcoded; whitelisted keys
  only (DB, Redis, R2, telonex floor). It NEVER copies the root `.env`, which
  holds live trading keys. No `PRIVATE_KEY`, no `POLYMARKET_*`, no `CLOB_*`,
  no RPC.
- **Worktree-scoped pre-commit hook** (`hooks/pre-commit` via
  `core.hooksPath`; model identity pinned in `git config pair.model`).
- **`node_modules` + `data/` symlinked from the main checkout** — always
  fresh, no duplicate installs or dataset downloads. Consequence (rule):
  models never run `npm install`/`npm ci` — dependencies are the human's job
  in the main checkout.

Models use the app DB user (decided 2026-07-28: no scoped MySQL user). R2
keys are the shared data-bucket keys — write-capable; acceptable exposure,
it's datasets, not money.

## hooks/pre-commit

Blocks, in every model worktree: commits outside `protocols/pair/**`; edits to
the human-authored files (`VISION.md`, `DECISIONS.md`, `RULES.md`,
`MISSION.md`); writes into another model's `models/<x>/` folder; and staged
content matching secret patterns (64-hex keys, PEM blocks, credential
assignments).

