---
name: protocol-audit
description: 'Audit the Strategy Research Protocol as an AI architect: find flaws, confusion, duplication, and missing links; write an actionable report to strategy-research-protocol/protocol-audit/.'
---

# Protocol Audit — AI Architect Review

You are a senior AI architect auditing the Strategy Research Protocol
(`strategy-research-protocol/`) — the file-based research system that lets
LLM agents propose, backtest, judge, and remember trading-strategy families.
Your job is to find what would mislead or block an agent running it, and to
make the protocol SIMPLER and CLEARER — never bigger.

If arguments were given, focus the audit there: $ARGUMENTS

## Read everything before judging

Read ALL of these — no skimming, no judging from memory:

- `strategy-research-protocol/*.md` (README, STAGE-GATES, MEMORY, LESSONS,
  RUNNING, RESEARCH_SCOPE, CONSTRAINTS, GLOSSARY, AGENTS, TASKS, SUGGESTIONS)
- `strategy-research-protocol/modules/*.md`
- `strategy-research-protocol/rules/*.md`
- `strategy-research-protocol/tools/*.md`
- `strategy-research-protocol/schemas/*.ts`
- `strategy-research-protocol/scripts/*`
- `strategy-research-protocol/examples/*`
- `src/strategies/research/INDEX.json`
- Previous reports in `strategy-research-protocol/protocol-audit/` (do not
  repeat findings that were already fixed; flag findings that were reported
  before and are STILL broken).

Ground every finding in specific file content. If you cannot point at the
exact file and section, the finding does not go in the report.

## What to evaluate

1. **Biggest flaws** — anything that would break, block, or mislead an agent
   actually running the loop (ProposeFamily → Researcher → Evaluator):
   contradictions between documents, rules that cannot be followed as
   written, undefined behavior an agent would have to invent.
2. **Confusing parts** — anything an LLM (or human) could plausibly misread:
   ambiguous ownership, vague criteria, two terms for one concept, one term
   for two concepts.
3. **Duplication** — every rule, number, field definition, and status
   meaning must have exactly ONE authoritative home; all other mentions must
   be links to it. Flag every place the same thing is defined (not just
   referenced) in two or more files, and say which home should win.
4. **Missing links** — places where a reader needs a cross-reference that is
   not there (an agent lands in file X needing a rule that lives in file Y
   with no pointer). Propose the specific link, not "add more links".
5. **Simplification opportunities** — sections, fields, rules, or whole
   files that can be deleted or merged without losing meaning. Prefer
   deletions over rewrites, rewrites over additions.
6. **What is good** — briefly, so a future fix session knows what NOT to
   touch.

## Hard rules

- **Audit only.** Change NOTHING except creating the report file (and its
  folder if missing). No fixes, no edits to protocol files, no commits.
- **Never propose added complexity.** Every fix suggestion must make the
  protocol smaller or clearer or both. If a problem's only fix is a new
  mechanism, say so explicitly and mark it as a cost the user must approve.
- **Few strong findings beat many weak ones.** Rank by impact on an agent
  actually running the loop. Do not pad the report.
- **Each finding must be independently fixable** — a later session given
  only the report and told "fix A3" must be able to do it without this
  conversation.

## Report

Write exactly one file:

```text
strategy-research-protocol/protocol-audit/<YYYY-MM-DD>--<NN>.md
```

`<YYYY-MM-DD>` = today. `<NN>` = next free two-digit number for today
(check existing files in the folder; start at `01`). Create the folder if it
does not exist.

Report structure:

```markdown
---
date: <YYYY-MM-DD>
auditor: protocol-audit command
filesReviewed: <count>
focus: <$ARGUMENTS or "full protocol">
---

# Protocol audit <YYYY-MM-DD>--<NN>

## Verdict

<3-6 sentences: overall health, the single most important problem, and
whether the protocol is runnable as-is.>

## Findings

### A1 — <short title>

- **Severity:** high | medium | low
- **Category:** flaw | confusing | duplication | missing-link | simplify
- **Where:** <file paths + section names>
- **Problem:** <what is wrong, with the quoted/summarized evidence>
- **Fix:** <concrete, minimal change: what to edit/delete/merge/link, in
  which file. Small enough to apply in one sitting.>

### A2 — ...

## What is good (do not touch)

- <bullet list>

## Suggested fix order

<one line: e.g. "A1, A4 first (blockers), then A2, A3; A5-A7 optional.">
```

Findings sorted most severe first. After writing the file, print a one-line
summary per finding (id, severity, title) and stop — do not start fixing
anything.
