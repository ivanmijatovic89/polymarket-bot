# Operator guide — how to run the protocol (for the human)

This file is for YOU, not for agents. Agents read `modules/`; the session
mechanics live in [`RUNNING.md`](./RUNNING.md). This is the step-by-step
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

One family = re-run one script until the family is validated or killed:

```bash
./strategy-research-protocol/scripts/researcher.sh <family>
```

Permissions note: the scripts default to `acceptEdits`, and in headless mode
non-allowlisted Bash commands are DENIED, not prompted — but the Researcher
needs Bash (`git`, `npm run backtest`, `checkBatch`, `curl`). Until you
allowlist those in `.claude/settings.local.json`, run with:

```bash
PERM=bypassPermissions ./strategy-research-protocol/scripts/researcher.sh <family>
```

The Researcher does ONE step and exits, telling you what happened. Your
reaction table:

| Researcher says                              | you do                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| "submitted smoke / pass N — running"         | wait a bit, then run `researcher.sh` again                                                 |
| "waiting on backtests"                       | check later; or peek with `npm run research:check-batch -- --family <f> --experiment <id>` |
| "judged pass N / verdict written for `<id>`" | `researcher.sh` again (log entry, next pass, or next step)                                 |
| "log entry written, next experiment specced" | `researcher.sh` again (it will submit next)                                                |
| "family killed (retryOnlyIf: ...)"           | read the closing log entry; move on to other families                                      |
| "nothing actionable"                         | family is parked; nothing to do                                                            |

Several families in parallel: run the same loop per family. One family = one
session at a time (the scripts enforce this with a lock; a second session
refuses to start).

## 2b. Interactive mode — watch and steer (recommended at the start)

The scripts are headless: you see a live feed but cannot intervene. For the
shakedown phase, run the SAME roles interactively instead — open a normal
session (`claude`, from either folder) and paste the exact instruction the
script would have sent:

```text
Execute propose-family per strategy-research-protocol/modules/ProposeFamily.md. Run autonomous (no seed).
Execute propose-family per strategy-research-protocol/modules/ProposeFamily.md. Run with seed: '<your idea>'.
Execute one researcher iteration per strategy-research-protocol/modules/Researcher.md. Family: '<family>'.
```

Behavior is identical — the module contracts and the files are the truth —
but now you can:

- **approve each step**: in default permission mode every file edit and bash
  command waits for your yes/no, which IS the step-by-step experience;
- **ask before it acts**: append "Before each action, tell me what you are
  about to do and why, and wait for my confirmation." to the instruction;
- **interrupt and steer** (Esc), ask "why did you choose those pass
  values?", request changes before it submits;
- **chain steps in one session**: after an iteration finishes, just say
  "continue" — statuses in FAMILY.json tell it what is next. Handing the
  next step to a fresh scripted session works equally well; the files carry
  everything.

Two cautions:

- Interactive sessions do NOT take the per-family lock (only the scripts
  do). YOU are the lock: never run an interactive role and a script on the
  same family at the same time.
- The role rules still bind you: don't ask the Researcher to judge
  incomplete work, soften a pre-declared `successCriteria`, or edit a frozen
  hypothesis — if you want an exception, change the module, not the session.

Once the loop feels trustworthy, switch to the scripts — they are the same
thing without the hand-holding.

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
