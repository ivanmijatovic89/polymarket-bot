# Modules

`strategy-research-protocol/modules/` contains agent worker contracts for
Strategy Research Protocol. Before executing a workflow, read the dedicated
module file. Do not duplicate worker instructions in
[`strategy-research-protocol/README.md`](../README.md).

## Defined modules

- [`strategy-research-protocol/modules/ProposeFamily.md`](./ProposeFamily.md) —
  propose exactly one new strategy family: proposal doc, FAMILY.json with one
  queued `000-baseline`, and the baseline strategy code.
- [`strategy-research-protocol/modules/Researcher.md`](./Researcher.md) —
  drive one family, one iteration per invocation: spec/code experiments,
  submit runs and stage extensions, write Research-log entries and lessons,
  decide continue-or-kill per
  [`strategy-research-protocol/STAGE-GATES.md`](../STAGE-GATES.md).
- [`strategy-research-protocol/modules/Evaluator.md`](./Evaluator.md) — sole
  reader of raw results: judge passes and experiments, write outcomes and
  verdicts, move the champion pointer, set families `validated`.

## Role boundaries

The Researcher never reads raw results; the Evaluator never writes FAMILY.md;
only the user sets `live`. Field-level writer rules live in
[`strategy-research-protocol/MEMORY.md`](../MEMORY.md).
