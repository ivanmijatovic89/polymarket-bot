# Modules

`strategy-research-protocol/modules/` contains agent worker contracts for
Strategy Research Protocol.

Before executing a workflow, read the dedicated module file. Do not duplicate
worker instructions in
[`strategy-research-protocol/README.md`](../README.md).

## Defined modules

- [`strategy-research-protocol/modules/ProposeFamily.md`](./ProposeFamily.md) -
  propose exactly one new strategy family, write its research artifacts, and
  write the baseline strategy code.

## Planned modules

- `strategy-research-protocol/modules/EvaluateExperiment.md` - evaluate
  backtest results and set experiment decision.
- `strategy-research-protocol/modules/ResearchFamily.md` - run one result-aware
  research iteration for a family.
- `strategy-research-protocol/modules/ProposeNextExperiment.md` - propose the
  next experiment inside an existing family.

Do not implement an autonomous research loop until evaluation rules, versioning
rules, and validation checks are defined.
