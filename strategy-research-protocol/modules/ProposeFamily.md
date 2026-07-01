# Worker: propose-family

Propose **one** new strategy family and make its first experiment ready to run.
This worker writes files and the baseline strategy code, then stops. It does not
run backtests, evaluate, or touch INDEX.json.

## Where a family lives (one folder, no exceptions)

Everything for a family — `FAMILY.md`, `FAMILY.json`, and the strategy `.ts` —
lives together in **one** folder:

```
src/strategies/research/<family>/
  FAMILY.md
  FAMILY.json
  Strategy.ts
```

This path is mandatory: the `.ts` must be under `src/` to be imported by the
registry, and the artifacts co-locate with it. Do **not** put FAMILY.md /
FAMILY.json anywhere else (not under `strategy-research-protocol/`). Create files
with the `Write` tool — it creates the folder for you; do **not** call `mkdir`.

## Inputs

- `CONTEXT.md` — the game (venue, instrument, data, costs). Read first.
- `INDEX.json` — the map of every research family already tried. Your entry
  point, and the **complete** universe of what exists for dedup.
- `CONSTRAINTS.md` — hard rules a family must not violate.
- `NAMING.md` — how to name a family and its experiments.
- `schemas/` — the shapes you must emit (FAMILY.md, FAMILY.json).
- **Optional seed** — a one-line idea from the user. If absent, run autonomous.

**Scope — dedup against research families only.** For _dedup_, INDEX.json is the
complete universe: it lists the research families, and you may open a listed
family's `FAMILY.md` and `Strategy.ts` (via its `path`) when one looks related.
Do **NOT** scan or dedup against the legacy strategy library elsewhere in
`src/strategies/` (split/, scalp/, signals/, root files) — it is out of scope
and reading it all wastes a large amount of context. If INDEX.json is empty,
there is nothing to dedup against — just propose.

**Code reference (use judgment).** When you write the strategy `.ts` (step 6),
good starting points for the API and idioms: `src/strategy/strategyDefinition.ts`,
`Strategy.ts`, `strategyToolkit.ts`, and `src/strategies/templates/Template.v1.ts`.
Reading an existing strategy or two for idioms is fine — you don't need to read
the whole library; a couple of examples is plenty. (This is for _code shape_,
not dedup.)

## Steps

1. **Read** CONTEXT.md, INDEX.json, CONSTRAINTS.md, NAMING.md.

2. **Form an idea.**
   - Seed mode: develop the family around the user's seed.
   - Autonomous mode: reason over the research memory — read INDEX, drill into
     the FAMILY.md lessons of families that look relevant, and find an
     unexplored gap or an implication of what already failed. Ideas come from
     this reasoning + market-microstructure knowledge. **Do not search the web.**

3. **Constraint check.** If the idea violates anything in CONSTRAINTS.md, discard
   it. (Seed mode: stop and report which constraint it hits.)

4. **Dedup by reading code, not string-matching — within `research/` only.**
   Use duplicateKeys / tags / coreIdea **from INDEX.json** to **shortlist** the
   few research families worth inspecting. Then open those families' FAMILY.md +
   Strategy.ts (under `src/strategies/research/`) and judge whether the
   **decision driver / logic is genuinely the same.** Never dedup against the
   legacy strategy library outside `research/`.
   - Similar-but-different is allowed. Only same-actual-logic is a duplicate.
   - On a real duplicate:
     - Seed mode → stop and report the duplicate. Write nothing.
     - Autonomous mode → try a different idea (go to step 2). Remember the ideas
       you already rejected this run. After ~3–5 distinct attempts all land on
       existing families, stop and report: "space looks saturated — give a seed
       or a new direction." Write nothing.

5. **Write the family folder** at `src/strategies/research/<family>/`.
   - `FAMILY.md` — frontmatter (`artifactType: strategy-family`, family, status
     `proposed`, champion `null`, tags) + the required H2 sections. The
     **Experiments to try** section is a ranked plain-prose list of ≥3
     mechanism-backed ideas (no padding). The baseline knob sweep is always #1.
   - `FAMILY.json` — `status: proposed`, `champion: null`, `retryOnlyIf: null`,
     and `duplicateKeys`: a few normalized synonyms of this family's idea (so
     future proposals can dedup against it). With **exactly one** experiment
     seeded:
     - `id: <family>.001-baseline-sweep`, `order: 1`, `kind: "param-search"`
     - `code`: the base strategy filename (e.g. `Strategy.ts`)
     - `sweep`: the baseline knob grid · `params: null` · `status: "proposed"` ·
       `decision: "pending"` · `result: null` · `selectedParams: null`
   - Do **not** seed the other ideas as experiments — they stay as prose in the
     "Experiments to try" list. They become experiments later, result-aware, via
     propose-next-experiment.

6. **Write the baseline strategy code** (this worker owns it — you are at peak
   context for the idea, so you write the code, not a later handoff):
   - To learn the API/idioms, see "Code reference" above (the interfaces +
     `templates/Template.v1.ts`, plus an example or two if helpful).
   - Implement the base strategy `.ts` under the family folder, exposing the
     knobs the baseline sweep ranges over (its Zod param schema).
   - It must `export const definition` (a `StrategyDefinition`). **No registry
     edit needed** — strategies are auto-discovered from `src/strategies/**`.
   - Make sure it typechecks. Do not run a backtest.

7. **Do not touch INDEX.json.** The orchestrator runs `buildStrategyIndex` afterward.

## Forbidden

- Deduping against the legacy library — dedup is against INDEX.json (research
  families) only. (Glancing at a strategy or two for _code idioms_ is fine;
  scanning the whole library to check for duplicates is not.)
- Running backtests or evaluating anything.
- Editing INDEX.json or any other family's files/code.
- Seeding more than one experiment.
- Marking the family `active` (only the user promotes a family).

## Final self-check (before you declare done)

Confirm ALL of these exist in `src/strategies/research/<family>/` and are
consistent — if any is missing, you are NOT done:

- `FAMILY.md` exists and has all 8 required H2 sections.
- `FAMILY.json` exists, validates, and seeds exactly one experiment.
- `Strategy.ts` exists, `export`s a valid `definition`, and typechecks
  (it is auto-discovered — no registry entry to check).

The research record (FAMILY.md + FAMILY.json) is the primary deliverable — never
finish with code written but the artifacts missing or elsewhere.

## Stop condition

Stop after the self-check passes for one family, OR after reporting a duplicate /
constraint violation / saturated-space with nothing written.
