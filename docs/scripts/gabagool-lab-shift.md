# Gabagool Lab

An autonomous, greenfield research LAB for exactly one strategy concept —
gabagool-style two-sided pair accumulation on Polymarket BTC 15m up/down
markets. Unlike the Knowledge Shift (research only), the lab **designs its
own research system** — evaluation, champion scoring, experiment policy,
memory, tools — taking whatever it wants from `strategy-research-protocol/`
and `fable-lab/` without being bound by either (operator's explicit
mandate). Then it builds strategy variants, backtests them, and drives
toward either a live-ready validated variant or a numeric proof that the
concept cannot pay, with retry conditions.

- **Script:** `gabagool-knowledge-and-lab/gabagool-lab-shift.sh` (run from the main checkout)
- **Status:** staged, **not launched** — start after the weekly Fable
  credits renew (it shares the budget with the Knowledge Shift), ideally
  once `research/gabagool/LAB-HANDOFF.md` exists.
- **Companion:** `docs/scripts/gabagool-knowledge-shift.md` (produces the
  knowledge base this lab consumes — the lab re-reads it every session)

## Where it runs

Yes — in its own git worktree, separate from both the main checkout and the
knowledge worktree; the two loops can run at the same time:

| | |
|---|---|
| Worktree | `../polymarket-bot-gabagool-lab` |
| Branch | `gabagool-lab` (pushed continuously) |
| Write scope | `gabagool-lab/` **and** `src/strategies/gabagool-lab/` — enforced by a pre-commit hook |
| Mission file | `gabagool-lab/CHARTER.md` (written by the script on first run) |
| State / narration | `gabagool-lab/STATE.md`, `gabagool-lab/JOURNAL.md`, `gabagool-lab/DECISIONS.md` |

Strategy code goes under `src/strategies/gabagool-lab/` because the engine's
registry auto-discovers only `src/strategies/**` — that keeps the normal
backtest CLI and branch-local workers working.

## What the charter fixes vs. frees

Fixed: the concept (pair cost < $1, BTC 15m, must survive 500–1000 ms
latency stress); **time-sliced verdicts** (per-period trend, never just one
aggregate EV); a **multi-criteria champion scoring rule written and frozen
before use** (stability, tails, latency robustness, capital efficiency); an
explicit experiment-proposal policy; structural honesty (frozen success
criteria, out-of-sample confirmation, winner's-curse defense); deliverable
ladder L0 (lab built) → L1 (baseline measured) → L2 (campaign) → L3
(live-ready dossier or ceiling proof). Free: everything else — the lab owns
its epistemology. Going live is the operator's decision alone.

## Start / resume

```bash
cd /Users/mijat/Sites/polymarket-bot
tmux new -s gabalab
MODEL=fable caffeinate -is ./gabagool-knowledge-and-lab/gabagool-lab-shift.sh
```

Knobs (env vars): `MAX_RUNS` (default 30), `MODEL`, `FAIL_SLEEP` (default
900s), `MIN_RUN_SECS` (default 120), `PERM` (default `bypassPermissions`).
Credit exhaustion → 15-min backoff and automatic resume after the reset.

To adjust the mission **before first launch**, edit the charter heredoc
inside the script — the charter file is only written on the first run.
After that, edit `gabagool-lab/CHARTER.md` in the worktree directly.

## Stop

```bash
touch ../polymarket-bot-gabagool-lab/gabagool-lab/DONE    # graceful: stops before next relaunch
# Ctrl+C in the tmux pane stops immediately;
pkill -f gabagool-lab-shift.sh                            # blunt
```

Remove the `DONE` file before restarting. The lab may create `DONE` itself
only at mission end (L3).

## Watch / review

```bash
tail -f ../polymarket-bot-gabagool-lab/gabagool-lab/OPERATOR-FEED.md  # 10-second status feed
tail -f ../polymarket-bot-gabagool-lab/gabagool-lab/JOURNAL.md        # full narration
cd ../polymarket-bot-gabagool-lab && git log --oneline main..gabagool-lab
```

`OPERATOR-FEED.md` is the at-a-glance view: one entry per unit of work, max
four lines — `Did` / `Found` (with experiment numbers) / `Next` / `Health` —
where `Health` must honestly say `on track`, `BLOCKED: <why>`, or
`OFF-PLAN: <why>`.

claude-code-viewer: `http://localhost:3400` → project
`-Users-mijat-Sites-polymarket-bot-gabagool-lab` (appears after first launch;
if launched from a desktop background session it may live under
`~/.claude-balsa/projects/` — symlink into `~/.claude/projects/` like the
knowledge shift if needed).

## Good to know

- Backtests: local `--sequential` always works; local workers started from
  the lab worktree run branch code; the remote fleet tracks `origin/main`
  and is NOT assumed available — the lab must say in its journal if fleet
  capacity would change its plan.
- Hard bans: live trading / order placement, touching `main`, schema
  changes, new npm dependencies, writing outside its two paths.
- New replayable feeds (price-to-beat, Chainlink BTC) are being added by
  the operator — the charter tells the lab to design for their arrival.
- The remote `gabagool-lab` branch may exist before the first launch (it was
  pre-created from `origin/main` so workers could check it out early); the
  script adopts it and fast-forwards it from the first push on.
- The launcher script itself is still untracked on `main` — PR it when
  convenient. Until then it lives only in the main checkout on this machine.
