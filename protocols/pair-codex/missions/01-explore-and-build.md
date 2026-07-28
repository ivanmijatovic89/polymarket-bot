# Mission 01 — Explore and Build

## Purpose

Build and verify everything required for a long-running autonomous backtest
research laboratory for the pair strategy described in `VISION.md` and
constrained by `RULES.md`.

This is a finite construction mission. It ends with a review package and a
proposed Mission 02. Do not begin the permanent research mission without human
approval.

## Freedom

You are expected to design the system, not merely follow a research workflow
invented in advance. Choose the architecture, tools, memory format, evaluation
methodology, work division, and experiment process that best serve the vision.

The requirements below define outcomes and boundaries. They do not prescribe
the implementation unless `RULES.md` makes something mandatory.

## Required outcomes

### 1. Understand and verify the engine

Explore the relevant polymarket-bot documentation and source code. Do not trust
documentation or code blindly: verify important behavior through focused tests,
small runs, database inspection, and comparison of independent evidence paths.

Produce an AI-oriented `ENGINE.md` covering the backtest capabilities,
commands, event semantics, execution assumptions, statistics, external feeds,
and simulator limitations relevant to this strategy. Cite documentation or
source locations for factual claims. You may inspect shared live/backtest code
to understand parity, but you must not start or control live processes.

When an engine defect or missing capability is found, record an issue with an
exact reproduction and explain its research impact. Continue with other useful
work unless the defect is a genuine blocker.

### 2. Design the research operating system

Design how autonomous sessions will:

- choose and claim useful work;
- generate and prioritize hypotheses;
- create strategy variants without losing lineage;
- run, compare, and verify experiments;
- preserve reliable knowledge across stateless sessions;
- reconsider negative results when data or market regimes change;
- cooperate across models without duplicating or overwriting work;
- respond to human steering and stop requests;
- detect drift away from the vision and rules.

Document the resulting conventions in model-owned protocol files. Keep the
system as simple as possible while making continuation after interruption
reliable.

### 3. Build the required tools

Build the tools needed to operate the research loop efficiently. At minimum,
the completed system must be able to:

- validate and smoke-test a new strategy variant;
- submit single runs and experiment batches to the backtest fleet;
- inspect queue and worker state;
- retrieve backtest results and exact run provenance;
- compare variants across profit, capital, risk, and execution assumptions;
- record experiments and distilled knowledge;
- detect invalid or incomplete evidence.

Decide whether additional tools are necessary after exploring the engine.

### 4. Design and implement evaluation

Create an evaluation system that can distinguish a promising strategy from
overfitting or simulator artifacts. You decide the methodology, stages,
metrics, data partitions, robustness tests, and promotion process.

It must account for at least:

- fee-inclusive profit;
- researched pair-cost thresholds and their robustness;
- capital efficiency;
- unmatched inventory and directional risk;
- latency and execution sensitivity;
- sample size and uncertainty;
- repeated experimentation and data leakage;
- changing market regimes;
- reproducibility from immutable evidence;
- simulator limitations and sensitivity to execution assumptions.

The evaluator must be demonstrated, not only described.

### 5. Build simple human visibility

Build a small read-only Mission Control v1 that lets the human see what the
protocol is doing without asking the active model. Its exact design and
location are your decision within the permissions available to you.

Keep v1 small. Session control, model selection, token accounting, and complex
analytics are not required unless the human approves a later design proposal.
Mission Control must support research rather than becoming the main project.

### 6. Demonstrate the complete system

Run at least one complete example cycle:

1. Form a hypothesis.
2. Create or select a strategy variant.
3. Validate it locally with a minimal smoke test.
4. Run the evidentiary backtest through the fleet.
5. Read and compare the results.
6. Apply the evaluator.
7. Record the experiment and resulting knowledge.
8. Show the result in Mission Control.
9. Stop and resume from files to demonstrate continuity.

The purpose is to verify the laboratory, not to claim that the example
strategy is profitable.

## Completion and handoff

Mission 01 is complete when the laboratory can execute the intended research
cycle end to end with no unresolved blocking unknowns.

At completion, produce:

1. A `READY.md` report listing what was built, what was verified, remaining
   risks, known engine issues, and why the system is or is not ready.
2. A proposed `missions/02-research.md` written for the system that now
   actually exists, including how its tools and research loop are used.
3. A concise human operator guide for starting, observing, steering, stopping,
   and recovering the protocol.

Stop after producing the handoff. The human reviews the result, may request
changes, and decides whether Mission 02 becomes active.
