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

How sessions are launched and run — modes, isolation, locking, branch
policy, preconditions, and the checklist for new launch scripts — lives in
[`strategy-research-protocol/SESSIONS.md`](./SESSIONS.md).

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
| session mechanics: launch modes, isolation, locks, branch, submit preconditions | [`SESSIONS.md`](./SESSIONS.md)          |
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
