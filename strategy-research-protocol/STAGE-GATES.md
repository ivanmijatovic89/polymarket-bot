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

## The stages

Applied per champion-candidate experiment. Each stage costs roughly 3x the
previous one; only survivors advance, so most compute is spent on strategies
that already showed something.

| stage          | coverage     | gate to advance                                                          | mechanism                                 |
| -------------- | ------------ | ------------------------------------------------------------------------ | ----------------------------------------- |
| 0 smoke        | ~10 markets  | runs without errors; NEVER evidence                                      | `--sequential`, batchUid `--smoke` suffix |
| 1 screen       | latest 1000  | best cell `netEvPerMarket > 0` on the test split                         | coordinate search runs here               |
| 2 confirm      | 3000 total   | still positive; train/test consistent                                    | `extendBacktest --latest --limit 2000`    |
| 3 full-history | ~9000+ total | positive overall AND stable across monthly chunks (no sign-flip regimes) | `extendBacktest`                          |
| live           | —            | user judgment; dry-run first                                             | out of protocol scope                     |

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
- Passing the stage-3 gate makes the family `validated` (set by the
  Evaluator).
- There is no forward-holdout stage in v1 — the user observes the live
  dry-run instead. A stage 4 (fresh markets postdating all decisions) may be
  added later by bumping this file's version.

## Gate decisions

At every gate the Evaluator issues exactly one decision:

- **go** — gate passed; the Researcher extends to the next stage.
- **recycle** — gate failed, but the family is not killable (see stopping
  rules); the experiment gets its verdict and the Researcher proposes the
  next experiment from the roadmap.
- **kill** — only per the stopping rules below, and the kill itself is the
  Researcher's family-level decision, recorded with `retryOnlyIf`.

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
"at zero-noise entries the max gross edge is $X/mkt; the fee floor is
$Y > X". If the mechanism cannot pay costs at its theoretical best, more
experiments cannot fix it.

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
