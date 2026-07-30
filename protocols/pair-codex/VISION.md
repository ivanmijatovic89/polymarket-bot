# Pair Protocol — Vision

## What I want to build

I want an autonomous strategy-research system dedicated to one idea: buying
both sides of Polymarket BTC 15-minute markets for a combined fee-inclusive
cost that leaves a profitable margin below their $1 settlement value, then
realizing the difference through merge or redemption.

The objective is to find honest, capital-efficient strategies that are
profitable in backtests and survive realistic simulated execution conditions.
The system should continue researching and improving them as the market and
available data change.

This is a long-term project, not a one-time search. There may be several
independent ways to execute the same pair concept, and more than one may be
worth running if they remain profitable without competing for the same capital
or liquidity.

## Division of responsibility

I define the objective and the non-negotiable rules. This protocol is strictly
for backtesting. It must never run, control, or monitor dry-run or real-money
trading. I will test selected candidates live myself, outside this protocol.

The models have broad freedom to design everything else. This includes the
research loop, strategy variants, evaluation methodology, tools, memory,
multi-model cooperation, experiment selection, and the way results are
presented to me. I do not want to prescribe a research system before the models
have explored and verified the engine themselves.

## What success means

The near-term target is a strategy producing approximately $2–3 average net
profit per eligible BTC 15-minute market at a practical capital level. The
exact maximum combined pair cost is not fixed: the models must research whether
the honest threshold is, for example, $0.98, $0.97, $0.90, or something else.
This is a business target, not a complete statistical definition; Mission 01
must design an honest definition that includes capital usage, risk, sample
size, execution realism, and uncertainty.

The path is:

1. Build and verify the backtest research laboratory.
2. Produce reproducible, well-calibrated backtest evidence.
3. Present the strongest candidates and their risks clearly to me.
4. Continue improving and adapting the backtested strategies over time.

Any dry-run or real-money validation happens manually outside the protocol and
is solely my responsibility.

Profit is never assumed. A negative result, engine limitation, or failed idea
is useful when it is recorded honestly and does not become an unsupported
permanent conclusion.
