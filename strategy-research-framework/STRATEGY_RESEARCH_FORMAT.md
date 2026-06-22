# Strategy Research Format

This document defines the minimal v1 structure for strategy research artifacts in `polymarket-bot`.

The goal is to make strategy research easy for humans to review and easy for AI agents to update safely.

---

# Core design

Use two file types:

```text
.json = indexes, navigation, status, paths, tags, duplicate keys
.md   = detailed reasoning, explanation, proposal, implementation notes, decisions
```

Do not use markdown tables as the main source of structured index data.

Do not use a database in v1.

Do not create a prompt builder in v1.

Do not create orchestration in v1.

---

# Minimal v1 structure

```text
src/strategies/
  index.json

  <family>/
    FAMILY.md
    index.json

    <version>/
      VERSION.md
      candidates/
        <NNN-short-name>/
          CANDIDATE.md
```

Example:

```text
src/strategies/
  index.json

  book-imbalance/
    FAMILY.md
    index.json

    v1/
      VERSION.md
      candidates/
        001-persistent-imbalance/
          CANDIDATE.md
```

---

# Important v1 rule

Schemas should validate only stable metadata.

Do not force metrics/results fields in v1.

Required schema fields should focus on:

- identity
- artifact type
- schema version
- status
- path
- tags
- duplicate keys

Metrics and benchmark results can be written in markdown sections for now.

A separate result artifact/schema can be added later.

---

# Source of truth rule

JSON index files are authoritative for:

- artifact list
- IDs
- status
- paths
- tags
- duplicate keys

Markdown artifact files are authoritative for:

- hypothesis
- reasoning
- explanation
- implementation notes
- risks
- backtest plan
- decision explanation
- retry conditions

If a JSON index and a markdown artifact disagree:

- use JSON for identity, status, paths, tags, and duplicate keys
- use markdown for reasoning and detailed explanation

---

# Global strategy index

Path:

```text
src/strategies/index.json
```

Purpose:

This is the global strategy index.

It answers:

1. Which strategy families exist?
2. Which family-level ideas are blocked or should not be repeated?
3. Which duplicate/synonym groups should agents avoid?

Agents should read this before proposing a new strategy family.

## Minimal schema shape

```json
{
  "schemaVersion": 1,
  "artifactType": "strategy-global-index",
  "families": [
    {
      "id": "book-imbalance",
      "status": "proposed",
      "title": "Book Imbalance",
      "summary": "Uses persistent orderbook imbalance as the primary decision driver.",
      "tags": ["orderbook", "imbalance"],
      "duplicateKeys": ["book-pressure", "bid-ask-skew"],
      "path": "src/strategies/book-imbalance/FAMILY.md"
    }
  ],
  "blockedIdeas": [
    {
      "id": "pure-late-entry",
      "summary": "Enter only late in the market.",
      "reason": "Previously produced too few trades or worse EV.",
      "duplicateKeys": ["wait-longer", "enter-near-end"]
    }
  ]
}
```

Keep entries short.

Do not put long explanations in `index.json`.

Put detailed explanations in the relevant markdown artifact.

---

# Family index

Path:

```text
src/strategies/<family>/index.json
```

Purpose:

This is the local index for one strategy family.

It answers:

1. Which versions exist inside this family?
2. Which candidate ideas were already tried?
3. Which duplicate candidate ideas should agents avoid?

Agents should read this before proposing a new candidate inside an existing family.

## Minimal schema shape

```json
{
  "schemaVersion": 1,
  "artifactType": "strategy-family-index",
  "family": "book-imbalance",
  "versions": [
    {
      "id": "book-imbalance.v1",
      "status": "active",
      "summary": "Initial baseline version.",
      "path": "v1/VERSION.md"
    }
  ],
  "candidates": [
    {
      "id": "book-imbalance.v1.c001",
      "status": "proposed",
      "summary": "Require imbalance to persist before entry.",
      "tags": ["orderbook", "persistence"],
      "duplicateKeys": ["persistent-imbalance"],
      "path": "v1/candidates/001-persistent-imbalance/CANDIDATE.md"
    }
  ],
  "blockedIdeas": [
    {
      "id": "pure-threshold-retune",
      "summary": "Only retune threshold without a new signal or filter.",
      "reason": "Too small to justify a separate candidate unless attached to a real hypothesis.",
      "duplicateKeys": ["threshold-only", "parameter-only"]
    }
  ]
}
```

---

# Family artifact

Path:

```text
src/strategies/<family>/FAMILY.md
```

Purpose:

This file explains one strategy family.

A family is a group of strategy versions and candidates that share the same primary decision driver.

A family should be named after the core decision logic, not after a broad data source.

## Required sections

```markdown
# <family>

## Core idea

## Primary decision driver

## Allowed candidate directions

## Forbidden directions

## Known weaknesses

## Duplicate notes
```

## Minimal frontmatter

```yaml
---
artifactType: strategy-family
schemaVersion: 1
id: book-imbalance
status: proposed
tags:
  - orderbook
  - imbalance
duplicateKeys:
  - book-pressure
  - bid-ask-skew
---
```

---

# Version artifact

Path:

```text
src/strategies/<family>/<version>/VERSION.md
```

Purpose:

This file explains one promoted or active version inside a family.

Use simple version folders:

```text
v1
v2
v3
```

Do not use long version folder names.

The folder is only an identifier.

The explanation belongs in `VERSION.md`.

## Required sections

```markdown
# <family> <version>

## Summary

## Strategy behavior

## Key parameters

## Results summary

## Known weaknesses

## Candidate history from this version
```

## Minimal frontmatter

```yaml
---
artifactType: strategy-version
schemaVersion: 1
id: book-imbalance.v1
family: book-imbalance
status: active
---
```

---

# Candidate artifact

Path:

```text
src/strategies/<family>/<version>/candidates/<NNN-short-name>/CANDIDATE.md
```

Purpose:

This file explains one proposed experiment inside an existing strategy family and parent version.

A candidate is not a new family unless it changes the primary decision driver.

A candidate usually changes:

- threshold
- timing
- filter
- plugin usage
- skip condition
- confirmation condition
- parameterization
- implementation detail inside the same decision driver

## Required sections

```markdown
# Candidate <NNN> - <short name>

## Hypothesis

## Proposed change

## What stays the same

## Why this is not a duplicate

## Implementation notes

## Backtest plan

## Results

## Decision

## Retry condition

## Index updates
```

## Minimal frontmatter

```yaml
---
artifactType: strategy-candidate
schemaVersion: 1
id: book-imbalance.v1.c001
family: book-imbalance
parentVersion: v1
status: proposed
tags:
  - orderbook
  - persistence
duplicateKeys:
  - persistent-imbalance
---
```

---

# Status values

Keep status values small and consistent.

Family statuses:

```text
proposed
active
archived
blocked
```

Version statuses:

```text
active
archived
blocked
```

Candidate statuses:

```text
proposed
accepted
implemented
tested
rejected
promoted
blocked
```

---

# Duplicate keys

Use `duplicateKeys` to help agents avoid duplicate strategy ideas.

Duplicate keys are short normalized phrases that describe the same idea.

Example:

```json
{
  "id": "pure-late-entry",
  "duplicateKeys": ["late-entry", "wait-longer", "enter-near-end"]
}
```

Agents must check duplicate keys before proposing a new family or candidate.

Renaming an idea does not make it new.

---

# Family vs tag

A family is the primary decision driver.

Tags are data sources, signal types, implementation details, or themes.

Example:

```yaml
---
id: book-imbalance
tags:
  - orderbook
  - imbalance
---
```

Do not create a broad family like:

```text
orderbook
```

Use `orderbook` as a tag.

---

# Live/backtest invariant

All strategy research must preserve this invariant:

```text
Live trading and backtests must run the same strategy logic on the same tick stream semantics.
Any live/backtest divergence is a bug.
```

Agents must block any proposal that requires:

- live-only signals
- unrecorded websocket fields
- external data not present in replay
- different strategy logic between live and backtest
- manual interpretation during live trading
- hidden assumptions that cannot be replayed

If a proposal requires new recorded data, mark it as `blocked` until deterministic replay semantics are defined.

---

# Update rules

## When creating a new family proposal

Update:

```text
src/strategies/index.json
```

Add it as `proposed`.

Do not mark it active unless the user explicitly approves it.

## When creating a new candidate

Update:

```text
src/strategies/<family>/index.json
```

Add the new candidate entry.

Do not update global strategy status.

## When a candidate is tested or evaluated

Update:

```text
src/strategies/<family>/index.json
```

Update the candidate status.

Also update the candidate `CANDIDATE.md` results/decision sections.

Do not force benchmark metrics into JSON until the result format is defined.

## When a candidate is promoted

Update:

```text
src/strategies/<family>/index.json
src/strategies/<family>/<new-version>/VERSION.md
```

The promoted candidate becomes the next version.

Example:

```text
book-imbalance.v1.c001 -> book-imbalance.v2
```

---

# Minimal v1 rule

Do not create more files before they are needed.

In v1, do not create:

```text
RESULTS.md
RULES.md
MEMORY.md
RESEARCH_INDEX.md
database
prompt builder
orchestrator
queue
```

Add those later only if there is a clear need.
