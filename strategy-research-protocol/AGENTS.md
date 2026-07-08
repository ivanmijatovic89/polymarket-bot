# AGENTS.md

This folder defines Strategy Research Protocol for the parent
`polymarket-bot` repository.

## Role Map

Two LLM worker roles, each with a dedicated contract in
`strategy-research-protocol/modules/`. Before executing a workflow, read the
module file — worker instructions live there and nowhere else:

- **ProposeFamily** — creates one family (proposal doc, FAMILY.json,
  baseline code), then stops
  ([`modules/ProposeFamily.md`](./modules/ProposeFamily.md)).
- **Researcher** — drives one family per session: specs, runs, judges, and
  logs experiments ([`modules/Researcher.md`](./modules/Researcher.md)).

The user alone sets a family `live`.

## How Sessions Run

One session = one family. The Researcher launches in two modes, same
contract ([`modules/Researcher.md`](./modules/Researcher.md)):

- **Autonomous (default):** `scripts/researcher.sh <family>` — a headless
  Claude session that works the family continuously and streams everything
  it does. The operator watches; the session never asks questions. It waits
  for backtests by polling `checkBatch` and stops only when the family is
  validated, killed, or nothing is actionable.
- **Interactive:** `INTERACTIVE=1 scripts/researcher.sh <family>` — the
  same contract in a normal Claude session the operator can steer and
  interrupt.

`scripts/propose-family.sh ["seed"]` creates one family and exits.

**Sessions are isolated.** The launch scripts exclude the repo root
CLAUDE.md and user-level memory (`claudeMdExcludes` + auto-memory off in a
generated `--settings` file): the protocol docs in this folder are a
session's ENTIRE instruction set. In particular, the repo-wide git workflow
(branch + PR) does not apply here — the branch policy below does.

Sessions are disposable: **every step is written to the family files
immediately**, so a killed or crashed session loses nothing — the next one
resumes from files alone. A per-family lock
(`$TMPDIR/research-locks/<family>.lock`, PID inside; outside the repo so it
never dirties the tree) prevents two sessions on one family; a lock whose
PID is dead is taken over.

### Branch policy

```text
researchBranch: main
```

Research sessions commit directly on `main` and push before submitting
remote-worker backtests — remote workers track `origin/main`. If this ever
becomes a bottleneck, the alternative is a long-lived `research` branch
merged at family checkpoints; switching means editing the setting above and
pointing the workers at the branch. Change it here and nowhere else.

### Session preconditions

- `npm run research:check` passes before starting work.
- Tree clean before any submission; commit and push, then sync the worker
  fleet ([`tools/syncWorkerFleet.md`](./tools/syncWorkerFleet.md)).
- Database credentials in `.env` (completion checks and result reads query
  MySQL; see [`tools/checkBatch.md`](./tools/checkBatch.md)).

## One Home Per Concept

Every rule, definition, number, and flow has exactly ONE authoritative
home file. Every other mention is at most one sentence plus a link to the
home — never a second definition. When editing the protocol: if you are
about to restate a rule, link it instead; if a rule has no home, give it
one before depending on it.

| concept                                                | home                                                     |
| ------------------------------------------------------ | -------------------------------------------------------- |
| what a role does + its rules (incl. bias containment)  | `modules/<Role>.md`                                      |
| gates, stages, stopping rules, metric vocabulary       | [`STAGE-GATES.md`](./STAGE-GATES.md)                     |
| files, fields, writers, statuses, update triggers      | [`MEMORY.md`](./MEMORY.md) + `schemas/`                  |
| naming, batchUids, champion pointer, code freeze       | `rules/`                                                 |
| session mechanics: scripts, locks, branch, submit preconditions | this file (How Sessions Run)                     |
| tool usage                                             | `tools/`                                                 |
| research scope and assumptions                         | [`SCOPE.md`](./SCOPE.md)               |
| term definitions (one sentence + link, never rules)    | [`GLOSSARY.md`](./GLOSSARY.md)                           |
| core invariants + map of everything                    | [`README.md`](./README.md)                               |
| human operator cookbook                                | [`OPERATOR.md`](./OPERATOR.md)                           |

## Documentation Path Rule

When referencing repository files in protocol documentation, use a repo-relative
display path with a portable relative Markdown link.

Use this style:

```md
[`strategy-research-protocol/SCOPE.md`](./SCOPE.md)
[`strategy-research-protocol/tools/runBacktest.md`](./tools/runBacktest.md)
[`docs/backtest/parallelization.md`](../docs/backtest/parallelization.md)
[`src/strategies/research/INDEX.json`](../src/strategies/research/INDEX.json)
```

Do not use local absolute paths such as:

```md
/Users/mijat/Sites/polymarket-bot/strategy-research-protocol/SCOPE.md
```

The goal is that humans and agents can see the exact repository location while
the links keep working if the repository moves.
