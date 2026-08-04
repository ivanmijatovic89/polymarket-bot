# Pair Game Template

A clean autonomous level-game starting point for building one BTC 15-minute
UP/DOWN strategy. The agent may change the player, but it cannot change the
levels or the evaluator rules.

## One-time setup

```bash
protocols/pair/scripts/setup-model-worktree.sh opus main pair-game-template
```

## Launch

Start the Global Runtime first if it is not already running:

```bash
npm run global-runtime
```

Create and start the overnight loop:

```bash
npm run mission -- create \
  --name "Pair Game Template" \
  --provider claude --model claude-opus-5 --effort high \
  --access full-access \
  --auth-home ~/.claude-balsa \
  --workspace ../polymarket-bot-pair-game-template \
  --mission protocols/pair-game-template/missions/01-level-game.md \
  --status-file protocols/pair-game-template/state/STATUS.md \
  --journal-file protocols/pair-game-template/state/JOURNAL.md \
  --inbox-file protocols/pair-game-template/state/INBOX.md \
  --read-only protocols/pair-game-template/RULES.md \
  --read-only protocols/pair-game-template/LEVELS.md \
  --read-only protocols/pair-game-template/state/PROPOSALS.md \
  --read-only protocols/pair-game-template/state/CHAMPION.md \
  --max-sessions 300 --delay 10 \
  --start
```

Open Mission Control at `http://127.0.0.1:3051/mission-control`.
