---
artifactType: stage-gates
version: 1
---

# Stage Gates

This file adapts the Stage-Gate model (Cooper) to strategy research: stages of
increasing data investment, gates with pre-declared go/kill criteria between
them. It is the decision policy for research — when a strategy advances to more
data, when a family keeps experimenting, and when a family may be killed. Where
these rules differ from the textbook model, these rules win.

The Researcher executes the climb (submits runs and extensions, applies the
stopping rules). The Evaluator judges every gate (writes stage results and
verdicts). Both cite this file; neither invents criteria.

All tunable numbers live in the config block below. Changing a number or adding
a stage bumps `version` in the frontmatter; experiment outcomes record the
`gatesVersion` they were judged under, so old verdicts stay interpretable.

## Config

```yaml
gatesVersion: 1
minExperiments: 20
# Taker fee rate used by the backtest simulator — mirrors
# DEFAULT_BACKTEST_TAKER_FEE_BPS in src/trading/fees.ts (env override:
# BACKTEST_TAKER_FEE_BPS). If the venue or simulator rate changes, update
# both and bump gatesVersion.
takerFeeBps: 156
stages:
  - stage: 1
    name: screen
    markets: 1000
  - stage: 2
    name: confirm
    markets: 3000
  - stage: 3
    name: full-history
    markets: 9000
```

## Cost model

There is deliberately NO universal "cost per market" constant — cost per
market is a property of a strategy (its fills per market, order size, and
entry prices), not of the market. What is constant is the venue fee model,
identical to what backtests simulate ([`src/trading/fees.ts`](../src/trading/fees.ts)):

```text
fee per taker fill = (takerFeeBps / 10000) × min(price, 1 − price) × shares
```

Worked example at `takerFeeBps: 156`: a $10-notional taker trade at price
0.50 buys 20 shares → fee ≈ 1.56% × 0.5 × 20 = $0.156 per fill, ≈ $0.31 per
round trip — plus the spread crossed on entry/exit. The same trade at price
0.90 costs ≈ $0.035 per fill (min(p, 1−p) shrinks the fee near the edges).

The cost model is used in exactly two places:

- **Edge economics gate** (ProposeFamily): every proposal must compute ITS
  OWN expected cost per market — expected fills/market × fee at its typical
  price and size, plus spread cost — and show the plausible gross edge
  beats it. A family that cannot is not proposed.
- **Structural kill** (stopping rules below): the ceiling argument compares
  the mechanism's theoretical best gross edge against the same
  strategy-specific computation.

`netEvPerMarket` from backtests already includes real simulated costs; the
cost model is for pre-run and ceiling reasoning, never for adjusting
results. Once ANY run exists, measured numbers win: all real fees and EV
live in `backtest_run_segments` (the `all` segment — `evPerMarketTotal`,
`totalFeesPaid`, ...). When a comparable strategy has already run, cite its
measured costs instead of the formula — the formula is only for ideas with
nothing comparable on record.

## The stages

Applied per champion-candidate experiment. Each stage costs roughly 3x the
previous one; only survivors advance, so most compute is spent on strategies
that already showed something.

| stage          | coverage     | gate to advance                       | mechanism                                 |
| -------------- | ------------ | ------------------------------------- | ----------------------------------------- |
| 0 smoke        | ~10 markets  | runs without errors; NEVER evidence   | `--sequential`, batchUid `--smoke` suffix |
| 1 screen       | latest 1000  | best cell `netEvPerMarket > 0`        | coordinate search runs here               |
| 2 confirm      | 3000 total   | `netEvPerMarket > 0` at 3000 markets  | `extendBacktest --latest --limit 2000`    |
| 3 full-history | ~9000+ total | `netEvPerMarket > 0` at full coverage | `extendBacktest`                          |
| live           | —            | user judgment; dry-run first          | out of protocol scope                     |

Gates are deliberately simple in v1: net profitability at the stage's
coverage, nothing else. There is no train/test split yet. The Evaluator still
REPORTS distribution concerns as advisories — instability across monthly
chunks, concentration in a few outlier markets, thin trade counts — but
advisories inform the Researcher's next move; they do not block a gate.

Rules of the climb:

- Stage 1 uses the LATEST markets — the most relevant data. If experiments
  cannot find profitable EV there, older data will not save the idea and no
  further stages are spent on it.
- Extensions grow coverage backward contiguously (newest missing markets
  first), so stage 2 = the same 1000 already tested + the 2000 immediately
  older. The recent window is always included.
- The climb happens inside ONE experiment record: `extendBacktest` grows the
  same run, `coverage` is updated, and `outcome.stageReached` records the
  highest gate passed.
- **Every gate decision is recorded in the experiment's `gateLog`** in
  FAMILY.json (`{stage, decision, at, note}`, written by the Evaluator at
  the moment of the decision). A fresh session reads the climb state from
  the gateLog — never guesses it from coverage.
- Passing the stage-3 gate makes the family `validated` (set by the
  Evaluator).
- There is no forward-holdout stage in v1 — the user observes the live
  dry-run instead. A stage 4 (fresh markets postdating all decisions) may be
  added later by bumping this file's version.

## Gate decisions

At every gate the Evaluator issues exactly one decision and appends it to the
experiment's `gateLog`:

- **go** — gate passed; the Researcher extends to the next stage.
- **recycle** — gate failed, but the family is not killable (see stopping
  rules); the experiment gets its verdict and the Researcher proposes the
  next experiment from the roadmap.
- **kill** — only per the stopping rules below, and the kill itself is the
  Researcher's family-level decision, recorded with `retryOnlyIf` (it is a
  family action, not a gateLog entry).

There is no "hold" decision: an experiment is never parked half-judged.

## Flows

- **Flow A — baseline finds no positive EV.** The family stays `researching`
  and the roadmap continues. A negative baseline never implies kill on its
  own.
- **Flow B — an experiment passes the stage-1 gate.** Advance stage by stage.
  On passing the final gate the family becomes `validated` AND research
  continues: challengers keep coming, and the champion pointer moves only if
  a challenger passes the gates itself.

## Stopping rules

A family may only be killed under one of these two rules. Config:
`minExperiments: 20`.

### Structural kill — allowed at any experiment count

Requires a numeric ceiling argument in the closing Research-log entry: e.g.
"at zero-noise entries the max gross edge is $X/mkt; this strategy's cost
per market (cost model above) is $Y > X". If the mechanism cannot pay costs
at its theoretical best, more experiments cannot fix it.

### Empirical kill — results keep failing, no ceiling proven

Requires ALL of:

- every mechanism-distinct idea in the Experiment roadmap has been tried,
- at least `minExperiments` experiments have been evaluated, and
- no improvement trend across the recent experiments.

### Every kill records

- `retryOnlyIf` — a concrete, testable revisit condition (never "maybe try
  later"),
- `verdictSummary` — one sentence for the INDEX rollup,
- a closing Research-log entry ending with a `Lesson:` line.

A killed family is not wasted: its lessons feed future proposals, and it may
be reopened when the retry condition is met.
