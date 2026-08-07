---
title: Writing Missions
description: How to author a MISSION.md that runs reliably on the Global Runtime.
---

# Writing missions

This guide explains how to write a `MISSION.md` that runs well on the [Global Runtime](/global-runtime/overview). It is written to be usable as direct context for a model: when asking an LLM to draft or revise a mission file, include this page in the prompt and instruct it to follow the rules below.

A mission file is the **entire assignment** for a loop of fresh CLI sessions. Each session starts with no conversation history, reads the mission and the workspace files, does one increment of work, and exits. Whatever the mission does not state, or the workspace files do not record, does not exist for the next session.

## What the runtime already provides

Every session receives the runtime's session-contract prompt before it reads the mission. That prompt already instructs the agent to:

- read the mission file and follow it;
- recover state from the status file and keep it current;
- process new inbox entries and advance the inbox marker;
- append milestones to the journal;
- write `.global-runtime/session-result.json` with `action` (`continue` | `complete` | `wait`) and `summary`.

**Do not restate these mechanics in the mission file, and never contradict them.** The mission adds only the domain: what the work is, how it is divided into sessions, and when it counts as done. The prompt also states "You are session N of at most M" — a mission may reference those numbers, but must not assume specific values.

## Rules

1. **Define the objective so completion is checkable from files.** "Return `complete` when `REPORT.md` contains a ranked result for every hypothesis in `HYPOTHESES.md`" works across fresh sessions; "finish when the analysis feels thorough" does not — vague criteria make loops run forever or complete early.
2. **Define one bounded unit of work per session.** Fresh sessions are good at "do the next crisply-defined unit" and bad at "continue where you left off". State the unit explicitly: one hypothesis evaluated, one module implemented, one dataset processed. A session that finishes its unit early may start the next one, but must never leave a unit half-recorded.
3. **Declare the mission's own working files.** The status, journal, and inbox files belong to the communication contract — keep domain artifacts out of them. Name every file the mission owns (`PLAN.md`, `FINDINGS.md`, `REPORT.md`, …), what each contains, and which session creates it. List the important ones as read-only files on the run so Mission Control displays them.
4. **State the re-entry order.** Begin the mission with the exact reading order for a fresh session, for example: "Read `PLAN.md`, then the last section of `FINDINGS.md`, then take the first unchecked item in `PLAN.md`."
5. **Make every session end in a consistent state.** Work products are updated before the session returns its result, partial work is either completed or explicitly marked as not started, and nothing important lives only in the session's output text.
6. **Spell out the boundaries.** `workspace-write` bounds writes, not reads — a workspace nested inside a repository can still read the surrounding code. If the mission must not use the network, launch subagents, or inspect the parent repository, say so in the mission file (see the [loop example](/global-runtime/examples) mission for the pattern).
7. **If the mission touches a Git repository, own the Git discipline.** The runtime never runs Git — the mission file must say what the agent does with it. **Protocol workspaces (`polymarket-protocols`) have a fixed contract**: commit the protocol's own folder at every milestone and push straight to `main` with the retry loop — no branches, no PRs; point the mission at `_shared/GIT.md` and do not invent a different scheme ([#227](https://github.com/ivanmijatovic89/polymarket-bot/issues/227)). For any *other* repository, instruct the agent to work on a named branch and commit at the end of every session, so an interrupted session loses at most one unit of work.

## Choosing the action

Give the mission explicit rules for the three actions:

| Action | Use when | Mission must state |
| --- | --- | --- |
| `continue` | The completion criteria are not met and the next unit of work is known. | What the next session will pick up. |
| `complete` | The completion criteria are met, verifiably from files. | The final artifact that proves it. |
| `wait` | A decision, credential, or external change is needed first. | That the question goes under `Needs human` in the status file. |

::: warning
`wait` halts the loop until a human resumes it. A mission should reserve it for genuine blockers and phrase the `Needs human` entry as a directly answerable question. Everything answerable from files or from the mission text must not become a `wait`.
:::

## Steering and revising

Two channels change a running mission's behavior:

- **Inbox** — for course corrections that fit in a sentence or two. The next session applies them, per the [communication contract](/global-runtime/overview#_3-human-communication-contract).
- **Editing the mission file** — for structural changes. Sessions read the mission fresh every time, so an edit applies from the next session, and each session records a hash of the mission it ran under, keeping the history auditable.

To develop a new mission cheaply: create the loop with `--max-sessions 1`, run it, read the status file and the produced artifacts, revise the mission text, then [extend and resume](/global-runtime/cli#continuing-a-capped-loop). Treat the session limit as a budget guard, not as a work plan — missions should finish because their criteria are met, not because the allowance ran out.

## Skeleton

```markdown
# Mission: <name>

## Objective
<One paragraph. Completion must be checkable from the files below.>

## On session start
1. Read <file> …
2. Read <file> …
3. Pick the next unit: <how to find it>.

## Unit of work
<What exactly one session accomplishes and records.>

## Files
- `PLAN.md` — <owner: session 1; content>
- `FINDINGS.md` — <appended every session; format>
- `REPORT.md` — <final artifact; structure>

## Constraints
- <network / parent repository / subagents / tooling>
- <Git discipline, if applicable>

## Completion
Return `complete` when <file-checkable criteria>.
Return `wait` only when <blocker classes>; put the question under "Needs human".
Otherwise return `continue` and note the next unit in the status file.
```

## Checklist

Before starting the loop, verify the mission file:

- [ ] Objective is checkable from named files.
- [ ] One session's unit of work is unambiguous.
- [ ] A fresh session knows what to read, in what order.
- [ ] Every mission-owned file is named, with its format and owner.
- [ ] Rules for `continue` / `complete` / `wait` are explicit.
- [ ] Boundaries (network, parent repository, subagents, Git) are stated.
- [ ] Nothing restates or contradicts the runtime's session contract.
