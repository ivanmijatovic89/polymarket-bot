# AGENTS.md

This folder defines Strategy Research Protocol for the parent
`polymarket-bot` repository.

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
