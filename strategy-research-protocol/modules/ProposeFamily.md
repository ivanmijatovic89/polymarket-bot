# Worker: propose-family

Propose **one** new strategy family and make its baseline experiment ready to
run. This worker writes the family memory files and `000-baseline.ts`, then
stops. It does not run backtests, evaluate results, promote champions, or edit
[`src/strategies/research/INDEX.json`](../../src/strategies/research/INDEX.json).

## Output

Create exactly one folder:

```text
src/strategies/research/<family>/
  FAMILY.md
  FAMILY.json
  000-baseline.ts
```

Do not write family artifacts under `strategy-research-protocol/`. Strategy code
must live under `src/` so auto-discovery can import it.

## Inputs

Read these before writing:

- [`strategy-research-protocol/RESEARCH_SCOPE.md`](../RESEARCH_SCOPE.md) -
  research scope and market assumptions.
- [`strategy-research-protocol/PolymarketTwinEngine.md`](../PolymarketTwinEngine.md) -
  tick, replay, order, cost, latency, and dataset semantics.
- [`src/strategies/research/INDEX.json`](../../src/strategies/research/INDEX.json) -
  generated map of existing research families for deduplication.
- [`strategy-research-protocol/MEMORY.md`](../MEMORY.md) - family memory rules.
- [`strategy-research-protocol/CONSTRAINTS.md`](../CONSTRAINTS.md) - hard ban
  list.
- [`strategy-research-protocol/rules/FAMILY-NAMING.md`](../rules/FAMILY-NAMING.md) -
  family slug and duplicate rules.
- [`strategy-research-protocol/rules/EXPERIMENT-NAMING.md`](../rules/EXPERIMENT-NAMING.md) -
  baseline id, code file, registry id, champion pointer, and freeze rule.
- [`strategy-research-protocol/rules/BATCH-UID.md`](../rules/BATCH-UID.md) -
  future backtest batch label convention.
- `strategy-research-protocol/schemas/` - exact shapes for `FAMILY.md` and
  `FAMILY.json`.

Optional input: a one-line seed idea from the user. Without a seed, propose
autonomously from research memory.

## Dedup Scope

Deduplication is against research families only.

Use
[`src/strategies/research/INDEX.json`](../../src/strategies/research/INDEX.json)
as the complete universe of existing research families. You may open a listed
family's `FAMILY.md`, `FAMILY.json`, and strategy files when the index suggests
possible overlap.

Do not scan the legacy strategy library outside `src/strategies/research/` for
deduplication. Reading a small number of non-research strategies only for API
idioms is allowed when writing code.

## Steps

1. **Read required context.** Do not propose from memory alone.

2. **Form one idea.**
   - Seed mode: develop the user's seed unless it violates constraints or is a
     duplicate.
   - Autonomous mode: use `INDEX.json`, family memory, constraints, and market
     microstructure reasoning. Do not search the web.

3. **Constraint check.** If the idea violates
   [`strategy-research-protocol/CONSTRAINTS.md`](../CONSTRAINTS.md), discard it.
   In seed mode, stop and report the violated constraint.

4. **Dedup by driver, not by words.**
   - Shortlist with `duplicateKeys`, `tags`, and `coreIdea` from `INDEX.json`.
   - Open likely matches and compare the primary decision driver.
   - Same driver means same family, even if params, filters, exits, or wording
     differ.
   - Similar but independently driven ideas are allowed.

   On a true duplicate:

   - seed mode: stop and report the duplicate; write nothing.
   - autonomous mode: try another idea. After 3-5 real attempts that all
     duplicate existing families, stop and report that the space looks
     saturated.

5. **Choose the family slug.** Follow
   [`strategy-research-protocol/rules/FAMILY-NAMING.md`](../rules/FAMILY-NAMING.md):
   lowercase kebab-case, short, and named after the primary decision driver.

6. **Write `FAMILY.md`.** It must have YAML frontmatter:

   ```yaml
   ---
   artifactType: strategy-family
   family: <family>
   ---
   ```

   Do not put status, champion, or tags in `FAMILY.md` frontmatter. Those fields
   are structured state and belong only in `FAMILY.json`.

   Then include exactly these required H2 sections in this order:

   ```text
   ## Core idea
   ## Primary decision driver
   ## Experiments to try
   ## Allowed experiment directions
   ## Forbidden directions
   ## Known weaknesses
   ## Experiment log
   ## Duplicate notes
   ```

   `Experiments to try` is a ranked plain-English list of at least three
   mechanism-backed ideas. The first item is always the baseline knob sweep.
   These are not queued experiments yet; only `000-baseline` is queued in
   `FAMILY.json`.

7. **Write `FAMILY.json`.** Seed exactly one experiment:

   ```json
   {
     "schemaVersion": 1,
     "artifactType": "strategy-family-index",
     "family": "<family>",
     "status": "proposed",
     "coreIdea": "<one-sentence core idea>",
     "duplicateKeys": ["<normalized-synonym>"],
     "retryOnlyIf": null,
     "champion": null,
     "tags": ["<tag>"],
     "experiments": [
       {
         "id": "000-baseline",
         "order": 1,
         "kind": "param-search",
         "code": "000-baseline.ts",
         "idea": "Baseline knob sweep over the initial decision rule.",
         "basedOn": null,
         "sweep": {
           "<paramName>": ["<values>"]
         },
         "params": null,
         "status": "proposed",
         "decision": "pending",
         "decidedAt": null,
         "result": null,
         "selectedParams": null
       }
     ]
   }
   ```

   Use local experiment ids. Do not prefix the experiment id with the family in
   `FAMILY.json`. Global references use the family plus local id only when the
   consuming rule asks for it, such as batch UID
   `<family>--<experiment-id>`.

8. **Write `000-baseline.ts`.**
   - Learn the local API from `src/strategy/strategyDefinition.ts`,
     `src/strategy/Strategy.ts`, `src/strategy/strategyToolkit.ts`, and
     `src/strategies/templates/Template.v1.ts`.
   - Export `definition` as a `StrategyDefinition`.
   - Use `definition.id = "<family>.000-baseline"`.
   - Define a strict Zod params schema whose knobs match the baseline sweep.
   - Keep all behavior deterministic and safe when optional plugin data is
     missing.
   - Use deterministic `clientOrderId` patterns.
   - Do not edit a registry file; research strategies are auto-discovered.

9. **Typecheck enough to catch API errors.** Do not run a backtest.

10. **Leave `INDEX.json` alone.** The orchestrator runs
    `buildStrategyIndex` afterward.

## Forbidden

- Running backtests or evaluating results.
- Editing
  [`src/strategies/research/INDEX.json`](../../src/strategies/research/INDEX.json).
- Editing another family's files.
- Deduping against the legacy non-research strategy library.
- Seeding more than one experiment in `FAMILY.json`.
- Creating `Strategy.ts`, versioned files, or `v1`/`v2` ids.
- Marking the family `active`; only the user does that.
- Using live-only fields, unrecorded transport behavior, or external feed data
  as a required backtest input.

## Final Self-Check

Before declaring done, verify:

- `src/strategies/research/<family>/FAMILY.md` exists and validates.
- `src/strategies/research/<family>/FAMILY.json` exists and validates.
- `FAMILY.json` contains exactly one experiment, `000-baseline`.
- `champion` is `null`.
- `000-baseline.ts` exists and exports `definition`.
- `definition.id` is `<family>.000-baseline`.
- The baseline sweep keys match the strategy params schema.
- No backtest was run.
- `INDEX.json` was not edited.

## Stop Condition

Stop after one valid family is ready for a future baseline backtest, or after
reporting a duplicate, constraint violation, or saturated idea space with
nothing written.
