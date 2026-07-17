# Gabagool Knowledge Shift

An autonomous research loop that builds a verified knowledge base about ONE
strategy concept: the "gabagool" two-sided pair accumulation on Polymarket
crypto up/down markets (buy UP and DOWN so the pair costs < $1, hold to
resolution). It reads, pulls public trade data, measures, and synthesizes —
it does **not** write strategy code and does **not** run evidence backtests.
Its output is the prior knowledge the Gabagool Lab starts from.

- **Script:** `scripts/gabagool-knowledge-shift.sh` (run from the main checkout)
- **Launched:** 2026-07-17 ~02:26, `MODEL=fable`, `MAX_RUNS=40`
- **Companion:** `docs/scripts/gabagool-lab-shift.md` (the lab that consumes this)

## Where it runs

Yes — in its own git worktree, so the main checkout stays free for other work:

| | |
|---|---|
| Worktree | `../polymarket-bot-gabagool` |
| Branch | `gabagool-knowledge` (pushed continuously) |
| Write scope | `research/gabagool/` **only** — enforced by a worktree-scoped pre-commit hook |
| Mission file | `research/gabagool/CHARTER.md` (written by the script on first run) |
| State / narration | `research/gabagool/STATE.md`, `research/gabagool/JOURNAL.md` |

The script bootstraps everything on first run (branch, worktree, hook,
charter, `node_modules`/`data` symlinks, `.env` copy) and is idempotent —
relaunching just resumes from `STATE.md`.

## Start / resume

```bash
cd /Users/mijat/Sites/polymarket-bot
tmux new -s gaba
MODEL=fable caffeinate -is ./scripts/gabagool-knowledge-shift.sh
```

Knobs (env vars): `MAX_RUNS` (session budget, default 40), `MODEL` (default:
your CLI default), `FAIL_SLEEP` (backoff after failed launch, default 900s),
`MIN_RUN_SECS` (default 120 — shorter runs count as failed launches),
`PERM` (default `bypassPermissions`).

Weekly-credit exhaustion is handled: a run that dies quickly triggers a
15-minute backoff and retry, so the loop rides through the limit window and
resumes by itself after the reset.

## Stop

```bash
touch ../polymarket-bot-gabagool/research/gabagool/DONE   # graceful: stops before next relaunch
# Ctrl+C in the tmux pane stops the loop immediately;
pkill -f gabagool-knowledge-shift.sh                      # blunt
```

Remove the `DONE` file before restarting, or the loop exits immediately.
Sessions may create `DONE` themselves only at knowledge saturation (defined
in the charter).

## Watch

```bash
tail -f ../polymarket-bot-gabagool/research/gabagool/JOURNAL.md   # plain-language narration
tail -f logs/gabagool-knowledge-shift.out                          # outer-loop runner (detached launch)
```

claude-code-viewer (full transcripts, see `docs/reference/claude-code-log-viewers.md`):
open `http://localhost:3400` → project `-Users-mijat-Sites-polymarket-bot-gabagool`.
Transcripts of the 2026-07-17 launch live under `~/.claude-balsa/projects/`
(launched from a desktop background session); a symlink at
`~/.claude/projects/-Users-mijat-Sites-polymarket-bot-gabagool` makes the
viewer see them either way.

## Review results

```bash
cd ../polymarket-bot-gabagool
git log --oneline main..gabagool-knowledge
```

Read in this order: `STATE.md` (status digest + "story so far"), then
`STRATEGY-BRIEF.md`, `HYPOTHESES.md`, `PRIORS.md`, `VENUE-MECHANICS.md`,
`ENGINE-GAPS.md`, `wallets/*.md`, `measurements/*.md`. The final deliverable
is `LAB-HANDOFF.md` — the seed for the Gabagool Lab.

## Good to know

- Every unit of work is committed and pushed — a killed session loses nothing.
- The charter forbids: writing outside `research/gabagool/`, evidence
  backtests, fleet submissions, live trading, DB writes, new dependencies.
- Raw API pulls go to `research/gabagool/data/` (gitignored); findings are
  committed markdown.
- This file and the script are untracked on `main` for now — PR when convenient.
