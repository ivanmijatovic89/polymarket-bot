# Strategy Proposals Module

This module owns strategy proposal work.

It can propose:

1. new strategy families
2. new candidates inside an existing strategy family

It does not implement code.

It does not run backtests.

It does not evaluate final results.

It does not promote strategies.

---

# Purpose

The purpose of this module is to create proposal artifacts that are clear enough for a later implementation module or human reviewer to act on.

---

# Required project invariant

Live trading and backtests must run the same strategy logic on the same tick stream semantics.

Any live/backtest divergence is a bug.

Block any proposal that requires:

- live-only signals
- unrecorded websocket fields
- external data not present in replay
- different strategy logic between live and backtest
- manual interpretation during live trading
- hidden assumptions that cannot be replayed

---

# Mode 1: new family proposal

Use this mode when proposing a new strategy family.

Required reads:

```text
strategy-research-framework/STRATEGY_RESEARCH_FORMAT.md
strategy-research-framework/NAMING.md
src/strategies/index.json
```

Behavior:

1. Check whether the idea already exists as a family.
2. Check blocked family ideas.
3. Check duplicate keys and similar names.
4. If duplicate, stop and report blocked duplicate.
5. If unique, create a new family artifact with status `proposed`.

Suggested output:

```text
src/strategies/<new-family>/FAMILY.md
```

Also create:

```text
src/strategies/<new-family>/index.json
```

Update:

```text
src/strategies/index.json
```

Do not mark it active unless the user explicitly approves it.

---

# Mode 2: candidate proposal inside an existing family

Use this mode when proposing a candidate inside an existing strategy family.

Required reads:

```text
strategy-research-framework/STRATEGY_RESEARCH_FORMAT.md
strategy-research-framework/NAMING.md
src/strategies/index.json
src/strategies/<family>/index.json
src/strategies/<family>/FAMILY.md
src/strategies/<family>/<parent-version>/VERSION.md
```

Behavior:

1. Check whether the idea already exists in the family index.
2. Check candidate duplicate keys.
3. Check family blocked ideas.
4. If duplicate, stop and report blocked duplicate.
5. If unique, create one candidate artifact.
6. Update the family `index.json`.

Suggested output:

```text
src/strategies/<family>/<parent-version>/candidates/<NNN-short-name>/CANDIDATE.md
```

---

# Forbidden actions

This module must not:

- modify strategy implementation code
- run backtests
- create unrelated folders
- create multiple candidates unless explicitly requested
- promote strategies
- edit historical results unless explicitly requested
- mark a family as active without explicit user approval

---

# Output requirements

A proposal artifact must include:

- clear hypothesis
- proposed change
- what stays the same
- duplicate check
- implementation notes
- backtest plan
- expected risks
- stop condition

After writing a proposal, update the appropriate JSON index.

---

# Stop condition

Stop after creating one valid proposal artifact and updating the relevant JSON index.

If duplicate, stop after reporting the duplicate and do not create a new proposal.
