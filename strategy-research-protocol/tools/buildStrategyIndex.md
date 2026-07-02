# Tool: buildStrategyIndex

## Purpose

Regenerate `src/strategies/research/INDEX.json` from family metadata.

## Use When

- A research family `FAMILY.json` was added, changed, removed, or renamed.

## Do Not Use When

- Only strategy code changed.
- You are trying to fix `INDEX.json` manually.

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

- `src/strategies/research/INDEX.json`

## After Success

- Include the regenerated `INDEX.json` in the change.

## If It Fails

- Fix the source `FAMILY.json`.
- Rerun this tool.
- Never hand-edit `INDEX.json`.
