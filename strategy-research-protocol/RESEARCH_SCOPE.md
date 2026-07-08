# Research Scope

[`strategy-research-protocol/RESEARCH_SCOPE.md`](./RESEARCH_SCOPE.md) defines
the research scope for Strategy Research Protocol. Agents must read it before
proposing a new family, proposing an experiment, evaluating results, or changing
research memory.

The goal is not to describe all of Polymarket. The goal is to define the narrow
research scope that this protocol is allowed to optimize.

## Market scope

Current scope is only:

```text
Polymarket BTC 15 minute up/down binary markets
```

Do not propose research for other symbols, timeframes, venues, or cross-exchange
signals unless this file and the protocol rules are explicitly updated.

The target market is binary:

- `UP` wins if BTC closes above the window reference price.
- `DOWN` wins if BTC closes below the window reference price.
- Each market is one fixed 15 minute episode.
- Each episode has its own slug, condition, and token IDs.

The expected slug shape is:

```text
btc-updown-15m-<epochStart>
```

## Primary objective

Discover strategy families that produce positive expected value on BTC 15 minute
up/down markets after realistic execution costs.

The protocol should optimize for durable, replayable edge, not one-off lucky
backtests. A strategy is only useful if its behavior can be reproduced in live
trading from the same tick semantics used in backtests.

## Core invariant

Live trading and backtests must run the same strategy logic on the same tick
stream semantics. Any live/backtest divergence is a bug.

This means:

- Strategy decisions must be driven by data available in both live and backtest.
- Backtest replay must preserve the same meaningful tick semantics used live.
- Strategy code paths should be shared between live and backtest.
- Runtime-specific behavior must be explicit, documented, and safe when absent.

## Data source

The default research dataset is Telonex converted to delta-typed parquet.

Expected shape:

- One parquet file per market.
- One market equals one 15 minute BTC up/down episode.
- Files are selected by `symbol=btc` and `timeframe=15m`.
- Backtests should use the same market event semantics as live strategy ticks.

Backtest execution details belong in the relevant
`strategy-research-protocol/tools/` tool document.

## Allowed strategy inputs

Allowed by default:

- Market ticks emitted by `MarketEngine`.
- Meaningful market events: `book` and `price_change`.
- Order book state present in the replayed Polymarket stream.
- Market metadata required to identify the current BTC 15 minute window.
- Account/order/fill events that pass through the shared trading infrastructure.

Allowed only if explicitly recorded and replayable:

- Any derived feature computed from recorded market data.
- Any plugin snapshot whose source data is available with the same semantics in
  live and backtest.

## Forbidden strategy inputs

Do not use:

- Live-only signals.
- Unrecorded WebSocket fields.
- Other symbols such as ETH, SOL, or XRP.
- Other timeframes such as 5m or 1h.
- Cross-exchange or cross-venue arbitrage.
- External feeds that cannot be absent safely in backtests.
- Non-deterministic strategy behavior that changes between replay runs.

If an idea depends on one of these, it is out of scope for the current protocol.

## Execution cost assumptions

Backtest evaluation must account for realistic execution costs.

Costs and frictions include:

- Spread paid when crossing the book.
- Slippage from available depth.
- Taker fees where applicable.
- Maker adverse selection and non-fill risk.
- Minimum order sizes.
- Partial fills.
- Fee-adjusted share balances after buys.
- Redeem lifecycle for winning shares.

Maker orders may avoid taker fees, but they are not free edge. They carry fill
risk, queue risk, cancellation timing risk, and adverse-selection risk.

Taker orders provide immediate execution, but must overcome spread, slippage,
and fees.

Costs are measured, never modeled: real fees and EV live in
`backtest_run_segments` (`evPerMarketTotal` is net of fees, `totalFeesPaid`
is the measured drag). See the cost rules in
[`strategy-research-protocol/STAGE-GATES.md`](./STAGE-GATES.md). There is no
cost formula and no universal per-market cost constant anywhere in this
protocol.

## Research unit

The main research unit is a strategy family.

A family is defined by its primary decision driver. Parameter changes and small
filters are experiments inside a family. A genuinely different decision driver
is a new family.

Each family lives at:

```text
src/strategies/research/<family>/FAMILY.md
src/strategies/research/<family>/FAMILY.json
src/strategies/research/<family>/000-baseline.ts
src/strategies/research/<family>/<experiment-id>.ts
```

`src/strategies/research/<family>/FAMILY.md` carries human and agent reasoning.
`src/strategies/research/<family>/FAMILY.json` carries structured state.
Strategy code must be executable and replayable.

Research memory rules are defined in
[`strategy-research-protocol/MEMORY.md`](./MEMORY.md).

## Baseline experiment

Every new family starts with one baseline parameter sweep:

```text
000-baseline
```

The baseline sweep asks a simple question:

```text
Does this decision driver have any parameter region that can beat costs on BTC
15 minute up/down markets?
```

Do not seed a long experiment queue in
`src/strategies/research/<family>/FAMILY.json`. Additional ideas belong in the
`src/strategies/research/<family>/FAMILY.md` Experiment roadmap until results
justify speccing the next experiment.

## Evaluation posture

Evaluation is defined by the Judging results section of
[`strategy-research-protocol/modules/Researcher.md`](./modules/Researcher.md)
(how to judge) and
[`strategy-research-protocol/STAGE-GATES.md`](./STAGE-GATES.md) (the gates).
This file adds only the posture: the protocol target is durable positive EV,
not curve-fit parameter cells. Beyond the gate itself, the Researcher reports
as advisories: sensitivity to parameter choice, concentration in a few
outlier markets, thin trade counts, behavior near market open/close, and
anything that could not survive live execution constraints.

## Research memory

Research memory must follow
[`strategy-research-protocol/MEMORY.md`](./MEMORY.md). Do not rely on hidden
conversation history as the only record. Lessons that generalize beyond one
family are promoted to
[`strategy-research-protocol/LESSONS.md`](./LESSONS.md).

## Stop conditions

When a family may be killed is defined ONLY by the stopping rules in
[`strategy-research-protocol/STAGE-GATES.md`](./STAGE-GATES.md) (structural
kill vs empirical kill). This file adds no additional kill conditions. Every
kill sets a concrete `retryOnlyIf`.
