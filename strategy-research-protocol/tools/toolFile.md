# Tool File Convention

This file defines how to write a protocol tool document.

In this protocol, a tool means an approved operation an agent may perform. A
tool can be implemented by a CLI command, script, API call, database query, or a
combination of these.

Tool files live in `strategy-research-protocol/tools/` and should be named after
the operation:

```text
tools/runBacktest.md
tools/extendBacktest.md
tools/getBacktestResults.md
tools/buildStrategyIndex.md
```

Use higher-level operation names, not raw implementation names. For example,
prefer `getBacktestResults.md` over `mysqlQueryBacktestRuns.md`.

## Required Structure

Every tool file should use this structure:

````md
# Tool: <toolName>

## Purpose

One short paragraph explaining what this operation does.

## When To Use

- Cases where an agent should use this tool.

## When Not To Use

- Cases where this tool would be wrong or unsafe.

## Inputs

- Required and optional inputs.
- Expected formats.
- Defaults, if any.

## Implementation

Current implementation type: CLI | script | API | database | mixed

Command/API/query:

```bash
...
```

## Outputs

- What the operation returns or creates.
- Important identifiers the agent must preserve.

## Memory Updates

- Which research files should be updated after success.
- Which result references should be written to `FAMILY.json`.
- Which human-readable notes should be written to `FAMILY.md`.

## Failure Handling

- Common failure modes.
- What the agent should do when the operation fails.

## Expected Agent Behavior

- Final checklist for using this tool correctly.
````

## Writing Rules

- Keep the tool file focused on one operation.
- Put raw commands only in the `Implementation` section.
- Do not duplicate long workflow instructions from `modules/`.
- Do not hide required memory updates in prose; list them explicitly.
- If the implementation changes from CLI to API or database query, update only
  the `Implementation` section unless the operation semantics also change.
- If a tool creates or reads result identifiers, state exactly which identifiers
  must be preserved.
- If a tool affects research state, state exactly which files must be updated.

## Tool vs Module

A tool document answers:

```text
How does an agent perform one approved operation?
```

A module document answers:

```text
What workflow should an agent follow across multiple operations?
```

Example:

- `tools/runBacktest.md` explains how to run one backtest.
- `modules/ResearchFamily.md` explains when to run, extend, evaluate, or stop.

Modules should call tools by name instead of repeating command syntax.
