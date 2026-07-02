# Strategy Research Protocol

Strategy Research Protocol is the research layer on top of
[PolymarketTwinEngine](./PolymarketTwinEngine.md). Its purpose is to help agents
and humans propose, implement, backtest, evaluate, and preserve memory for
strategy families targeting Polymarket 15 minute Bitcoin up/down markets.

The protocol is being built incrementally. Today it defines family proposal,
family artifacts, schemas, naming rules, and index generation. The autonomous
research loop, evaluator contract, and full validation command are still being
defined.

## Market scope

This protocol currently targets only Polymarket 15 minute Bitcoin up/down binary
markets. The full research assumptions are defined in
[RESEARCH_SCOPE.md](./RESEARCH_SCOPE.md).

A binary market has two outcomes. In this scope, the outcomes are whether
Bitcoin closes up or down over a fixed 15 minute window.

Do not expand research to other symbols, timeframes, venues, or cross-exchange
signals unless the protocol is explicitly updated.

For background on Polymarket and prediction markets, see
[docs/polymarket](../docs/polymarket/index.md).

## Core invariant

Live trading and backtests must run the same strategy logic on the same tick
stream semantics. Any live/backtest divergence is a bug.

This rule is more important than experiment velocity. A profitable backtest is
not useful if the live runtime cannot reproduce the same inputs, order lifecycle,
or strategy decisions.

## What this protocol manages

The protocol manages research state, not trading infrastructure itself.

- Strategy family proposals.
- Experiment queues inside each family.
- Backtest result references.
- Evaluator decisions.
- Research memory and duplicate detection.
- Generated global `INDEX.json` rollups.

PolymarketTwinEngine remains responsible for market decoding, replay, live
execution, portfolio handling, order management, and strategy execution.

## Repository layout

- `modules/` - agent worker instructions.
- `schemas/` - Zod schemas for protocol artifacts.
- `rules/` - naming, versioning, and other protocol rules.
- `tools/` - tool contracts agents should read before running commands.
- `scripts/` - executable helper scripts.
- `examples/` - reference examples for protocol artifacts.
- `RESEARCH_SCOPE.md` - authoritative market, data, input, and cost assumptions.
- `CONSTRAINTS.md` - short curated ban list that new families must not violate.
- `PolymarketTwinEngine.md` - summary of the underlying engine.

Research families do not live inside this protocol folder. They live in the
main source tree:

```text
src/strategies/research/<family>/
  FAMILY.md
  FAMILY.json
  Strategy.ts
```

The global research index is generated at:

```text
src/strategies/research/INDEX.json
```

## Research artifacts

### `FAMILY.md`

The human and agent-readable research record for one family. It explains the
core idea, decision driver, experiment menu, known weaknesses, experiment log,
and duplicate notes.

`FAMILY.md` is where reasoning and memory live.

### `FAMILY.json`

The structured source of truth for one family. It stores family status, tags,
duplicate keys, champion reference, retry condition, and the experiment queue.

Agents should update `FAMILY.json` when experiment status, decisions, selected
params, or result references change.

### `Strategy.ts`

The executable baseline strategy for the family. It must export a valid
`StrategyDefinition` and expose a strict Zod parameter schema.

Versioning rules for follow-up strategy files are still being finalized in
[`rules/VERSIONING.md`](./rules/VERSIONING.md).

### `INDEX.json`

The generated global rollup of all research families. It is used for discovery,
deduplication, and routing.

Do not edit `src/strategies/research/INDEX.json` manually. Regenerate it with
`npm run research:build-index`.

## Research lifecycle

The intended loop is:

```text
propose family
-> run baseline experiment
-> evaluate result
-> extend, iterate, kill, or promote
-> update research memory
-> rebuild INDEX.json
```

The current implemented part is the first step: proposing a family and
generating the index. The remaining loop pieces should be added one by one and
kept explicit.

## Research memory

The protocol should preserve research memory in files, not in chat history.

- `FAMILY.md` stores reasoning: hypotheses, lessons, weaknesses, experiment log,
  and duplicate notes.
- `FAMILY.json` stores structured state: status, experiment queue, result
  references, decisions, selected params, champion, and retry conditions.
- `src/strategies/research/INDEX.json` is the generated global memory used for
  discovery and deduplication.

Agents must update memory after meaningful research steps so the next agent can
continue from the files alone.

## Family statuses

- `proposed` - idea and baseline artifacts exist, but no experiment has been
  run yet.
- `experimental` - experiments are running or have run, but there is no champion
  yet.
- `active` - a champion exists and the family is considered useful.
- `killed` - the family was tried and abandoned. Revisit only if `retryOnlyIf`
  applies.
- `blocked` - research is parked on an external blocker.

## Experiment statuses

- `proposed` - queued, not run.
- `implemented` - code exists for a variation, but no backtest job is running.
- `running` - backtest job has been submitted.
- `done` - backtest finished and `result` points to the numeric truth.

## Evaluator decisions

- `pending` - not evaluated.
- `pass` - result beat the required bar.
- `fail` - result did not beat the required bar.
- `iterate` - result is inconclusive but suggests another experiment.
- `promote` - make this experiment the family champion.
- `kill` - stop this experiment or family direction.

The exact evaluator thresholds are not defined yet. They should be captured in
a dedicated evaluator module before autonomous research is allowed to run for
many iterations.

## Tools

Protocol tools are documented in [`tools/index.md`](./tools/index.md). Agents
should read the tool document before running the command behind a tool.

Vocabulary:

- Tool - protocol-approved operation.
- Command - shell invocation used by a tool.
- Script - implementation file behind a command.

Currently defined:

- `buildStrategyIndex` - regenerates
  `src/strategies/research/INDEX.json` from family manifests.

Common command used by this tool:

```bash
npm run research:build-index
```

Planned tool:

- `researchCheck` - validate schemas, markdown/frontmatter consistency,
  strategy file references, index freshness, and protocol invariants.

Planned command:

```bash
npm run research:check
```

`research:check` is not implemented yet.

## Proposer script

Propose one new family with no seed:

```bash
./strategy-research-protocol/scripts/propose-family.sh
```

Propose one new family from a seed idea:

```bash
./strategy-research-protocol/scripts/propose-family.sh "fade large resting walls"
```

## Agent workflow

Before using a tool or worker, read its dedicated instruction file.

- New family proposal: [`modules/ProposeFamily.md`](./modules/ProposeFamily.md)
- Tool list: [`tools/index.md`](./tools/index.md)
- Index generation: [`tools/buildStrategyIndex.md`](./tools/buildStrategyIndex.md)
- Naming rules: [`rules/NAMING.md`](./rules/NAMING.md)
- Versioning rules: [`rules/VERSIONING.md`](./rules/VERSIONING.md)

Agents must preserve the live/backtest invariant and should not invent missing
protocol behavior. If a required module is missing, add that module explicitly
before depending on it.

## Current gaps

These are the next pieces to define:

- `RESEARCH_SCOPE.md` - market, data, fee, benchmark, and replay assumptions.
- `modules/ResearchFamily.md` - the main one-iteration research worker.
- `modules/ProposeNextExperiment.md` - result-aware experiment proposal.
- `modules/EvaluateExperiment.md` - objective evaluator contract.
- `rules/VERSIONING.md` - exact strategy file naming and promotion rules.
- `npm run research:check` - full protocol validation.
- Stronger schema invariants across `FAMILY.md`, `FAMILY.json`, strategy files,
  and `INDEX.json`.

Build the protocol one step at a time. Each new piece should be small,
validated, and usable by an agent without relying on implicit knowledge.
