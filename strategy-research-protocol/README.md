# Strategy Research Protocol

Strategy Research Protocol is the research layer on top of
[`strategy-research-protocol/PolymarketTwinEngine.md`](./PolymarketTwinEngine.md).
Its purpose is to help agents and humans propose, implement, backtest,
evaluate, and preserve memory for strategy families targeting Polymarket 15
minute Bitcoin up/down markets.

The protocol is being built incrementally. Today it defines family proposal,
family artifacts, schemas, naming rules, and index generation. The autonomous
research loop, evaluator contract, and full validation command are still being
defined.

## Repository Context

This folder lives inside the `polymarket-bot` repository. In this protocol,
`polymarket-bot/` is the current codebase that implements PolymarketTwinEngine:

```text
polymarket-bot/                 # PolymarketTwinEngine codebase
  docs/                         # engine and operational documentation
  src/                          # TypeScript source code
  dashboard/                    # backtest/dashboard UI
  strategy-research-protocol/   # this protocol
```

`strategy-research-protocol/` defines the research protocol only. The executable
engine, strategy runtime, backtest system, dashboard, and detailed operational
docs live in `polymarket-bot/`.

Common terms are defined in
[`strategy-research-protocol/GLOSSARY.md`](./GLOSSARY.md).

## Scope

This protocol currently targets only Polymarket 15 minute Bitcoin up/down binary
markets. The full research assumptions are defined in
[`strategy-research-protocol/RESEARCH_SCOPE.md`](./RESEARCH_SCOPE.md).

For background on Polymarket and prediction markets, see
[`docs/polymarket/index.md`](../docs/polymarket/index.md).

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
- Generated global
  [`src/strategies/research/INDEX.json`](../src/strategies/research/INDEX.json)
  rollups.

PolymarketTwinEngine remains responsible for market decoding, replay, live
execution, portfolio handling, order management, and strategy execution.

## Repository layout

- `strategy-research-protocol/modules/` - agent worker instructions.
- `strategy-research-protocol/schemas/` - Zod schemas for protocol artifacts.
- `strategy-research-protocol/rules/` - naming, versioning, and other protocol rules.
- `strategy-research-protocol/tools/` - tool contracts agents should read before running commands.
- `strategy-research-protocol/scripts/` - executable helper scripts.
- `strategy-research-protocol/examples/` - reference examples for protocol artifacts.
- [`strategy-research-protocol/RESEARCH_SCOPE.md`](./RESEARCH_SCOPE.md) -
  authoritative market, data, input, and cost assumptions.
- [`strategy-research-protocol/CONSTRAINTS.md`](./CONSTRAINTS.md) - short
  curated ban list that new families must not violate.
- [`strategy-research-protocol/MEMORY.md`](./MEMORY.md) - authoritative research
  memory rules.
- [`strategy-research-protocol/GLOSSARY.md`](./GLOSSARY.md) - short definitions
  for project and protocol terms.
- [`strategy-research-protocol/PolymarketTwinEngine.md`](./PolymarketTwinEngine.md) -
  summary of the underlying engine.

Research families do not live inside this protocol folder. They live in the
main source tree:

```text
src/strategies/research/<family>/FAMILY.md
src/strategies/research/<family>/FAMILY.json
src/strategies/research/<family>/Strategy.ts
```

The global research index is generated at:

```text
src/strategies/research/INDEX.json
```

## Research artifacts

- `src/strategies/research/<family>/FAMILY.md` - human/agent reasoning and
  memory for one family.
- `src/strategies/research/<family>/FAMILY.json` - structured family state and
  experiment queue.
- `src/strategies/research/<family>/Strategy.ts` - executable baseline strategy
  code for the family.
- [`src/strategies/research/INDEX.json`](../src/strategies/research/INDEX.json) -
  generated global rollup for discovery and deduplication.

Do not edit [`src/strategies/research/INDEX.json`](../src/strategies/research/INDEX.json)
manually. Use the
`buildStrategyIndex` tool.

## Research lifecycle

The intended loop is:

```text
propose family
-> run baseline experiment
-> evaluate result
-> extend, iterate, kill, or promote
-> update research memory
-> rebuild src/strategies/research/INDEX.json
```

The current implemented part is the first step: proposing a family and
generating the index. The remaining loop pieces should be added one by one and
kept explicit.

## Research memory

Research memory rules are defined in
[`strategy-research-protocol/MEMORY.md`](./MEMORY.md). Agents must update memory
after meaningful research steps so the next agent can continue from files alone.

Statuses and decision enums are defined in
[`strategy-research-protocol/schemas/statuses.ts`](./schemas/statuses.ts). The
evaluator thresholds are not defined yet.

## Tools

Protocol tools are documented in
[`strategy-research-protocol/tools/index.md`](./tools/index.md). Read the tool
document before running the command behind a tool.

Currently defined:

- `buildStrategyIndex` - regenerates
  [`src/strategies/research/INDEX.json`](../src/strategies/research/INDEX.json)
  from family manifests.
- `runBacktest` - creates a new backtest run for a strategy experiment.
- `extendBacktest` - adds market coverage to an existing Telonex run.
- `getBacktestResults` - retrieves persisted result summaries for evaluation
  and memory updates.

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

- Module list: [`strategy-research-protocol/modules/index.md`](./modules/index.md)
- New family proposal:
  [`strategy-research-protocol/modules/ProposeFamily.md`](./modules/ProposeFamily.md)
- Tool list: [`strategy-research-protocol/tools/index.md`](./tools/index.md)
- Index generation:
  [`strategy-research-protocol/tools/buildStrategyIndex.md`](./tools/buildStrategyIndex.md)
- Family naming rules:
  [`strategy-research-protocol/rules/FAMILY-NAMING.md`](./rules/FAMILY-NAMING.md)
- Experiment naming, code files, champion pointer:
  [`strategy-research-protocol/rules/EXPERIMENT-NAMING.md`](./rules/EXPERIMENT-NAMING.md)
- Batch UID naming:
  [`strategy-research-protocol/rules/BATCH-UID.md`](./rules/BATCH-UID.md)

Agents must preserve the live/backtest invariant and should not invent missing
protocol behavior. If a required module is missing, add that module explicitly
before depending on it.

## Current gaps

These are the next pieces to define:

- `strategy-research-protocol/modules/ResearchFamily.md` - the main
  one-iteration research worker.
- `strategy-research-protocol/modules/ProposeNextExperiment.md` - result-aware
  experiment proposal.
- `strategy-research-protocol/modules/EvaluateExperiment.md` - objective
  evaluator contract.
- `npm run research:check` - full protocol validation.
- Stronger schema invariants across
  `src/strategies/research/<family>/FAMILY.md`,
  `src/strategies/research/<family>/FAMILY.json`, strategy files, and
  [`src/strategies/research/INDEX.json`](../src/strategies/research/INDEX.json).

Build the protocol one step at a time. Each new piece should be small,
validated, and usable by an agent without relying on implicit knowledge.
