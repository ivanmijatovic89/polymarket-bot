# Strategy Research Artifacts

This document defines the minimal v1 structure for strategy research artifacts in `polymarket-bot`.

The goal is to make strategy research easy for humans to review and easy for AI agents to update safely.

This framework is not a replacement for project documentation.

- `docs/` explains how the trading bot works.
- `strategy-research-framework/` explains how AI agents should organize strategy research.
- `src/strategies/` stores strategy research artifacts and indexes.

---

# Core design

Use two file types:

```text
.json = indexes, status, metrics, paths, tags, duplicate keys
.md   = detailed reasoning, explanation, proposal, implementation notes, decisions
```

Do not use markdown tables as the main source of structured index data.

Do not use a database in v1.

Do not create a prompt builder in v1.

Do not create orchestration in v1.

---

# Recommended v1 structure

```text
strategy-research-framework/
  README.md
  ARTIFACTS.md
  NAMING.md
  modules/
    strategy-proposals/
      README.md

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

# Source of truth rule

JSON index files are authoritative for:

- IDs
- status
- metrics
- paths
- tags
- duplicate keys
- current champion
- candidate list
- family list

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

- use JSON for status, metrics, paths, tags, and IDs
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
2. Which family-level ideas were rejected?
3. Which ideas are maybe-later?
4. Which duplicate/synonym groups should agents avoid?

Agents should read this before proposing a new strategy family.

## Example schema

```json
{
  "schemaVersion": 1,
  "artifactType": "strategy-global-index",
  "families": [
    {
      "family": "split-sell-redeem",
      "status": "active",
      "coreIdea": "Split shares, sell one side, redeem winner using dwell/timing rules",
      "currentChampion": "v3",
      "benchmark": "last3000/default",
      "ev": 0.18,
      "marketsPlayed": 943,
      "roi": 17.4,
      "mainWeakness": "Sensitive to noisy early entries",
      "tags": ["split", "dwell", "execution-flow"],
      "duplicateKeys": ["split-sell", "split-redeem", "sell-redeem"],
      "path": "src/strategies/split-sell-redeem/FAMILY.md"
    }
  ],
  "rejectedFamilyIdeas": [
    {
      "idea": "pure-late-entry",
      "similarNames": ["wait-longer", "enter-near-end", "final-minute-entry"],
      "coreIdea": "Enter only late in the market",
      "whyRejected": "Too few trades and worse EV",
      "retryOnlyIf": "Combined with an independent confirmation signal",
      "duplicateKeys": ["late-entry", "wait-longer", "enter-near-end"]
    }
  ],
  "maybeLaterIdeas": [
    {
      "idea": "external-btc-feed",
      "reasonDelayed": "External feed is not replay-safe yet",
      "requiredBeforeRetry": "External feed must be recorded into the deterministic replay stream",
      "duplicateKeys": ["binance-feed", "btc-oracle", "external-price-feed"]
    }
  ]
}
```

## Rules

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
3. Which candidate ideas were rejected, promoted, blocked, or are still pending?
4. Which duplicate candidate ideas should agents avoid?

Agents should read this before proposing a new candidate inside an existing family.

## Example schema

```json
{
  "schemaVersion": 1,
  "artifactType": "strategy-family-index",
  "family": "book-imbalance",
  "status": "experimental",
  "currentChampion": "v1",
  "coreIdea": "Use persistent orderbook imbalance as the primary decision driver",
  "tags": ["orderbook", "imbalance", "entry-signal"],
  "versions": [
    {
      "version": "v1",
      "status": "champion",
      "summary": "Initial simple imbalance threshold version",
      "benchmark": "last500/default",
      "ev": null,
      "marketsPlayed": null,
      "roi": null,
      "path": "v1/VERSION.md"
    }
  ],
  "candidates": [
    {
      "id": "book-imbalance.v1.c001",
      "parentVersion": "v1",
      "status": "proposed",
      "idea": "Require imbalance to persist before entry",
      "benchmark": null,
      "ev": null,
      "marketsPlayed": null,
      "roi": null,
      "decision": "pending",
      "retryOnlyIf": null,
      "tags": ["orderbook", "imbalance", "persistence"],
      "duplicateKeys": ["persistent-imbalance", "imbalance-duration"],
      "path": "v1/candidates/001-persistent-imbalance/CANDIDATE.md"
    }
  ],
  "duplicateNotes": [
    {
      "rule": "Do not create another candidate that only renames bid/ask skew, book pressure, or orderbook imbalance.",
      "appliesToTags": ["orderbook", "imbalance"]
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

Good family examples:

```text
book-imbalance
spread-compression
liquidity-wall
split-sell-redeem
late-market-snipe
volatility-regime
```

Bad family examples:

```text
orderbook
plugins
technical-indicators
research-lab
strategy-ideas
```

## Required sections

```markdown
# <family>

## Core idea

## Primary decision driver

## Allowed candidate directions

## Forbidden directions

## Current champion

## Known weaknesses

## Duplicate notes
```

## Example frontmatter

```yaml
---
artifactType: strategy-family
family: book-imbalance
status: experimental
currentChampion: v1
tags:
  - orderbook
  - imbalance
  - entry-signal
---
```

---

# Version artifact

Path:

```text
src/strategies/<family>/<version>/VERSION.md
```

Purpose:

This file explains one promoted version inside a family.

Versions are promoted candidates.

Use simple version folders:

```text
v1
v2
v3
```

Do not use long version folder names.

Good:

```text
src/strategies/book-imbalance/v1/
```

Bad:

```text
src/strategies/book-imbalance/v1-persistent-imbalance-with-spread-filter/
```

The folder is only an identifier.

The explanation belongs in `VERSION.md`.

## Required sections

```markdown
# <family> <version>

## Summary

## Promoted from

## Strategy behavior

## Key parameters

## Benchmark results

## Known weaknesses

## Candidate history from this version
```

## Example frontmatter

```yaml
---
artifactType: strategy-version
id: book-imbalance.v1
family: book-imbalance
version: v1
status: champion
promotedFrom: null
benchmark: last500/default
ev: null
marketsPlayed: null
roi: null
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

## Example frontmatter

```yaml
---
artifactType: strategy-candidate
id: book-imbalance.v1.c001
family: book-imbalance
parentVersion: v1
status: proposed
decision: pending
benchmark: null
ev: null
marketsPlayed: null
roi: null
tags:
  - orderbook
  - imbalance
  - persistence
duplicateKeys:
  - persistent-imbalance
  - imbalance-duration
---
```

---

# Status values

Keep status values small and consistent.

## Family statuses

```text
proposed
active
experimental
archived
rejected
blocked
```

## Version statuses

```text
champion
archived
rejected
blocked
```

## Candidate statuses

```text
proposed
accepted
implemented
backtested
rejected
promoted
blocked
```

## Decision values

```text
pending
pass
fail
retry
promote
blocked
```

---

# Duplicate keys

Use `duplicateKeys` to help agents avoid duplicate strategy ideas.

Duplicate keys are short normalized phrases that describe the same idea.

Example:

```json
{
  "idea": "pure-late-entry",
  "duplicateKeys": ["late-entry", "wait-longer", "enter-near-end"]
}
```

Agents must check duplicate keys before proposing a new family or candidate.

Renaming an idea does not make it new.

Examples of duplicate groups:

```text
late-entry
wait-longer
enter-near-end
final-minute-entry
```

```text
book-pressure
orderbook-imbalance
bid-ask-skew
depth-imbalance
```

```text
external-btc-feed
binance-feed
btc-oracle
external-price-feed
```

A duplicate idea may become valid only if it adds a genuinely new independent decision driver.

---

# Family vs tag

A family is the primary decision driver.

Tags are data sources, signal types, implementation details, or themes.

Example:

```yaml
---
family: book-imbalance
tags:
  - orderbook
  - imbalance
  - entry-signal
---
```

Do not create a broad family like:

```text
orderbook
```

Use `orderbook` as a tag.

Better families:

```text
book-imbalance
spread-compression
liquidity-wall
orderbook-momentum
orderbook-reversal
```

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

If a proposal requires new recorded data, mark it as `blocked` or `maybe-later` until deterministic replay semantics are defined.

---

# Update rules

## When creating a new family proposal

Update:

```text
src/strategies/index.json
```

Add it as proposed or maybe-later.

Do not mark it active unless the user explicitly approves it.

## When creating a new candidate

Update:

```text
src/strategies/<family>/index.json
```

Add the new candidate entry.

Do not update global strategy status.

## When a candidate is evaluated

Update:

```text
src/strategies/<family>/index.json
```

Update:

- status
- benchmark
- ev
- marketsPlayed
- roi
- decision
- retryOnlyIf

Also update the candidate `CANDIDATE.md` decision section.

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

---

# Summary

Use this split:

```text
JSON index files
  structured memory, metrics, status, paths, validation

Markdown artifact files
  reasoning, explanations, hypotheses, decisions, human review
```

This gives the system:

- clear structure for agents
- easy human review
- scalable indexes
- simple validation later
- no database requirement in v1
