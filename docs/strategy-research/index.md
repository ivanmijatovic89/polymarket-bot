---
title: Strategy Research
description: A small, explicit system for organizing strategy research so humans and coding agents can understand what was tested and what should happen next.
---

# Strategy Research

Strategy research must preserve enough context for humans and coding agents to answer:

1. What is the current baseline strategy?
2. Which candidates tried to beat it?
3. What did each candidate change?
4. Which candidates were rejected, promoted, or still need evaluation?

## Workflow

Use champion/challenger strategy versioning:

```txt
champion version
  -> candidates
  -> promoted candidate
  -> next champion version
```

Example:

```txt
split/v1
  candidates/001-sell-price-offset/
  candidates/002-netchange-gate/

split/v2
```

## Scope

This section defines only the shared research organization rules:

- version folders
- candidate folders
- naming
- required docs
- agent reading order

Concrete strategy history belongs near strategy code, for example under `src/strategies/split/`.

## Documents

- [Champion/Challenger Strategy Versioning](./champion-challenger-versioning.md)
