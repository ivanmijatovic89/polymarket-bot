# Tools

`strategy-research-protocol/tools/` defines executable repository tools
available to AI agents while working with the strategy research protocol. A
tool is an approved operation an agent may perform — implemented by a CLI
command, script, API call, database query, or a mix.

Before using a tool, read its dedicated tool file. Do not duplicate tool
definitions elsewhere.

## Available tools

- `buildStrategyIndex`:
  [`strategy-research-protocol/tools/buildStrategyIndex.md`](./buildStrategyIndex.md)
- `runBacktest`:
  [`strategy-research-protocol/tools/runBacktest.md`](./runBacktest.md)
- `extendBacktest`:
  [`strategy-research-protocol/tools/extendBacktest.md`](./extendBacktest.md)
- `checkBatch`:
  [`strategy-research-protocol/tools/checkBatch.md`](./checkBatch.md)
- `getBacktestResults`:
  [`strategy-research-protocol/tools/getBacktestResults.md`](./getBacktestResults.md)
- `syncWorkerFleet`:
  [`strategy-research-protocol/tools/syncWorkerFleet.md`](./syncWorkerFleet.md)

## Adding a tool file

One tool file describes one operation, short and action-focused, using this
shape:

````md
# Tool: <toolName>

## Purpose

What this operation does.

## Use When

- When an agent should use it.

## Do Not Use When

- When this operation is wrong or unsafe.

## Inputs

- Required inputs.
- Optional inputs.

## Implementation

Current implementation: CLI | script | API | database | mixed

```bash
...
```

## Source Of Truth

- Link to detailed repo docs, source files, or API docs when they exist.

## Output

- What this produces or returns.

## After Success

- What files or memory references must be updated.

## If It Fails

- What the agent should fix or report.
````

Rules:

- Put raw commands only under `Implementation`.
- Do not copy full CLI/API manuals into tool files; link to the source of
  truth.
- Use repo-relative display paths with portable relative Markdown links.
- Keep workflow logic in `modules/`, not tool files.
- State required memory updates explicitly.
- If implementation changes, update `Implementation`; keep the tool name
  stable unless the operation meaning changes.
