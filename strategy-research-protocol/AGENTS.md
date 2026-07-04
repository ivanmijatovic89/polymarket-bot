# AGENTS.md

This folder defines Strategy Research Protocol for the parent
`polymarket-bot` repository.

## Role Map

Three LLM worker roles, each with a dedicated contract in
[`strategy-research-protocol/modules/index.md`](./modules/index.md):

- **ProposeFamily** — creates one family (proposal doc, FAMILY.json,
  baseline code), then stops.
- **Researcher** — drives one family per session; writes all FAMILY.md prose
  and the JSON state it owns; never reads raw backtest results.
- **Evaluator** — sole reader of raw results; writes all judgment fields in
  FAMILY.json; never writes FAMILY.md.

The user alone sets a family `live`. Decision policy (stages, gates, stopping
rules) lives in
[`strategy-research-protocol/STAGE-GATES.md`](./STAGE-GATES.md); memory and
field-writer rules in
[`strategy-research-protocol/MEMORY.md`](./MEMORY.md).

## Documentation Path Rule

When referencing repository files in protocol documentation, use a repo-relative
display path with a portable relative Markdown link.

Use this style:

```md
[`strategy-research-protocol/RESEARCH_SCOPE.md`](./RESEARCH_SCOPE.md)
[`strategy-research-protocol/tools/runBacktest.md`](./tools/runBacktest.md)
[`docs/backtest/parallelization.md`](../docs/backtest/parallelization.md)
[`src/strategies/research/INDEX.json`](../src/strategies/research/INDEX.json)
```

Do not use local absolute paths such as:

```md
/Users/mijat/Sites/polymarket-bot/strategy-research-protocol/RESEARCH_SCOPE.md
```

The goal is that humans and agents can see the exact repository location while
the links keep working if the repository moves.
