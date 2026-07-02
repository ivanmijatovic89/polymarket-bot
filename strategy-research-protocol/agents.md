# AGENTS.md

This folder is not a strategy implementation folder. It is the evolving design
and operating protocol for strategy research.

When working here, help the user define a reliable research process for
discovering, testing, evaluating, and preserving memory for strategy families in
`src/strategies/research/`.

## Mission

Help the user make Strategy Research Protocol clearer, safer, and more useful
one small step at a time.

The protocol is not fully defined yet. Treat the current files as a working
draft. Your job is to help turn rough intent into explicit rules, modules,
schemas, tools, and checks that future agents can execute without guessing.

The protocol should make it possible for agents to:

- Propose new strategy families.
- Avoid duplicate or out-of-scope ideas.
- Implement baseline strategy code consistently.
- Run and extend backtest experiments.
- Evaluate results with explicit criteria.
- Update durable research memory.
- Regenerate the global research index.

Do not assume missing protocol pieces exist. If a workflow needs a module, rule,
schema, or tool that is not defined yet, propose it or add it explicitly.

## Self-maintenance rule

Keep this `AGENTS.md` aligned with the protocol as it changes.

Before finishing any change in this folder, check whether the change alters how
Codex should work here. If it does, update this file in the same change.

Examples that should trigger an `AGENTS.md` update:

- A file is renamed, added, or removed from the protocol map.
- The research scope changes.
- The recommended build order changes.
- A new worker module becomes authoritative.
- A rule moves from draft to enforced.
- A tool or command such as `researchCheck` / `research:check` is added.
- A previous instruction becomes misleading.

Examples that usually do not require an `AGENTS.md` update:

- Typo-only edits.
- Small wording improvements that do not change behavior.
- Adding detail inside a module without changing the workflow.

Pre-commit/pre-finish question:

```text
Would a fresh Codex agent behave incorrectly if it only read the current
AGENTS.md plus the files it links to?
```

If the answer is yes, update `AGENTS.md`.

## Current research scope

Read [`RESEARCH_SCOPE.md`](./RESEARCH_SCOPE.md) before making protocol changes
that affect research behavior.

Current scope is deliberately narrow:

```text
Polymarket BTC 15 minute up/down binary markets only
```

Do not expand the protocol to ETH, SOL, XRP, 5m, 1h, other venues, or
cross-exchange signals unless the user explicitly changes the scope.

## Core invariant

Live trading and backtests must run the same strategy logic on the same tick
stream semantics. Any live/backtest divergence is a bug.

When reviewing or proposing protocol changes, check whether the change could
cause one of these failures:

- Strategy logic exists only in live or only in backtest.
- Backtest uses inputs that live trading will not have.
- Live uses inputs that replay cannot reproduce.
- Tick ordering, market rotation, or 15 minute window semantics become unclear.
- Execution, fill, or portfolio semantics diverge between runtimes.

## File roles

- [`README.md`](./README.md) is the map of the protocol.
- [`RESEARCH_SCOPE.md`](./RESEARCH_SCOPE.md) defines the research game and
  allowed assumptions.
- [`CONSTRAINTS.md`](./CONSTRAINTS.md) is the short curated ban list for ideas
  the user does not want.
- [`modules/`](./modules) contains worker instructions for agents.
- [`rules/`](./rules) contains protocol rules such as naming and versioning.
- [`schemas/`](./schemas) contains Zod schemas for protocol artifacts.
- [`tools/`](./tools) describes executable tools agents may use.
- [`examples/`](./examples) contains reference artifacts; keep examples valid
  because agents copy patterns from them.

Research families themselves live outside this folder:

```text
src/strategies/research/<family>/
  FAMILY.md
  FAMILY.json
  Strategy.ts
```

Research memory is file-based. README gives the overview; family-specific
memory belongs in `FAMILY.md` and `FAMILY.json`, and global memory is generated
into `src/strategies/research/INDEX.json`.

## How to help the user

The user is building this protocol incrementally. Prefer concrete, scoped
suggestions over broad redesigns.

When the user is unsure, help by:

- Naming the ambiguity.
- Proposing two or three concrete options.
- Recommending one option with a short reason.
- Offering to encode the decision in the right protocol file.

Do not just say that something is missing. Suggest where it should live and how
it should affect future agent behavior.

Good suggestions:

- "Define `rules/VERSIONING.md` next because strategy filenames are currently
  inconsistent."
- "Add `modules/EvaluateExperiment.md` before automating the research loop."
- "Add schema checks that `champion` points to an existing experiment."
- "Move this detail from README to `RESEARCH_SCOPE.md` to reduce duplication."

Weak suggestions:

- "Build the whole autonomous system now."
- "Run many backtests before evaluator criteria exist."
- "Add another framework or service before the protocol is stable."

## Editing guidance

When editing protocol files:

- Keep docs in English.
- Keep the protocol deterministic and explicit.
- Prefer short, linked documents over one large file.
- Avoid duplicating the same detailed rules in many places.
- If duplication is necessary for a critical invariant, keep one file
  authoritative and make the other file link to it.
- Update references when renaming files.
- Keep examples aligned with schemas and current rules.
- Do not silently broaden research scope.
- Update `AGENTS.md` when the agent-facing workflow changes.

Use protocol vocabulary consistently:

- Tool = protocol-approved operation.
- Command = shell invocation used by a tool.
- Script = implementation file behind a command.

Prefer adding or documenting a tool over listing raw commands in README.

## Protocol maturity

Assume most of this protocol is still draft until it has:

- A named file that defines the rule.
- A module or tool that tells agents how to apply it.
- A schema or check that can catch violations where practical.
- An example that demonstrates the intended shape.

When improving the protocol, prefer making one draft rule explicit over adding
large amounts of process that cannot yet be validated.

## Suggested build order

Unless the user chooses a different priority, improve the protocol in this
order:

1. `RESEARCH_SCOPE.md` - lock market/data/cost assumptions.
2. `rules/VERSIONING.md` - define strategy file naming and promotion rules.
3. `modules/EvaluateExperiment.md` - define result evaluation criteria.
4. `modules/ResearchFamily.md` - define one research iteration.
5. `modules/ProposeNextExperiment.md` - define result-aware experiment creation.
6. `npm run research:check` - validate artifacts and invariants.
7. Stronger schema cross-field checks.

This order is a recommendation, not a law. If new information makes a different
next step more useful, explain the tradeoff and update this section if the new
order should guide future agents.

## New family workflow

The new-family worker should:

1. Read `RESEARCH_SCOPE.md`, `src/strategies/research/INDEX.json`,
   `CONSTRAINTS.md`, `rules/NAMING.md`, and the schemas.
2. Propose exactly one family.
3. Deduplicate only against existing research families in `INDEX.json`.
4. Write one family folder under `src/strategies/research/<family>/`.
5. Seed exactly one baseline experiment:
   `<family>.001-baseline-sweep`.
6. Write baseline `Strategy.ts`.
7. Do not run backtests.
8. Do not manually edit generated `INDEX.json`.

See [`modules/ProposeFamily.md`](./modules/ProposeFamily.md) for the current
worker contract.

## Research family loop

The intended research loop is:

```text
propose experiment
-> run backtest
-> evaluate results
-> extend, iterate, kill, or promote
-> update memory
-> regenerate INDEX.json
```

Do not implement this as an autonomous loop until evaluation rules, versioning
rules, and validation checks are defined.

## Review checklist

Before finishing a protocol change, ask:

- Did this preserve BTC 15m-only scope?
- Did this preserve live/backtest parity?
- Did this reduce ambiguity for future agents?
- Did this update all affected links and filenames?
- Did this avoid duplicating authoritative rules unnecessarily?
- Should README link to a deeper rule file instead of restating details?
- Are examples still valid under the schemas and current rules?
- Does `AGENTS.md` still describe how Codex should work in this folder?
