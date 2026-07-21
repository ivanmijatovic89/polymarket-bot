# Claude Code log viewers — watching autonomous sessions

How to watch what a headless Claude Code session (e.g. the fable night shift)
is doing, with a nicer UI than raw terminal output. Sessions are recorded as
JSONL under `~/.claude/projects/<project>/`, which is what these tools read.

## Recommended: claude-code-viewer (web UI, live)

<https://github.com/d-kimuson/claude-code-viewer> — web UI with real-time
session view (chat layout, expandable tool calls, search, git diff panel).

Requires Node >= 24 while the repo runs Node 20, so use nvm **in a dedicated
terminal only** (per-shell; does not affect workers/engine/other terminals):

```bash
nvm install 24        # first time only
nvm use 24            # this terminal only — never `nvm alias default 24`
npx @kimuson/claude-code-viewer@0.7.5 --port 3400
# open http://localhost:3400 → project -Users-mijat-Sites-polymarket-bot-fable
```

Pin the version (not `@latest`) — supply-chain hygiene. Keep it on localhost
and stop it when not watching. Note: session transcripts can contain
sensitive tool output (env values, DB results); this tool reads them locally
and serves them only on localhost, but it is third-party code — not audited
line by line.

## Alternatives

- <https://github.com/delexw/claude-code-trace> — desktop app (.dmg), live
  tail, no Node dependency.
- <https://github.com/daaain/claude-code-log> and
  <https://github.com/simonw/claude-code-transcripts> — post-hoc HTML
  export, good for morning review.

## Zero-trust fallback (fable night shift)

The night shift narrates itself in plain language to
`../polymarket-bot-fable/fable-lab/JOURNAL.md`:

```bash
tail -f /Users/mijat/Sites/polymarket-bot-fable/fable-lab/JOURNAL.md
```

Control room (journal + branch commits in one tmux window):

```bash
tmux new -s watch \; split-window -v \; \
  send-keys -t 0 'tail -f /Users/mijat/Sites/polymarket-bot-fable/fable-lab/JOURNAL.md' C-m \; \
  send-keys -t 1 'while true; do clear; git -C /Users/mijat/Sites/polymarket-bot-fable log --oneline -8; sleep 30; done' C-m
```
