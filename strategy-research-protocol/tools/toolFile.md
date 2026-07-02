# Tool File Convention

In this protocol, a tool is an approved operation an agent may perform.

A tool may be implemented by a CLI command, script, API call, database query, or
a mix of these. Keep tool docs short and action-focused.

## Required Shape

Use this shape for every tool file:

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
- Use repo-relative display paths with portable relative Markdown links.

## Output

- What this produces or returns.

## After Success

- What files or memory references must be updated.

## If It Fails

- What the agent should fix or report.
````

## Rules

- One tool file describes one operation.
- Put raw commands only under `Implementation`.
- Do not copy full CLI/API manuals into tool files; link to the source of truth.
- Use repo-relative display paths for file references, for example
  [`strategy-research-protocol/RESEARCH_SCOPE.md`](../RESEARCH_SCOPE.md).
- Keep workflow logic in `modules/`, not tool files.
- State required memory updates explicitly.
- If implementation changes, update `Implementation`; keep the tool name stable
  unless the operation meaning changes.
