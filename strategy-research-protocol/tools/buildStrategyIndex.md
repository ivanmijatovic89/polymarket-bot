# Tool: buildStrategyIndex

## Purpose

Regenerate
[`src/strategies/research/INDEX.json`](../../src/strategies/research/INDEX.json)
from family metadata.

`INDEX.json` is a generated research memory artifact defined in
[`strategy-research-protocol/MEMORY.md`](../MEMORY.md).

## Use When

- A research family `src/strategies/research/<family>/FAMILY.json` was added,
  changed, removed, or renamed.

## Do Not Use When

- Only strategy code changed.
- You are trying to fix
  [`src/strategies/research/INDEX.json`](../../src/strategies/research/INDEX.json)
  manually.

## Inputs

- `src/strategies/research/*/FAMILY.json`

## Implementation

Current implementation: CLI

```bash
npm run research:build-index
```

Check only:

```bash
npm run research:build-index -- --check
```

## Output

- [`src/strategies/research/INDEX.json`](../../src/strategies/research/INDEX.json)

## After Success

- Include the regenerated
  [`src/strategies/research/INDEX.json`](../../src/strategies/research/INDEX.json)
  in the change.

## If It Fails

- Fix the source `src/strategies/research/<family>/FAMILY.json`.
- Rerun this tool.
- Never hand-edit
  [`src/strategies/research/INDEX.json`](../../src/strategies/research/INDEX.json).
