# Strategy Naming Rules

This document defines how AI agents should name strategy families, versions, candidates, tags, and proposal artifacts.

The goal is to keep strategy research easy to navigate, easy to search, and hard to duplicate.

---

# Strategy family

A strategy family is a group of strategy versions and candidates that share the same primary decision driver.

A strategy family should not be named after a broad data source.

Good family names describe the main idea behind the trading decision.

Bad family names describe only the data source or implementation mechanism.

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

Good:

```text
book-imbalance
spread-compression
liquidity-wall
split-sell-redeem
```

Bad:

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

```text
family = primary decision driver
tags   = data sources, signal types, implementation details, or themes
```

Example:

```yaml
---
id: book-imbalance
tags:
  - orderbook
  - imbalance
---
```

Another example:

```yaml
---
id: spread-compression
tags:
  - orderbook
  - spread
  - stability
---
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

# Candidate naming

A candidate is a proposed change inside an existing family.

Candidate folder format:

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
```

Do not encode long descriptions in version folder names.

Good:

```text
src/strategies/book-imbalance/v1/
```

Bad:

```text
src/strategies/book-imbalance/v1-super-good-imbalance-strategy/
```

The version folder is only an identifier.

The explanation belongs in `VERSION.md`.

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
