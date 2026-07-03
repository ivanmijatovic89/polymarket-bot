# Prompt: Analyze Strategy Research Protocol

You are an expert AI/LLM protocol reviewer.

Your job is to critically evaluate the `strategy-research-protocol` documentation and determine whether a fresh LLM agent could reliably execute the protocol from files alone, without chat history or hidden assumptions.

You are not here to be polite. You are here to find ambiguity, missing definitions, contradictory rules, unsafe assumptions, underspecified handoffs, and places where an LLM would likely make inconsistent decisions.

## Context

This protocol coordinates strategy research for a Polymarket 15-minute BTC up/down trading bot.

Mission-critical invariant:

- Live trading and backtests must run the same strategy logic on the same tick stream semantics.
- Any protocol rule that could create live/backtest divergence is a serious defect.

The protocol has three LLM worker roles:

- `ProposeFamily`: proposes one strategy family, creates `FAMILY.md`, `FAMILY.json`, and baseline code, then stops.
- `Researcher`: drives one family, specs experiments, submits backtests/extensions, writes research logs and lessons, decides continue/kill.
- `Evaluator`: sole reader of raw backtest results, judges passes/experiments, writes outcomes, champion, validation.

Important files to review:

- `strategy-research-protocol/README.md`
- `strategy-research-protocol/AGENTS.md`
- `strategy-research-protocol/MEMORY.md`
- `strategy-research-protocol/STAGE-GATES.md`
- `strategy-research-protocol/RESEARCH_SCOPE.md`
- `strategy-research-protocol/CONSTRAINTS.md`
- `strategy-research-protocol/LESSONS.md`
- `strategy-research-protocol/GLOSSARY.md`
- `strategy-research-protocol/RUNNING.md`
- `strategy-research-protocol/modules/ProposeFamily.md`
- `strategy-research-protocol/modules/Researcher.md`
- `strategy-research-protocol/modules/Evaluator.md`
- `strategy-research-protocol/tools/*.md`
- `strategy-research-protocol/rules/*.md`
- `strategy-research-protocol/examples/FAMILY.json`
- `strategy-research-protocol/examples/FAMILY.md`

If schemas/scripts exist, inspect them too, especially anything under:

- `strategy-research-protocol/schemas/`
- `strategy-research-protocol/scripts/`

## Review Goal

Evaluate whether the protocol is precise enough for multiple independent LLM agents to produce consistent, safe, resumable research behavior.

Focus especially on:

1. Ambiguous role boundaries
2. Missing state transition rules
3. Undefined terms
4. Inconsistent writer ownership
5. Places where "the state implies one next action" is not actually true
6. Missing error handling
7. Missing examples
8. Weak validation guarantees
9. Live/backtest parity risks
10. Human/agent handoff risks
11. Places where an LLM could overfit, cherry-pick, or leak judgment across role boundaries
12. Rules that are stated in prose but not enforceable by schema/check scripts
13. Protocol rules that conflict with repository reality
14. File paths, naming rules, batch IDs, and experiment IDs that could be misused
15. Any field whose lifecycle is unclear: who writes it, when, whether it can be edited, and what valid values mean

## Review Method

Read the protocol as if you are a fresh LLM worker with no prior context.

For each major workflow, simulate what you would do:

- Propose a new family
- Submit the baseline
- Check an incomplete batch
- Judge a completed pass
- Submit the next coordinate-search pass
- Judge a full experiment
- Extend from stage 1 to stage 2
- Promote a champion
- Validate a family
- Consume an Evaluator verdict as Researcher
- Kill a family structurally
- Kill a family empirically
- Resume from partially updated files
- Recover from failed validation/check scripts
- Handle dirty git state or uncommitted code
- Handle missing/broken backtest results
- Handle inconsistent `FAMILY.md` vs `FAMILY.json`

For each simulated workflow, ask:

- Is the next legal action unambiguous?
- Is the writer authorized to perform that action?
- Are all required inputs defined?
- Are all outputs defined?
- Is there a clear stop condition?
- Could two reasonable LLMs do different things?
- Could this create stale, misleading, or unrecoverable memory?
- Could this break live/backtest parity?

## Output Format

Produce a structured review with these sections.

### 1. Executive Summary

Give a concise verdict:

- Is the protocol usable as-is?
- What is the biggest risk?
- What should be fixed first?

### 2. Critical Issues

List only serious defects that could cause wrong research behavior, unsafe trading conclusions, broken resumability, or role-boundary violations.

For each issue include:

- Severity: Critical / High / Medium / Low
- Location: file and section
- Problem
- Why an LLM would likely fail here
- Concrete example of failure
- Recommended fix

### 3. Ambiguities

List rules that are understandable to a human but underspecified for an LLM.

For each ambiguity include:

- Location
- Ambiguous wording
- Competing interpretations
- Recommended precise wording

### 4. Missing Definitions

List terms, statuses, fields, commands, or concepts that are used before being fully defined.

For each one include:

- Term
- Where it appears
- Why the current definition is insufficient
- Proposed definition

### 5. State Machine Gaps

Evaluate family status, experiment status, pass state, gateLog, coverage, champion, and validation flows.

Call out:

- impossible states
- missing transitions
- conflicting transitions
- transitions without clear owner
- transitions not enforced by schema/check scripts
- cases where more than one next action is legal

### 6. Role Boundary Risks

Evaluate whether ProposeFamily, Researcher, and Evaluator are separated strongly enough.

Specifically check:

- Can Researcher accidentally see or infer raw results?
- Can Evaluator influence future hypotheses too strongly?
- Can ProposeFamily create biased baselines?
- Can any role write fields it should not?
- Are forbidden actions enforceable?

### 7. Memory and Resumability Risks

Evaluate whether a fresh agent can resume from files alone.

Check:

- Whether every required fact is persisted
- Whether transient operational state is properly kept out of files
- Whether enough pointers exist to recover DB results
- Whether `FAMILY.md` and `FAMILY.json` can drift
- Whether lessons are promoted consistently

### 8. Gate and Evaluation Risks

Review `STAGE-GATES.md` and evaluation rules.

Check:

- Whether success/failure/inconclusive are defined sharply enough
- Whether `netEvPerMarket > 0` is sufficient or too naive
- Whether thin samples, trade counts, outliers, and train/test fields are handled consistently
- Whether champion promotion is fully specified
- Whether validation means enough for later human/live review

### 9. Tooling and Enforcement Gaps

Separate prose-only rules from rules enforced by schemas/scripts.

Create a table:

| Rule | Currently enforced? | Where? | Risk if not enforced | Recommended enforcement |
| ---- | ------------------- | ------ | -------------------- | ----------------------- |

### 10. Documentation Fix Plan

Give an ordered patch plan.

For each proposed change include:

- File to edit
- Exact section to add/change
- Why this should be fixed before lower-priority items

### 11. Suggested Wording

For the most important fixes, provide exact replacement/additional protocol text in Markdown.

Use repo-relative display paths and portable relative Markdown links, for example:

```md
[`strategy-research-protocol/MEMORY.md`](./MEMORY.md)
[`strategy-research-protocol/modules/Researcher.md`](./modules/Researcher.md)
[`docs/backtest/parallelization.md`](../docs/backtest/parallelization.md)
```

Do not use local absolute paths.

## Review Standards

Be strict.

Do not accept vague phrases like:

- "when appropriate"
- "if needed"
- "reasonable"
- "enough"
- "significant"
- "stable"
- "best"
- "trend"
- "thin volume"
- "broken data"

unless the protocol defines exactly how an LLM should decide them.

If a rule depends on human judgment, say so explicitly and recommend either:

- making it deterministic,
- moving it to the user,
- or documenting it as discretionary with examples.

## Important Constraint

Do not rewrite the whole protocol.

Your job is to identify the highest-leverage gaps and propose precise fixes that make agent behavior more deterministic, auditable, and safe.
