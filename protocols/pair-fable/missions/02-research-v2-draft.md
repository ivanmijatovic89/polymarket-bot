# Mission 02 v2: Continuous Pair-Controller Research

> **DRAFT — INACTIVE.** This file exists only for human review and comparison.
> Global Runtime continues to use `missions/02-research.md`. Do not treat this
> draft as a ruling until the human explicitly activates it.

## 1. Mission

Build a live-ready, profitable strategy for BTC 15-minute UP/DOWN markets by
researching a continuous two-sided inventory controller through the shared
live/backtest engine.

The lab operates autonomously: it designs falsifiable mechanisms, implements
them, runs evidence, evaluates results, records durable conclusions, and
continues until the human stops or repoints it.

`RULES.md` is the constitution. The Global Runtime contract is the session
interface. `memory/process/evaluator.md`, `memory/capabilities/parity.md`, and
`memory/process/team-workflow.md` define evaluation, promotion, parity, and
workflow details. Do not re-derive or weaken them here.

## 2. Primary program

The primary strategy is a stateful controller that operates through most of
each market and repeatedly buys both UP and DOWN.

Its objective is to:

- maximize matched inventory, `min(UP shares, DOWN shares)`;
- use cumulative inventory and later price oscillation to improve earlier
  purchases;
- keep current and maximum imbalance controlled;
- survive one-way markets without unlimited loss chasing;
- target final aggregate pair VWAP below `$0.98`, while reporting the fractions
  below `$0.95` and `$0.90`; and
- maximize absolute profit and profit per `$100` after realistic fees, latency,
  fill semantics, capital constraints, and tail losses.

The `$0.98` target is an aggregate objective, not a per-action invariant.
Temporary pair VWAP above `$0.98`, including controlled completion above `$1`,
is allowed when it reduces dangerous residue or when the controller has a
bounded, evidence-based recovery path. Recovery debt must account for time
remaining, capital, inventory imbalance, available liquidity, and worst-case
loss, and must tighten near market end.

Maker and taker orders are both allowed. Select them by expected net outcome;
do not optimize for a maker/taker percentage.

## 3. Binding priority

Work in this order unless the human explicitly changes it:

1. **Neutral controller:** improve the continuous all-market mechanism.
2. **Directional controller:** use the same controller with a measured,
   risk-bounded non-zero inventory target. Do not invent a directional tilt
   without evidence.
3. **Supporting diagnostics:** market selection, entry gating, favorite-region
   analysis, and isolated opportunities may explain controller losses or
   provide a controller signal, but may not replace the all-market program.

A diagnostic that suggests a selective standalone strategy is a finding, not
permission to pivot. Record it and return to priorities 1–2 unless the human
issues a new ruling.

Previous experiment failures are design constraints. They kill a new mechanism
only when exact behavioral equivalence is demonstrated. Maintain a backlog of
genuinely different mechanisms derived from the accounting identity, inventory
state, price paths, remaining time, liquidity, and measured failure modes.

## 4. Required outcomes

### 4.1 Profit target

The first live-candidate target is:

- `evPerMarketTotal >= 2`, calculated as `SUM(pnl) / COUNT(*)` over every market
  in the universe, including flat markets;
- achieved on the FULL protocol universe and the required S4 out-of-sample
  window, not only on a screen; and
- reported at an explicit `capPerMarket` with capital actually used and profit
  per `$100`.

### 4.2 Scale target

Capital must be tested at `$100`, `$500`, `$1,000`, and `$2,000` per market,
with order size adapted to capital and displayed depth.

The scale question cannot be declared answered, converged, or dead until:

- `$2,000` has been tested; and
- the controller has either approached 500–1,000 matched shares or produced
  direct mechanical evidence explaining why that range cannot be reached
  safely or profitably.

Smaller-scale linearity is evidence but does not replace the required check.

### 4.3 Portfolio target

After a profitable variant exists, continue researching independent profitable
variants. Independence is daily-PnL Pearson `r < 0.6` over at least 14 common
days, as defined by the evaluator. A weaker but independent profitable variant
may remain valuable.

## 5. Experiment contract

All strategy evidence must use the real shared strategy, `MarketEngine` tick
semantics, `OrderManager`, portfolio accounting, and execution adapters. A
separate approximate simulator cannot replace the shared live/backtest path.

Use the smallest stage that answers the current question:

1. smoke/integrity sample;
2. roughly 100–200 diagnostic markets when mechanism activation needs proof;
3. pinned 800-market screen;
4. fresh FULL/OOS evidence only for survivors.

Before implementation or submission, freeze only the necessary experiment
contract:

- hypothesis and causal mechanism;
- configurations and named comparisons;
- success, failure, and integrity metrics;
- noise-aware verdict bars; and
- what decision each outcome triggers.

Submit the complete independent grid together. Use several informative
experiments when justified, but never replace mechanism research with blind
parameter search, p-hacking, or post-result rule changes.

Every claim must cite tool evidence from the relevant session. Report failed
runs as failures. Comparisons must respect parameter, latency, engine-SHA, and
strategy-SHA identity rules. The Mission 01 M1–M5 safeguards must remain
implemented and passing before any promotion.

## 6. Session operating contract

One session is one coherent research increment. Recover state; do not narrate
or re-derive the entire program.

### 6.1 Time to evidence

Within 10 minutes, normally launch or resume at least one substantive action:

- a smoke or backtest;
- a data scan; or
- a concrete implementation test.

Reading, historical recap, and design prose alone do not count. If code must be
implemented first, keep the design minimal, implement immediately, and record
the concrete reason the target was missed.

### 6.2 Throughput

- Submit independent backtest configurations together.
- Use fleet wait time for useful analysis.
- Deterministically shard local replays over more than 100 markets when safe.
- If a large scan must be serial, record the database, checkpoint, I/O, or
  determinism constraint before launch.
- State clearly when work is analysis-only and no fleet backtests are expected.

### 6.3 Session close

Before returning:

- evaluate every completed result;
- update STATUS, JOURNAL, and durable experiment memory;
- record in-flight work and exact resume commands;
- prepare the next concise hypothesis and commands when the next step is known;
- commit and push protocol work; and
- write the required structured session result.

Do not keep a session alive solely to wait for fleet or local work. Return
`continue`; the next fresh session resumes from files. Never use backtest
`--extend`; use fresh FULL runs for additional coverage.

## 7. Alignment control

### 7.1 Every-session gate

Before closing, add this compact evidence-backed gate to STATUS and the session
summary:

- **Classification:** `neutral-controller`, `directional-controller`,
  `supporting-diagnostic`, or `unrelated`.
- **Contribution:** controller decision changed, with experiment/run/commit
  evidence.
- **Time to evidence:** minutes, first action, and pass/fail against 10 minutes.
- **Throughput:** experiments, runs, markets, concurrency, and any serial-scan
  justification.
- **Scale:** levels tested, matched shares, and any remaining required check.
- **Next:** exact next execution and its primary-program classification.
- **Verdict:** `GREEN`, `YELLOW`, or `RED`.

Verdicts:

- **GREEN:** directly implemented or tested the neutral or directional
  controller.
- **YELLOW:** one supporting diagnostic that directly informs controller math
  or tilt. The next session must return to GREEN.
- **RED:** unrelated work, a second consecutive diagnostic, selection becoming
  the primary strategy, premature closure of a binding requirement,
  evidence-free planning, or a missing gate.

A RED result stops that line and sets a concrete GREEN execution next. It does
not justify `wait` unless a genuine human or external blocker exists. Persist
verdict history in STATUS.

### 7.2 Every-fifth-session audit

Before new research in every fifth session, audit the previous five sessions
from gates and tool evidence:

- GREEN/YELLOW/RED counts and classifications;
- time-to-evidence compliance;
- experiments, runs, markets, and effective concurrency;
- progress against every open primary requirement;
- premature conclusions or silently closed requirements; and
- the next five-session plan.

The plan must contain at least three direct GREEN controller increments and no
more than one supporting diagnostic unless the human changes priority. Missing
gates, fewer than three GREEN sessions, diagnostic drift, or premature closure
make the audit RED and require correction before new research.

## 8. Promotion and ending states

Use `continue` while useful aligned work remains.

Use `wait` only when:

- a genuine human decision or external change is required; or
- a variant meets the profit target and the full live-trust bar in
  `memory/capabilities/parity.md`, including S4 evidence on at least 400 markets
  created after the parameter-freeze commit.

For a live candidate, write `state/LIVE-CANDIDATE.md` with the variant,
capital-aware results, risks, and proposed live configuration, then return
`wait` with summary `Live candidate ready for review`. DRY_RUN live windows
begin only after human review.

This mission has no natural `complete`. The session limit is a budget guard,
not a research plan.
