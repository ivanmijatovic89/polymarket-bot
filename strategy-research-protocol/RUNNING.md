# Running the research loop

How the roles are actually launched and handed off. Module contracts define
WHAT each role does ([`modules/index.md`](./modules/index.md)); this file
defines HOW sessions run.

## Session model

Every role runs as a **separate headless Claude session** launched by a
script. Sessions are stateless by design: all context comes from the family
files plus the protocol docs, so any session can be re-run after a crash or
a pause with no loss (see the Researcher's resume guide).

| script                                    | role                       | contract                                                 |
| ----------------------------------------- | -------------------------- | -------------------------------------------------------- |
| `scripts/propose-family.sh ["seed idea"]` | ProposeFamily              | [`modules/ProposeFamily.md`](./modules/ProposeFamily.md) |
| `scripts/researcher.sh <family>`          | Researcher — ONE iteration | [`modules/Researcher.md`](./modules/Researcher.md)       |

Both stream readable output, keep a raw `.jsonl` log, and print a cost
summary (same plumbing as `propose-family.sh`).

## Handoffs

Handoffs happen through files and exit messages — never through shared
session context:

1. `researcher.sh <family>` runs one iteration and EXITS, reporting what it
   did and what comes next (e.g. "submitted pass 1 — running, check back
   later", or "pass 2 judged, pass 3 submitted").
2. Run `researcher.sh <family>` again — it reads the files and takes the
   next action (check completion, judge finished work, log entry, next
   pass, extension, next experiment, kill).

The user (or a future orchestrator) is the metronome: it just re-runs the
script per family and can run many families in parallel.

**One family = one session at a time — enforced.** `researcher.sh` takes a
per-family lock (`$TMPDIR/research-locks/<family>.lock` with the session
PID; outside the repo so it never dirties the tree). A second session on a
locked family refuses to start; a lock whose PID is dead (crashed session)
is ignored and taken over.

## Cadence

Nothing polls. Run `researcher.sh` when you want progress; it exits
immediately with "waiting on backtests" if there is nothing to do. A simple
loop (or cron) re-running the researcher per family is the intended v2
orchestration; the autonomous multi-family orchestrator remains deliberately
out of scope.

## Branch policy

This section is the single source of truth for where research sessions
commit — change the setting here and nowhere else.

```text
researchBranch: main
```

Current policy: research sessions commit directly on `main` and push `main`
before submitting remote-worker backtests. Remote workers track `origin/main`;
after pushing, run
[`syncWorkerFleet`](./tools/syncWorkerFleet.md) so worker checkouts fast-forward
before jobs are enqueued.

If this ever becomes a bottleneck, the known alternative is a long-lived
`research` branch that workers track, merged to `main` at family checkpoints
(validated/killed) — switching means editing the setting above and pointing
the workers at the branch.

## Preconditions checklist (any session)

- `npm run research:check` passes before starting work.
- Tree clean before any submission.
- Push to `main`, then run `./scripts/update-worker-fleet.sh` before remote
  workers consume the run.
- Database credentials in `.env` on the machine running `researcher.sh` and
  `research:check-batch` (completion checks and result reads query MySQL;
  see [`tools/checkBatch.md`](./tools/checkBatch.md)).
