# Tool: buildStrategyIndex

Purpose:
Regenerate `src/strategies/research/INDEX.json` from all research strategy
family manifests.

When to use:

- After adding a new `src/strategies/research/<family>/FAMILY.json`.
- After changing any existing `FAMILY.json`.
- After removing or renaming a research strategy family.
- Before finishing any task that changes research strategy family metadata.

Do not use:

- Do not manually edit `src/strategies/research/INDEX.json`.
- Do not run this for strategy code-only changes unless family metadata changed.

Command:

```bash
npm run research:build-index
```

Underlying script:

```bash
tsx strategy-research-protocol/scripts/buildStrategyIndex.ts
```

Inputs:

- `src/strategies/research/*/FAMILY.json`

Output:

- `src/strategies/research/INDEX.json`

Checks performed:

- Validates every `FAMILY.json` against protocol schemas.
- Rejects duplicate family slugs.
- Writes a deterministic global strategy index.

Expected AI behavior:

- Run this tool after editing research family metadata.
- Include the regenerated `INDEX.json` in the final change.
- If the command fails, fix the invalid family metadata instead of editing
  `INDEX.json` manually.
