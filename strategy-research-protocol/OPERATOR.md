# Operator guide — how to run the protocol (for the human)

This file is for YOU, not for agents. Agents read `modules/`; the session
mechanics live in [`SESSIONS.md`](./SESSIONS.md). This is the step-by-step
cookbook: what you type, in what order, and which decisions are yours.

Work from whichever folder you prefer — both are fully supported.
`cd strategy-research-protocol && claude` is the designed workflow: the root
CLAUDE.md still loads (Claude walks up the tree), the `/protocol-audit`
command is discovered from the repo root, `npm run` finds the root
package.json, and the launch scripts `cd` to the git root themselves.

## 0. One-time setup (per machine)

1. `.env` with database credentials — `researcher.sh` and
   `npm run research:check-batch` query MySQL (completion checks and result
   reads).
2. Redis + backtest workers running. Remote workers track `origin/main`; after
   pushing research commits to `main`, run `./scripts/update-worker-fleet.sh`
   before submitting jobs. Local-only workers can still be started manually with
   `./scripts/run-worker.sh` using your usual queues (market + aggregate).
3. (Optional, speeds up first runs) prewarm Telonex data locally:
   `npm run telonex:download-converted-r2-to-local -- --converter delta-typed --symbol btc --timeframe 15m`
   — not required: protocol backtests always run with
   `--read-from local-or-download-from-r2-to-local`, which downloads any
   missing market once, automatically.
4. Dashboard: `npm run dashboard` → `:3051` — REQUIRED before launching
   researcher sessions (they read results through its API and stop if it is
   down; they never start it themselves).
5. Sanity check: `npm run research:check` must be green and the tree clean.

## 1. Start a new family

```bash
./strategy-research-protocol/scripts/propose-family.sh                      # autonomous
./strategy-research-protocol/scripts/propose-family.sh "fade resting walls" # seeded
```

Then YOU review before anything runs — you are the taste filter:

- Read the new `src/strategies/research/<family>/FAMILY.md`: is the Thesis
  believable? Does Edge economics cite real measured comparables, not vibes?
- Bad proposal → delete the folder, done. Good proposal → continue.
- `npm run research:build-index` (INDEX.json picks up the new family).
- Commit. (The Researcher will refuse to submit on a dirty tree anyway.)

## 2. Drive the loop — launch and watch

One family = one command. The session works the family continuously and
autonomously — it streams every step live, never asks you anything, waits
for backtests on its own, and stops when its session contract says so
(validated, killed, nothing actionable, dashboard down, runaway brake):

```bash
./strategy-research-protocol/scripts/researcher.sh <family>
```

You just watch the feed. Your reaction table:

| you see                                  | it means                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| steps streaming by                       | working — no action needed                                                      |
| "polling checkBatch..."                  | backtests running; it will continue by itself                                   |
| session stopped: "validated" / "killed"  | read the closing log entry; decide live dry-run (validated) or move on (killed) |
| session stopped: "nothing actionable"    | family is parked; nothing to do                                                 |
| session stopped: "dashboard down"        | run `npm run dashboard`, then relaunch the same command (it never starts it)    |
| session crashed / you killed it (Ctrl-C) | nothing is lost — files carry the state; run the same command again to resume   |

Permissions note: the scripts default to `PERM=bypassPermissions`
(rationale: the launcher checklist in [`SESSIONS.md`](./SESSIONS.md)). For
tighter permissions, allowlist the needed Bash commands in
`.claude/settings.local.json` and run with `PERM=acceptEdits`.

Several families in parallel: one terminal per family. One family = one
session at a time (the script enforces this with a lock; a second session
refuses to start).

## 2b. Interactive mode — steer it yourself

When you want to guide the work instead of watching it:

```bash
INTERACTIVE=1 ./strategy-research-protocol/scripts/researcher.sh <family>
```

Same contract, but in a normal Claude session: it narrates each step, you
can interrupt (Esc), ask "why did you choose those pass values?", request
changes before it submits, or say "continue". The per-family lock is taken
in both modes.

One caution: the role rules still bind you — don't ask the Researcher to
judge incomplete work, soften a pre-declared `successCriteria`, or edit a
frozen hypothesis. If you want an exception, change the module, not the
session.

## 3. Checking status anytime

- Family state: open `src/strategies/research/<family>/FAMILY.json`
  (statuses, gateLog, outcomes) and `FAMILY.md` (Research log).
- Backtest progress: `npm run research:check-batch -- --family <f> --experiment <id>`.
- Numbers/charts: dashboard `:3051`, search by batchUid
  (`<family>--<experiment>...`).
- Protocol integrity: `npm run research:check`.

## 4. Decisions only YOU make

- **`live`** — after a family is `validated`, watch it in live dry-run
  first (`DRY_RUN=true npm run trade:bot:btc -- --strategy <family>.<champion-id>`
  with the champion's `outcome.bestParams`); only you flip the family status
  to `live`.
- **Tuning the policy** — stage sizes, `minExperiments`: edit
  [`STAGE-GATES.md`](./STAGE-GATES.md) config and bump its `version`.
- **Reopening a killed family** — when its `retryOnlyIf` condition becomes
  true.
- **Vetoing proposals** — deleting a family you don't like needs no
  justification; optionally add a line to
  [`CONSTRAINTS.md`](./CONSTRAINTS.md) so it never comes back.

## 5. Periodic maintenance

- `/protocol-audit` (Claude command, from the repo root) — writes an
  actionable report to `protocol-audit/`; fix findings by telling a session
  "fix A1, A3 from protocol-audit/report.md".
- Skim [`LESSONS.md`](./LESSONS.md) now and then — it is the compounding
  asset; if it is not growing, Researchers are skipping the promotion check.
- Commit and push to `main` after research steps; sync remote workers before
  submitting backtests.
- Session logs (`*-<family>.jsonl` in the repo root) are gitignored scratch —
  delete them whenever you are done with them.

## 6. Troubleshooting

- **Script says "another session is already working on a family"** — a live
  session holds the lock. If it is actually dead, remove the lock with
  `rm ${TMPDIR:-/tmp}/research-locks/FAMILY.lock`, replacing `FAMILY`.

- **`research:check` fails** — read its per-family error lines. Most often
  this is a missing Research-log entry or inconsistent status. Have a session
  fix exactly that.

- **Submission refused: dirty tree** — commit first; workers run committed
  code.

- **Remote worker shows old commit** — push `main`, then run
  `./scripts/update-worker-fleet.sh` before submitting.

- **Worker exits with code 75** — normal: worker self-updated and relaunches on
  the new commit.

- **`--extend` blocked: "extension in progress"** — crashed extend. Clear it
  in MySQL with
  `UPDATE backtest_runs SET extending_at = NULL WHERE id = RUN_ID;`, replacing
  `RUN_ID`.

- **`check-batch` cannot connect** — you are on a machine without `.env` DB
  credentials.
