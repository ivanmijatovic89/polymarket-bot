# Strategy Research Framework

Minimal v1 framework for AI-assisted strategy research in `polymarket-bot`.

This framework is not a replacement for `docs/`.

- `docs/` explains how the trading bot works.
- `strategy-research-framework/` explains how AI agents should organize strategy research.
- `src/strategies/` stores strategy research artifacts and indexes.

## v1 scope

This v1 only defines:

- minimal artifact formats
- naming rules
- templates
- schemas
- validation script
- the first module: `strategy-proposals`

It does not define:

- orchestration
- prompt builders
- queues
- databases
- automatic agent execution
- automatic strategy promotion

## Core invariant

Live trading and backtests must run the same strategy logic on the same tick stream semantics.

Any live/backtest divergence is a bug.

## Main structure

```text
strategy-research-framework/
  README.md
  STRATEGY_RESEARCH_FORMAT.md
  NAMING.md

  templates/
    FAMILY.template.md
    VERSION.template.md
    CANDIDATE.template.md
    global-index.template.json
    family-index.template.json

  schemas/
    family.schema.ts
    version.schema.ts
    candidate.schema.ts
    global-index.schema.ts
    family-index.schema.ts
    index.ts

  modules/
    strategy-proposals/
      README.md

scripts/
  validate-strategy-research.ts

src/strategies/
  index.json
```

## File type rule

```text
.json = indexes, navigation, status, paths, tags, duplicate keys
.md   = reasoning, explanation, proposals, implementation notes, decisions
```

## Validation

After creating or editing strategy research artifacts, run:

```bash
npm run validate:strategy-research
```

Suggested `package.json` script:

```json
{
  "scripts": {
    "validate:strategy-research": "tsx scripts/validate-strategy-research.ts"
  }
}
```

Required packages:

```bash
npm install -D zod gray-matter tsx
```
