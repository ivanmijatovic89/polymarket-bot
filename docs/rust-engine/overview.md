---
title: Rust Engine, Live-First
description: Why the Rust trading engine is built against the exchange first, with Recorder V4 as its first input, and where its spec, status and launcher live.
---

# Rust Engine, Live-First

This page explains the Rust engine goal: what is being built, why the order
of work starts at the exchange rather than at historical replay, and where a
reader finds the specification, the progress record and the launcher. It is
an explanation, not a manual. The normative text is the specification under
`native/spec/` on branch `rust-live-first`.

## What is being built

One deterministic engine in Rust that runs the same strategy code in backtest
and in live trading. Backtest and live differ only in two places: where market
events come from, and whether orders go to a simulator or to Polymarket's CLOB
V2. The rest of the application stays TypeScript and keeps receiving what it
receives today: a market job in, a per-market result out.

The engine is the second attempt. The first attempt, on branch
`native-engine`, replayed Telonex history first and proved itself by
reproducing the TypeScript engine's decisions. It is kept as reference
material only; the new goal reuses four of its reviewed crates and nothing of
its process.

## Why live-first

A backtest is only useful if it predicts what the live bot would have done
and earned. That prediction depends on an execution model: how fills happen,
what fees are charged, how long an order takes to reach the exchange, when a
marketable order is held, when an expiring order actually expires. The
TypeScript engine's model is known to be wrong in several of these, and the
exchange documentation is a set of claims that nobody in this project has
checked with real orders since the CLOB V2 cutover.

The new order of work therefore puts the only ground truth first:

1. Replay one Recorder V4 market end to end, so the engine runs at all.
2. Build a minimal exchange adapter and a probe runner. The owner runs short
   probe sessions with a small budget while worker-2 records the same markets.
3. Build the simulator from those measurements, one model at a time, each with
   a recorded provenance.
4. Run paper mode on live data next to a backtest of the same market.
5. Persist native runs, port the first real strategy, merge to main.
6. Only then: speed, Telonex history, fleet integration, protocols authoring
   Rust strategies, and the production live runtime.

Every step ends with something the owner can run and see. Gates between the
steps are owner decisions, not agent decisions.

::: warning Money and keys
The agent never holds wallet keys or API secrets and never builds the
`real-orders` binary. The owner builds and launches every session that can
send an order, including the probes, with a hard budget cap in the probe
script.
:::

## Why Recorder V4 first

Recorder V4 packages carry every feed the strategy can see, with the real
receive time of each observation and the trade prints the queue model needs.
Replaying them needs no model of when a Binance trade or a Chainlink round
became visible. The Telonex dataset has none of that: it has history, ten
months of BTC 15m markets, but no receive times and no trades, so replaying
it realistically needs feed-timing models.

The goal uses each dataset for what it is good at. V4 is the input for
building and calibrating the engine. Telonex is added later, with feed-timing
models whose numbers come from the engine's own live measurements, so that
research over history uses the same calibrated engine.

## Where things live

| Item | Location |
|---|---|
| Branch and worktree | `rust-live-first`, `/Users/worker-1/Sites/polymarket-bot-rust-live-first` on worker-1 |
| Specification | `native/spec/00-goal.md`, `01-milestones.md`, `02-decisions.md`, `03-reuse.md`; reference extracts `10-exchange-facts.md`, `11-v4-input.md` |
| Progress record | `native/STATUS.md`: the "Current state" block is the resume point for any session |
| Reports | `native/reports/` (probe, simulator, paper, benchmark reports) |
| Measured model parameters | `native/calibration/`, one versioned record per measurement |
| Goal session prompt and launcher | `native/goal/PROMPT.md`, `native/goal/run-goal.sh` |
| Previous attempt (reference only) | branch `native-engine`, clone `/Users/worker-1/Sites/polymarket-bot-native` |
| Draft PR | "DO NOT MERGE before gate C: Rust engine, live-first" |

The specification is short on purpose and stays under 2,500 lines. Details
that do not change decisions are cited from the previous attempt's documents
by section rather than copied.

## Launching and resuming the goal session

The goal is executed by an autonomous Claude Code session on worker-1. Two
ways to run it:

::: code-group
```bash [desktop session]
# Open a new session in the worktree and paste as the first message:
# "Read native/goal/PROMPT.md and start."
cd /Users/worker-1/Sites/polymarket-bot-rust-live-first
```
```bash [headless launcher]
cd /Users/worker-1/Sites/polymarket-bot-rust-live-first
native/goal/run-goal.sh "2026-10-10 06:00"   # deadline, local time
GOAL_RESUME=1 native/goal/run-goal.sh "2026-10-10 06:00"   # continue the previous conversation
```
:::

A new or resumed session reads the four spec documents in full, then
`native/STATUS.md`, verifies the tree is green, and continues from "Next
action". When a milestone reaches a gate, the session writes the report named
in the milestone, sets "Waiting on user" in the status file and continues
with work that does not depend on the gate.

::: tip Reading order for a human
Read `00-goal.md` for the principles, `01-milestones.md` for what arrives
when, and the "For the owner" paragraph at the top of `native/STATUS.md` for
where the work is today.
:::

## What the goal does not do

- It does not reproduce the TypeScript engine. The TypeScript readers only
  generate goldens for file decoding.
- It does not trade a strategy with real money. The first real-money strategy
  run is the last gate and is launched by the owner.
- It does not add symbols beyond BTC, timeframes beyond 5m and 15m, or inputs
  beyond Recorder V4, live and Telonex.
