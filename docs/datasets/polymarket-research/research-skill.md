---
title: Research Skill and Wallet Strategies
description: Use the project skill to rank traders and investigate wallet strategies using local evidence.
---

# Research skill and wallet strategies

The project skill is **`polymarket-research`**, stored in
`.agents/skills/polymarket-research/SKILL.md`. It is versioned with the repository
and linked from `AGENTS.md`. Open Codex in this project and invoke it as
`$polymarket-research`; matching wallet-research requests can also select it
automatically. It is a set of working instructions, not another background job.

The skill uses the [overview](./overview), [stored data](./schema),
[profit calculations](./accounting), [commands](./commands) and
[analyst instructions](./agents/analyst). These docs remain the source of truth
when the system changes. The skill adds a consistent research workflow without
duplicating calculation rules.

## Example requests

> Use $polymarket-research to find June 2026's top 20 BTC 15-minute traders and
> compare those same wallets in July, August and September.

> Use $polymarket-research to find the trader of the day for October 5, 2026.

> Use $polymarket-research to investigate wallet 0x… on BTC 15-minute markets.
> Use June 2026 to identify possible rules, then check those rules on July trades.

Specify a dataset root if it is not already set through
`POLYMARKET_RESEARCH_DATA_DIR`. Use the family directory, currently
`data/polymarket-research-v2/btc/15m`, rather than its parent collection. The dates refer to UTC market-window starts and
include the downloaded later lifecycle of those markets. Only BTC 15-minute is
enabled today. See [commands](./commands) for inclusive/exclusive date syntax.

Before interpreting a result, the skill checks coverage and local integrity.
Normal rankings include all observed wallets and show wallet, calculated profit,
markets and trades. Reconciliation differences do not remove traders or add
warning columns. Missing source days, unresolved profit or a failed integrity
check still cannot be presented as a complete numeric result.

## Investigate one wallet, step by step

1. **Choose the periods before inspecting later results.** Identify the wallet
   using a discovery period, such as June, and reserve July for testing. For
   several candidates, keep the original list fixed; do not replace unsuccessful
   wallets using July's winners.
2. **Describe its actual behavior.** Start with
   `sql/wallet-market-profile.sql` and the wallet command. Measure time from
   market-window start, trade size and price, outcome exposure, maker/taker share,
   repeated entries, exits, merges and holding to settlement. Include losing
   markets and compare the distributions, not only a few successful examples.
3. **Write a small number of testable rules.** For example, a hypothesis could
   concern entries near the window start or position sizes within a price band.
   Record the rule, thresholds, supporting observations and exceptions before
   opening the held-out period. A price-based hypothesis needs the corresponding
   price observations; trade history alone cannot prove it.
4. **Check the same rules on later markets.** Report how many trades and markets
   fit, how many do not, the wallet's actual profit, and periods of inactivity.
   Distinguish predicting the wallet's observed behavior from simulating a
   profitable executable strategy. If the rule is revised after seeing July,
   July becomes development data and another period is needed for a fresh test.
5. **Save a reproducible study.** Keep the wallet list, period boundaries, SQL,
   hypothesis definitions, source commit, snapshot generations and measured
   results. Record the activity cutoff and observation times when relevant.
   Pin exact generations when needed; see [retention and readers](./operations#retention-and-readers).

Present the conclusion in three short parts: **observed behavior**, **proposed
explanation**, and **what the later-period test showed**. A good outcome can be
that the available evidence does not support a useful rule.

## What the data can establish

Trades show executions, not submitted or canceled orders. Activities explain
cash and lifecycle events. Positions are snapshots and must not be counted as
additional profit. Several trade occurrences can share a transaction hash or
second; preserve them without claiming an exact matching-engine sequence.

For BTC price or orderbook context, inspect the existing
[Recorder V4 data](../recording/recorder-v4) and its coverage. Use only overlapping
markets and actually recorded inputs. Current market prices or later settlements
cannot stand in for the information available at the original trade time.
This skill does not silently start a new download to fill those gaps.

A proposed strategy remains an inference about public observations. Testing a
tradable implementation is a separate step: shared strategy logic, the same tick
semantics for live and backtest, realistic fees and execution assumptions, and
inputs available at decision time. The API research dataset is not a substitute
for `MarketEngine` replay.

## Maintenance

When schema, profit rules or commands change, update their existing docs first,
then adjust the skill's workflow and examples if needed. Keep the
[auditor instructions](./agents/auditor) for maintenance investigations. A separate
specialized agent can be added later using this same skill and documentation;
there is no separate agent service to run now.
