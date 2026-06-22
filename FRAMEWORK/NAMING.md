# Strategy Naming Rules

This document defines how AI agents should name strategy families, candidates, versions, tags, and proposal artifacts.

The goal is to keep strategy research easy to navigate, easy to search, and hard to duplicate.

---

# Core concept

A strategy family is a group of strategies that share the same primary decision driver.

A strategy family should not be named after a broad data source.

Good family names describe the main idea behind the trading decision.

Bad family names describe only the data source or implementation mechanism.

---

# Strategy family

## Definition

A strategy family groups strategies that answer the same core question:

> Why should this strategy enter, skip, sell, or redeem?

If two strategies use the same main reason for making decisions, they probably belong to the same family.

If they use different primary decision logic, they should probably be separate families.

## Good family examples

```text
split-sell-redeem
book-imbalance
spread-compression
liquidity-wall
orderbook-momentum
orderbook-reversal
late-market-snipe
volatility-regime
time-window-gate
dwell-gate
```

## Bad family examples

```text
orderbook
plugins
technical-indicators
external-feeds
research-lab
strategy-ideas
new-strategy
experiment-1
```

Why these are bad:

- `orderbook` is a data source, not a strategy idea.
- `plugins` is an implementation mechanism, not a strategy idea.
- `technical-indicators` is a broad category, not a decision driver.
- `research-lab` is vague.
- `experiment-1` does not explain the strategy.

---

# Family naming rule

Use lowercase kebab-case.

```text
book-imbalance
spread-compression
liquidity-wall
split-sell-redeem
```

Do not use:

```text
BookImbalance
book_imbalance
bookImbalance
OrderbookStrategy
StrategyV1
ResearchLab
```

---

# Family vs tag

Do not create broad families like `orderbook`.

Use tags for broad concepts.

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

Another example:

```yaml
---
family: spread-compression
tags:
  - orderbook
  - spread
  - stability
  - entry-filter
---
```

Rule:

```text
family = primary decision driver
tags = data sources, signal types, implementation details, or themes
```

---

# How to decide if something is a new family

Before creating a new family, ask:

1. What is the primary decision driver?
2. Is this already represented by an existing family?
3. Is this only a parameter change inside an existing family?
4. Is this just a new tag, plugin, or input source?
5. Would this strategy still make the same decision for the same reason as an existing family?

If the answer is yes, do not create a new family.

Create a candidate inside the existing family instead.

---

# Examples

## Example 1: orderbook imbalance

Idea:

> Enter when one side of the orderbook shows persistent pressure.

Family:

```text
book-imbalance
```

Tags:

```text
orderbook
imbalance
entry-signal
```

Do not name the family:

```text
orderbook
```

Reason:

`orderbook` is too broad. Many unrelated strategies can use orderbook data.

---

## Example 2: spread compression

Idea:

> Enter when the spread becomes narrow and stable after a noisy period.

Family:

```text
spread-compression
```

Tags:

```text
orderbook
spread
stability
entry-filter
```

This should not be inside `book-imbalance`, because the primary decision driver is spread stability, not bid/ask imbalance.

---

## Example 3: liquidity wall

Idea:

> Enter or skip based on a large resting liquidity wall on one side of the book.

Family:

```text
liquidity-wall
```

Tags:

```text
orderbook
liquidity
depth
```

This should not be inside `book-imbalance` unless the actual decision is still based on general bid/ask imbalance.

---

## Example 4: split-sell-redeem

Idea:

> Split positions, sell one side, and redeem the winning side using timing/dwell rules.

Family:

```text
split-sell-redeem
```

Tags:

```text
split
sell
redeem
dwell
execution-flow
```

Candidate examples inside this family:

```text
delayed-entry
stricter-dwell-range
adaptive-sell-timing
late-sell-disable
```

These are candidates, not new families, because the core strategy approach is still split/sell/redeem.

---

# Candidate naming

A candidate is a proposed change inside an existing family.

Use:

```text
<NNN>-<short-kebab-name>
```

Examples:

```text
001-delayed-entry
002-stricter-dwell-range
003-adaptive-sell-timing
004-spread-stability-filter
```

Candidate ID format:

```text
<family>.<parent-version>.c<NNN>
```

Examples:

```text
split-sell-redeem.v3.c001
book-imbalance.v1.c002
spread-compression.v1.c003
```

---

# Version naming

Use simple version folders:

```text
v1
v2
v3
v4
```

Do not encode strategy descriptions in version folder names.

Good:

```text
src/strategies/book-imbalance/v1/
```

Bad:

```text
src/strategies/book-imbalance/v1-super-good-imbalance-strategy/
```

The version folder is only an identifier.

The explanation belongs in markdown files.

---

# Folder structure

Preferred structure:

```text
src/strategies/
  INDEX.md

  <family>/
    INDEX.md
    FAMILY.md
    RULES.md

    v1/
      VERSION.md
      RESULTS.md
      candidates/
        001-short-name/
          CANDIDATE.md
          RESULTS.md
```

This structure may evolve later.

Do not create empty version or candidate folders before they are needed.

---

# Duplicate detection

An idea is probably a duplicate if it has the same primary decision driver as an existing family or candidate.

Renaming does not make an idea new.

These are likely duplicates:

```text
late-entry
wait-longer
enter-near-end
```

These are likely duplicates:

```text
book-pressure
orderbook-imbalance
bid-ask-depth-skew
```

These are likely duplicates:

```text
external-btc-feed
binance-feed
btc-oracle
```

A duplicate may become valid only if it adds a genuinely new independent decision driver.

Example:

```text
pure-late-entry
```

is not new if it only waits longer.

But it may become a valid candidate if combined with a separate confirmation signal, such as:

```text
late-entry-with-spread-stability
late-entry-with-book-imbalance
```

---

# Naming checklist for agents

Before naming a new family, answer:

```text
1. What is the primary decision driver?
2. Is this a data source, or a real strategy idea?
3. Does an existing family already use this decision driver?
4. Is this better represented as a candidate inside an existing family?
5. Which tags describe the data source or signal type?
6. Is the name lowercase kebab-case?
7. Is the name specific enough to avoid future confusion?
```

If the name is broad, vague, or based only on data source, do not use it.

---

# Final rule

Use names that help future agents avoid duplicate research.

A good family name should make this clear:

```text
what signal or logic drives the strategy decision
```

A bad family name only says:

```text
what data source or implementation tool the strategy uses
```
