# Proposals — pair-fable

Engine bugs, improvement suggestions, and rubric questions, recorded as they
arise (RULES: Human interface). One entry per proposal. The human flips
`status:`; the agent acts on `accepted`, drops `rejected`, never deletes
entries.

Entry format:

```
## P-NNN: <title>
- status: proposed | accepted | rejected
- date: YYYY-MM-DD
- context: <what was being done when this arose>
- proposal: <the concrete ask, with exact repro for bugs>
```

<!-- entries below, newest last -->

## P-001: `--extend` silently drops the parent run's simulated latency
- status: proposed
- date: 2026-07-30
- context: Initializer code survey of the backtest CLI (spot-checked by hand).
- proposal: The comment at `src/cli/helpers/backtestArgs.ts` (extend-conflict
  block, ~line 484) says "Extension jobs must replay with the same simulated
  latency as the parent run (whose cmd records it)" — but no code reads the
  parent's latency. `--latency-delay-ms/--latency-jitter-ms` are forbidden
  with `--extend`, and `src/cli/backtest.ts:565-570` then resolves latency
  from env (`BACKTEST_LATENCY_DELAY` default 0). Repro: launch a run with
  `--latency-delay-ms 140`, then `--extend <runId>` in a shell without the
  env var — extension markets replay at 0 ms while the parent ran at 140 ms,
  mixed inside one run with no audit trail. CLAUDE.md also states extensions
  "replay the parent's latency", which the code does not implement. Suggested
  fix: parse latency out of the parent's `cmd` (or persist latency as run
  columns) and stamp it into extension jobs. Until then this protocol treats
  latency-pinned runs as non-extendable.

## P-002: Persist per-market invested capital (buy notional) on backtest_run_markets
- status: proposed
- date: 2026-07-30
- context: Initializer survey of stats/storage while designing capital-aware
  evaluation units (mission 01 goal 5; mission 02 goal 2 makes them mandatory).
- proposal: `computeMarketStats` already accumulates
  `totalUpBuySize/totalUpBuyCost/totalDownBuySize/totalDownBuyCost`
  (src/backtest/stats/marketStats.ts:107-137) but discards them after
  computing the entry-price VWAPs. Stored `cost` is only the REMAINING cost
  basis; `avg_entry_price × shares` ≠ invested for any strategy that sells or
  merges. Persisting buy notional (e.g. `buy_cost_up`, `buy_cost_down`, or a
  single `invested` column) would make "invested per market" and "profit per
  $100 invested" derivable for every strategy, historical comparisons
  included, with no replay-time behavior change. For pair-fable's no-sell
  strategies `cost` may serve as a workaround (to be verified in PLAN
  `metrics-and-capital-units`), but the general fix belongs in the engine.
- update 2026-07-30 (PLAN `metrics-and-capital-units`, run 856): pair-fable is
  NO LONGER BLOCKED by this — verified empirically that for no-sell/no-split/
  no-merge strategies `cost` equals fee-inclusive invested to the cent,
  winning-side settlement included (3 markets, multi-buy both sides; full
  arithmetic in protocols/pair-fable/memory/process/evaluator.md). Proposal
  stays open, sharpened for the general case: persist the four accumulators
  computeMarketStats already computes and discards
  (src/backtest/stats/marketStats.ts:107-137) as columns
  `buy_size_up`, `buy_cost_up`, `buy_size_down`, `buy_cost_down` on
  `backtest_run_markets` (raw notional, fee-exclusive — fees_paid already
  exists separately). That makes invested derivable for selling/splitting
  strategies too and doubles as an integrity check on `cost`. Priority for
  pair-fable: low.

## P-003: Sequential backtests print no run/batch identity
- status: proposed
- date: 2026-07-30
- context: PLAN `smoke-local-backtest` run-verification (runs 852/853).
- proposal: `--sequential` persists the run silently — stdout contains neither
  the numeric run id nor the batchUid (the BullMQ path prints both:
  `src/cli/backtest.ts:1224,1263`). The sequential path persists via
  `insertBacktestRun` at `src/cli/backtest.ts:1059-1083` and prints only
  BATCH STATS. Automation must recover the run by querying the newest
  `backtest_runs` row for its protocol/model — racy when runs launch in
  parallel. Suggested fix: after `insertBacktestRun`, print one line, e.g.
  `[backtest] persisted run id=<id> batchUid=<uid>` (insertBacktestRun would
  need to return the inserted id if it does not already). Until then the
  protocol's launch tools query the DB immediately after a sequential run
  completes and match on cmd/batchUid (the injected `--batchUid` in cmd is
  unique enough: it equals submission_uid).

## P-004: Producer machine is running 5 backtest worker slots — intended?
- status: proposed
- date: 2026-07-30
- context: PLAN `fleet-round-trip` (runs 854/855). RULES says "m1-ivan is the
  PRODUCER and live-trading machine — models never run backtest workers on
  it" and lists fleet capacity as 22 slots.
- proposal: Observation, needs a human ruling (I started nothing): machine
  `8955f8d87c59` — the producer, per run 852's sequential machine_id — has 5
  worker processes + supervisor heartbeating in Redis and took 26 of run
  855's 200 markets. Pre-batch its workers ran commit c80bb2f, which is NOT
  on origin/main (a pair-docs branch commit), yet they self-updated to
  6c457e4 when jobs arrived. Questions: (a) are these workers intended (if
  yes, the RULES fleet table is stale — real capacity is 27 slots, and they
  will compete with live trading for cores); (b) if not intended, they should
  be stopped. Producer-slot markets were the slowest in run 855 (avg 2.4s vs
  1.4-1.6s fleet). No action taken by the protocol; fleet.md documents the
  observed reality.

## P-005: place_batch 15-order cap enforced only in LiveExecution — backtest accepts unlimited batches
- status: proposed
- date: 2026-07-30
- context: PLAN `parity-boundary-map` (parity.md §3/§4), code-read @ e96b246.
- proposal: Live rejects any `place_batch` with >15 orders wholesale — every
  order gets `order_rejected 'batch_too_large(max_15_orders)'`
  (src/trading/execution/LiveExecution.ts:155-167). Neither the shared
  OrderManager (src/trading/OrderManager.ts:379-482) nor BacktestExecution
  (BacktestExecution.ts:289-421) enforces any cap, so a strategy emitting a
  16+ order batch backtests perfectly and is dead on arrival live — a silent
  parity trap. Suggested fix: enforce the cap in OrderManager.handlePlaceBatch
  (shared by both modes), either rejecting the batch identically to live or
  splitting it into ≤15 chunks (rejecting identically is the smaller, safer
  change). Until then pair-fable strategies cap batches at 15 by convention.

## P-006: cancel_order id-space mismatch — backtest cancels by clientOrderId, live by orderId
- status: proposed
- date: 2026-07-30
- context: PLAN `parity-boundary-map` (parity.md §3/§5), code-read @ e96b246.
- proposal: BacktestExecution.cancelOrderNow uses ONLY `intent.clientOrderId`
  and ignores `orderId` (BacktestExecution.ts:567-591); LiveExecution.cancelOrder
  uses ONLY `intent.orderId` and treats a clientOrderId-only intent as a silent
  no-op (LiveExecution.ts:393-413). A strategy that sets just one of the two
  ids works in exactly one mode, with no error in the other. Portfolio already
  maintains the clientOrderId↔orderId mapping (Portfolio.ts:41-46,126).
  Suggested fix: OrderManager.handleCancelOrder enriches the intent with the
  missing id from that mapping before delegating, making either id sufficient
  in both modes. Until then pair-fable strategies always set BOTH ids by
  convention.

## P-007: LiveExecution.cancelOrder swallows API errors and always reports 'canceled'
- status: proposed
- date: 2026-07-30
- context: PLAN `parity-boundary-map` (parity.md §3), code-read @ e96b246.
- proposal: `await this.client.cancelOrder({orderID}).catch(() => undefined)`
  then unconditionally emits `order_done` reason 'canceled'
  (LiveExecution.ts:393-408). If the cancel HTTP call fails (network blip,
  auth, rate limit), the strategy and Portfolio believe the order is gone
  while it is still resting on the exchange — the clientOrderId is freed for
  reuse and open-order bookkeeping drops the row (a later real fill still
  books position by orderId, but against a "closed" order). For a maker
  strategy that continuously cancels/reprices resting bids this can silently
  accumulate live exposure. Suggested fix: inspect the cancelOrder response /
  catch the error and emit nothing (or an explicit cancel_failed diagnostic)
  on failure, letting the user-WS CANCELLATION message be the source of truth
  — mirroring how placement already trusts user WS for lifecycle.

