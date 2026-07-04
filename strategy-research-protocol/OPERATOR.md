# Operator guide — how to run the protocol (for the human)

This file is for YOU, not for agents. Agents read `modules/`; the session
mechanics live in [`RUNNING.md`](./RUNNING.md). This is the step-by-step
cookbook: what you type, in what order, and which decisions are yours.

## 0. One-time setup (per machine)

1. `.env` with database credentials — `evaluator.sh` and
   `npm run research:check-batch` query MySQL.
2. Redis + backtest workers running on this machine (branch policy is
   `main`-local, so workers must run where research commits live):
   `./scripts/run-worker.sh` with your usual queues (market + aggregate).
3. Telonex data prewarmed locally:
   `npm run telonex:download-converted-r2-to-local -- --converter delta-typed --symbol btc --timeframe 15m`
4. Dashboard for eyeballing results: `npm run dashboard` → `:3051`.
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

## 2. Drive the loop — you are the metronome

One family = alternate two scripts until the family is validated or killed:

```bash
./strategy-research-protocol/scripts/researcher.sh <family>
```

Permissions note: the scripts default to `acceptEdits`, and in headless mode
non-allowlisted Bash commands are DENIED, not prompted — but the Researcher
and Evaluator need Bash (`git`, `npm run backtest`, `checkBatch`, `curl`).
Until you allowlist those in `.claude/settings.local.json`, run with:

```bash
PERM=bypassPermissions ./strategy-research-protocol/scripts/researcher.sh <family>
PERM=bypassPermissions ./strategy-research-protocol/scripts/evaluator.sh <family> <id>
```

The Researcher does ONE step and exits, telling you what happened. Your
reaction table:

| Researcher says                              | you do                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| "submitted smoke / pass N — running"         | wait a bit, then run `researcher.sh` again                                                   |
| "waiting on backtests"                       | check later; or peek with `npm run research:check-batch -- --family <f> --experiment <id>`   |
| "complete — ready for evaluation of `<id>`"  | `./strategy-research-protocol/scripts/evaluator.sh <family> <id>` then `researcher.sh` again |
| "log entry written, next experiment specced" | `researcher.sh` again (it will submit next)                                                  |
| "family killed (retryOnlyIf: ...)"           | read the closing log entry; move on to other families                                        |
| "nothing actionable"                         | family is parked; nothing to do                                                              |

Several families in parallel: run the same loop per family. One family = one
session at a time (the scripts enforce this with a lock; a second session
refuses to start).

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
  "fix A1, A3 from protocol-audit/<report>.md".
- Skim [`LESSONS.md`](./LESSONS.md) now and then — it is the compounding
  asset; if it is not growing, Researchers are skipping the promotion check.
- Commit and push after research steps; CI runs `research:check` + INDEX
  freshness on every PR.

## 6. Troubleshooting

| symptom                                                        | cause / fix                                                                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| script says "another session is already working on `<family>`" | a live session holds the lock; if it is actually dead: `rm ${TMPDIR:-/tmp}/research-locks/<family>.lock`                             |
| `research:check` fails                                         | read its per-family error lines — most often a missing Research-log entry or an inconsistent status; have a session fix exactly that |
| submission refused: dirty tree                                 | commit first — workers run committed code                                                                                            |
| worker exits with code 75                                      | normal: worker self-update, it relaunches on the new commit                                                                          |
| `--extend` blocked: "extension in progress"                    | crashed extend; clear with `UPDATE backtest_runs SET extending_at = NULL WHERE id = <runId>;`                                        |
| `check-batch` cannot connect                                   | you are on a machine without `.env` DB credentials                                                                                   |
