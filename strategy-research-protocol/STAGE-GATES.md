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
stopping rules) and judges every gate against this file (writes gate
decisions and verdicts, quoting the measured numbers). It cites this file;
it never invents criteria.

All tunable numbers live in the config block below. Changing a number or adding
a stage bumps `version` in the frontmatter; experiment outcomes record the
`gatesVersion` they were judged under, so old verdicts stay interpretable.

## Config

```yaml
gatesVersion: 1
minExperiments: 20
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

## Costs are measured, never modeled

There is NO cost formula and NO cost constant in this protocol. Every real
number comes from `backtest_run_segments` (the `all` segment):

- `evPerMarketTotal` — net EV per market, fees already included. The ONLY
  verdict metric.
- `totalFeesPaid` — measured fee drag; per market: `totalFeesPaid / markets`.
- Measured gross EV per market = `evPerMarketTotal + totalFeesPaid / markets`.

"Is this signal fee-bound?" (gross positive, net negative) is read directly
from these measured numbers — the smoke run and the stage-1 screen exist
precisely so that finding out is cheap.

Consequences:

- **Edge economics** (ProposeFamily) is a mechanism argument, not
  arithmetic: why should THIS edge be structurally fat, who is on the other
  side, and what do the measured numbers of comparable past strategies
  (segments of prior runs, killed families' outcomes, LESSONS.md) say about
  ideas of this shape. No invented cost estimates.
- **Structural kill** (stopping rules below): the ceiling argument uses the
  family's OWN measured numbers — e.g. "best cell measured gross
  +$X/mkt with measured fee drag $Y/mkt > X; even zero-noise entries cannot
  pay the costs this strategy actually incurs".

## The stages

Applied per champion-candidate experiment. Each stage costs roughly 3x the
previous one; only survivors advance, so most compute is spent on strategies
that already showed something.

| stage          | coverage     | gate to advance                       | mechanism                                                          |
| -------------- | ------------ | ------------------------------------- | ------------------------------------------------------------------ |
| 0 smoke        | ~10 markets  | runs without errors; NEVER evidence   | smoke profile per [`tools/runBacktest.md`](./tools/runBacktest.md) |
| 1 screen       | latest 1000  | best cell `netEvPerMarket > 0`        | coordinate search runs here                                        |
| 2 confirm      | 3000 total   | `netEvPerMarket > 0` at 3000 markets  | extend per [`tools/extendBacktest.md`](./tools/extendBacktest.md)  |
| 3 full-history | ~9000+ total | `netEvPerMarket > 0` at full coverage | extend per [`tools/extendBacktest.md`](./tools/extendBacktest.md)  |
| live           | —            | user judgment; dry-run first          | out of protocol scope                                              |

Gates are deliberately simple in v1: net profitability at the stage's
coverage, nothing else. There is no train/test split yet. The Researcher
still REPORTS concerns as advisories — instability across monthly chunks,
concentration in a few outlier markets, thin trade counts, sensitivity to
parameter choice, behavior near market open/close, anything that could not
survive live execution constraints — but advisories inform the next move;
they do not block a gate.

Rules of the climb:

- Stage 1 uses the LATEST markets — the most relevant data. If experiments
  cannot find profitable EV there, older data will not save the idea and no
  further stages are spent on it.
- Each stage adds the markets immediately OLDER than the already-covered
  window, so coverage stays one contiguous block ending at the newest data:
  stage 2 = the same 1000 already tested + the 2000 immediately older. How
  to submit that extension lives in
  [`tools/extendBacktest.md`](./tools/extendBacktest.md).
- The climb happens inside ONE experiment record: `extendBacktest` grows the
  same run, `coverage` is updated, and `outcome.stageReached` records the
  highest gate passed.
- **Every gate decision is recorded in the experiment's `gateLog`** in
  FAMILY.json (`{stage, decision, at, note}`, written by the Researcher at
  the moment of the decision, with the measured numbers in `note`). A fresh
  session reads the climb state from the gateLog — never guesses it from
  coverage.
- Passing the stage-3 gate makes the family `validated` (set by the
  Researcher).
- There is no forward-holdout stage in v1 — the user observes the live
  dry-run instead. A stage 4 (fresh markets postdating all decisions) may be
  added later by bumping this file's version.

## The two bars: gate vs successCriteria

An experiment is judged against two stacked bars — do not confuse them:

- **The gate (this file)** is the PROTOCOL's bar: it alone decides
  advancement, `validated`, and champion eligibility. It lives here,
  outside the family files, versioned — a session working on a family
  cannot soften the bar that mints validation.
- **`successCriteria` (the experiment record)** is the EXPERIMENT's own bar
  on top: default "pass the next stage's gate", optionally stricter (e.g.
  "...AND beat the baseline's best cell"). It may never be weaker than the
  gate. It decides the verdict wording and champion comparisons between
  gate-passing experiments — never validation itself.

## Gate decisions

At every gate the Researcher issues exactly one decision and appends it to
the experiment's `gateLog`:

- **go** — gate passed; extend to the next stage.
- **recycle** — gate failed, but the family is not killable (see stopping
  rules); the experiment gets its verdict and the next experiment comes
  from the roadmap.
- **kill** — only per the stopping rules below; the kill is a family-level
  decision, recorded with `retryOnlyIf` (it is a family action, not a
  gateLog entry).

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

Requires a numeric ceiling argument in the closing Research-log entry, built
from the family's own measured numbers: e.g. "at zero-noise entries the max
measured gross edge is $X/mkt; the measured fee drag is $Y/mkt > X". If the
mechanism cannot pay the costs it actually incurs even at its theoretical
best, more experiments cannot fix it.

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
