# pair-fable — the pair protocol on the Global Runtime

One agent (Claude Fable 5 by default), one workspace, missions run as Global
Runtime loops observed through Mission Control. The mission files are written
to be short, stable, and model-agnostic so the same protocol can later be run
unchanged on Opus 5, GPT-5.6, or other models for comparison.

## Layout

| Path | Owner | Purpose |
| --- | --- | --- |
| `RULES.md` | human | The constitution: dataset, strategy rubrics, backtesting, scopes. |
| `missions/01-explore-and-build.md` | human | Mission 01 — learn the system, build the research toolkit. |
| `missions/02-research.md` | human | Mission 02 — the autonomous research loop. |
| `state/` | agent | Runtime contract files (STATUS/JOURNAL/INBOX) + PLAN.json, PROPOSALS.md, READY.md. |
| `memory/` | agent | The agent-designed memory system. |
| `tools/` | agent | Tools the agent builds for itself. |

## One-time setup

```bash
# Create the dedicated worktree (keyless .env, scope hook, symlinked deps/data).
# Third argument selects this protocol; while this branch is unmerged, pass it
# as the base branch instead of main.
protocols/pair/scripts/setup-model-worktree.sh fable main pair-fable
```

## Launch mission 01

```bash
npm run global-runtime      # terminal 1 (daemon)
npm run dashboard           # terminal 2 → http://127.0.0.1:3051/mission-control

npm run mission -- create \
  --name "pair-fable 01 explore-and-build" \
  --provider claude --model claude-fable-5 --effort high \
  --access full-access \
  --workspace ../polymarket-bot-pair-fable \
  --mission protocols/pair-fable/missions/01-explore-and-build.md \
  --status-file protocols/pair-fable/state/STATUS.md \
  --journal-file protocols/pair-fable/state/JOURNAL.md \
  --inbox-file protocols/pair-fable/state/INBOX.md \
  --read-only protocols/pair-fable/RULES.md \
  --read-only protocols/pair-fable/state/PLAN.json \
  --read-only protocols/pair-fable/state/PROPOSALS.md \
  --read-only protocols/pair-fable/state/READY.md \
  --max-sessions 20 --delay 20 \
  --start
```

Mission 02 is the same command with the 02 mission path, a fresh name, and a
higher `--max-sessions`; it reuses the same workspace and state files, so run
it only after mission 01 was accepted.

To run the protocol on another model later, change only `--provider`,
`--model`, and the run name — the mission files stay identical.

## Steering

- **Inbox** (Mission Control or `npm run mission -- inbox <id> "..."`) for
  course corrections; the next session applies them.
- **`state/PROPOSALS.md`** for the reverse direction: the agent records bugs,
  engine suggestions, and rubric questions there with `status: proposed`; you
  flip a status to `accepted`/`rejected` (editor or inbox) and the agent acts
  on accepted ones.
- **Extend** (`npm run mission -- extend <id> --max-sessions <n>`) when the
  session budget runs out; the limit is a spending guard, not a plan.

## Access-mode warning

These loops need `full-access` (backtests use MySQL/Redis/R2 and the fleet
needs `git push`). Full access means the process is NOT sandboxed: on this
machine it could read the main checkout's `.env`, which holds live trading
keys. The worktree's own `.env` is keyless and the scope hook blocks bad
commits, but nothing technically stops a full-access process from reading
files elsewhere. Run these loops on a machine without live keys if that risk
is not acceptable.
