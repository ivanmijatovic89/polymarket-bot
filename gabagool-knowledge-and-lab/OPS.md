# Gabagool Ops — index

Two autonomous shifts, one strategy concept. Full runbooks (what they do,
start/stop, worktrees, watching, troubleshooting):

- **Gabagool Knowledge Shift** → `docs/scripts/gabagool-knowledge-shift.md`
  — research-only loop building the knowledge base in
  `../polymarket-bot-gabagool` (branch `gabagool-knowledge`, writes only
  `research/gabagool/`). **RUNNING** since 2026-07-17 ~02:26.
- **Gabagool Lab** → `docs/scripts/gabagool-lab-shift.md`
  — greenfield lab that designs its own research system and backtests
  variants in `../polymarket-bot-gabagool-lab` (branch `gabagool-lab`,
  writes only `gabagool-lab/` + `src/strategies/gabagool-lab/`).
  **STAGED, not launched** — start after the weekly credits renew.

Quick reference:

```bash
# start / resume (each in its own tmux)
# CLAUDE_CONFIG_DIR picks the account: ~/.claude-balsa profile here;
# leave it out to use this terminal's normal claude login.
CLAUDE_CONFIG_DIR=$HOME/.claude-balsa MODEL=fable caffeinate -is ./gabagool-knowledge-and-lab/gabagool-knowledge-shift.sh
CLAUDE_CONFIG_DIR=$HOME/.claude-balsa MODEL=fable caffeinate -is ./gabagool-knowledge-and-lab/gabagool-lab-shift.sh

# stop (graceful)
touch ../polymarket-bot-gabagool/research/gabagool/DONE
touch ../polymarket-bot-gabagool-lab/gabagool-lab/DONE

# watch
tail -f ../polymarket-bot-gabagool/research/gabagool/JOURNAL.md
tail -f ../polymarket-bot-gabagool-lab/gabagool-lab/JOURNAL.md
# viewer: http://localhost:3400 → project -Users-mijat-Sites-polymarket-bot-gabagool

# review
git -C ../polymarket-bot-gabagool log --oneline main..gabagool-knowledge
git -C ../polymarket-bot-gabagool-lab log --oneline main..gabagool-lab
```

Everything for this experiment is bundled in `gabagool-knowledge-and-lab/`
(both launcher scripts, `INVESTIGATION.md`, `MISSION.md`, `PLAYBOOK.md`, and
this file), tracked on `main`. The published runbooks live under
`docs/scripts/gabagool-*-shift.md`. The autonomous work itself lives on the
`gabagool-knowledge` / `gabagool-lab` branches (their worktrees), pushed to
`origin`. This whole folder is self-contained and safe to delete once the
experiment is retired.
