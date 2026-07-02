# TODO

This is the cleanup plan for making Strategy Research Protocol easier for an
LLM agent to understand and execute.

## 1. Decide `tools/` vs `cli/`

Decision needed:

- Use `cli/` if the folder is mainly a catalog of shell commands and how to run
  them.
- Use `tools/` if the folder defines higher-level agent operations with inputs,
  outputs, result references, and required memory updates.

Recommendation:

Use `cli/` for now if the goal is maximum clarity. The protocol currently wraps
existing CLI commands, and `cli/` makes that obvious. Later, if some operations
stop being CLI-backed, consider renaming to `operations/`.

If we choose `cli/`, update:

- `tools/index.md` -> `cli/index.md`
- `tools/buildStrategyIndex.md` -> `cli/buildStrategyIndex.md`
- README links
- module links
- wording from "tool" to "CLI operation" or "command doc"

## 2. Consolidate engine docs

Current problem:

- `PolymarketTwinEngine.md` is rough.
- `PolymarketTwinEngine2.md` is the better proposed version.
- Two engine docs will confuse agents.

Tasks:

- Replace `PolymarketTwinEngine.md` with the contents of
  `PolymarketTwinEngine2.md`.
- Delete `PolymarketTwinEngine2.md`.
- Keep README linked only to `PolymarketTwinEngine.md`.

## 3. Add a README read order

README should tell agents what to read first.

Suggested order:

1. `README.md`
2. `RESEARCH_SCOPE.md`
3. `PolymarketTwinEngine.md`
4. relevant `modules/*.md`
5. relevant `cli/*.md` or `tools/*.md`
6. relevant `rules/*.md`
7. schemas when writing artifacts

## 4. Move command details out of `RESEARCH_SCOPE.md`

Current problem:

- `RESEARCH_SCOPE.md` defines the research game, but it also contains backtest
  commands.

Tasks:

- Keep dataset assumptions in `RESEARCH_SCOPE.md`.
- Move runnable command details to the CLI/tool docs.
- Link from `RESEARCH_SCOPE.md` to the relevant command doc if needed.

## 5. Define backtest command docs

Needed command docs:

- `runBacktest`
- `extendBacktest`
- `getBacktestResults`

Each doc should define:

- purpose
- when to use
- when not to use
- command/API underneath
- required inputs
- expected outputs
- result ids to preserve
- memory updates required after success
- failure handling

## 6. Fix `rules/VERSIONING.md`

Current problem:

- README links to `rules/VERSIONING.md`, but the file is empty.
- Examples already imply `Strategy.v2.ts`, but no versioning rule exists.

Tasks:

- Define whether baseline is always `Strategy.ts`.
- Define when variations use new files.
- Define naming for variation files.
- Define how experiment `code` points to strategy files.
- Define promotion/champion behavior.

## 7. Fix examples

Current problems:

- `examples/FAMILY.md` has an extra `---`.
- `examples/FAMILY.md` champion does not match the current experiment id style.
- `examples/FAMILY.json` uses `Strategy.v2.ts` before versioning is defined.
- Example queue includes more than one experiment, while the current new-family
  worker seeds exactly one baseline experiment.

Tasks:

- Make examples match current schemas.
- Make examples match current proposal workflow.
- Avoid showing future workflow unless clearly marked as post-baseline example.

## 8. Simplify `modules/ProposeFamily.md`

Current problem:

- It is useful, but too tied to a specific agent tool vocabulary in places.

Tasks:

- Remove or generalize "Write tool" / "do not call mkdir" wording.
- Keep the worker contract focused on artifact outputs and constraints.
- Link to command docs instead of mentioning command behavior directly.

## 9. Define evaluator module

Create `modules/EvaluateExperiment.md`.

It should define:

- required inputs
- result summary required before evaluation
- metrics to inspect
- sample size checks
- outlier/concentration checks
- cost and execution checks
- decision outputs
- required updates to `FAMILY.md` and `FAMILY.json`

## 10. Define one-iteration research module

Create `modules/ResearchFamily.md`.

It should define one loop only:

```text
load family -> choose next action -> run/extend/get results -> evaluate -> update memory
```

Do not define autonomous long-running loops until validation exists.

## 11. Define next-experiment module

Create `modules/ProposeNextExperiment.md`.

It should:

- read prior memory
- avoid duplicate experiments
- choose one next experiment
- update `FAMILY.json`
- update `FAMILY.md`
- avoid running the backtest itself

## 12. Add protocol validation

Eventually add `research:check`.

It should validate:

- schemas
- markdown frontmatter
- required headings
- examples
- index freshness
- champion references
- experiment ids
- strategy file references
- empty linked files such as `rules/VERSIONING.md`

## Suggested immediate next steps

1. Decide whether to rename `tools/` to `cli/`.
2. Consolidate the engine docs.
3. Add README read order.
4. Fix `rules/VERSIONING.md`.
5. Fix examples.
