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
- status: accepted — engine fix in progress (extend will inherit latency from the parent cmd; CLAUDE.md corrected)
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
- update 2026-07-30 (PLAN `tools-launch-and-smoke`, run 857): mitigated at
  the tool layer — `tools/run-backtest.ts` generates a unique `--batchUid`
  per launch and recovers the run via `WHERE batch_uid = ?` (deterministic,
  race-free, works on both sequential and queue paths). The engine fix
  (print the persisted run id) would still help humans running the raw CLI;
  priority for pair-fable: low.

## P-004: Producer machine is running 5 backtest worker slots — intended?
- status: accepted — human ruling: producer worker slots will be disabled before live trading starts; backtest-only operation may continue meanwhile
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


## P-008: no --limit silently caps eligible markets at 1000 (oldest) — "full universe" runs are quietly truncated
- status: accepted — engine fix in progress (no --limit at the backtest CLI will mean the full eligible universe)
- date: 2026-07-30
- context: PLAN `evaluator-design`. Run 864, launched with no `--limit` expecting the full protocol universe (10,747 eligible markets from 2026-04-02), persisted exactly 1000 markets — the 1000 oldest.
- proposal: `listEligibleTelonexMarkets` defaults `limit ?? 1000` ("to match legacy behaviour", src/db/telonexMarkets.ts:117,276), and the backtest CLI passes `--limit` through without distinguishing "user asked for 1000" from "user asked for everything". A run whose cmd shows NO --limit looks like a full replay but silently isn't — dangerous for anyone comparing "full universe" runs over time as the universe grows past 1000. Repro: `npm run backtest -- --strategy <id> --input-mode telonex-delta --read-from local --symbol btc --timeframe 15m --from-ms 1775088000000` ⇒ 1000 markets despite 10k+ eligible. Suggested fix: make no-limit mean unlimited at the CLI boundary (or require an explicit --limit and error otherwise); the 1000 default inside the module can stay for legacy callers if the CLI always passes an explicit value. Mitigated at tool layer: protocols/pair-fable/tools/run-backtest.ts injects `--limit 1000000` when the caller gives none (d8b8cc9).

## P-009: measure live maker fill QUALITY (benign-lift share) to bound the worst-queue bias
- status: proposed
- date: 2026-07-31
- context: Mission 02 session 3, pair-v4.md §per-start invariant (E-014). Six runs across two mechanisms and three gates show per-start EV locked at ≈ −0.06/share under the simulator's worst-queue model, killing the whole top-of-book maker pair-accumulation class UNDER THE SIM. But worst-queue grants a fill ONLY when price trades through the level — the maximally adverse subset. Live, takers also lift resting orders without the level breaking (parity.md §3), and those fills are benign for a pair strategy (RULES §fill-model note frames this as understated fill RATE; E-014 shows the bigger issue is fill COMPOSITION).
- proposal: a small, bounded LIVE measurement to estimate what fraction of real maker fills at bestBid are benign lifts vs trade-throughs, e.g. minimum-size (~5-share) GTD bids joined at bestBid on both sides of a few dozen BTC 15m windows, recording for each fill whether bestBid still held 1s/5s later, plus book context. Cost is a few dollars of inventory risk per window at minimum size; DRY_RUN cannot measure this (no real queue position). If the benign share is materially > 0, the −0.06/share class verdict is a sim floor, not a market fact, and the class may deserve a live-calibrated revisit; if fills are overwhelmingly trade-throughs, the kill is confirmed as real. Needs the human (real orders, real key) — the protocol cannot and will not run this itself.

## P-010: buy-only pair mechanics on btc-15m are exhausted at 140 ms under the worst-queue sim — ruling requested on where to search next

- **Status**: proposed (2026-07-31, session 6)
- **Evidence** (all reproduced, all pre-registered): E-005/E-014 (top-of-book
  maker pair: −0.06/share per-start invariant across every gate, cadence and
  both-sides mechanism, full-universe stationary loss), E-015 (taker-taker
  arb: moments sub-ms, 1/1943 survives 140 ms), E-016 (maker→instant-taker:
  complement repriced before the fill instant, P(C<1)=2.4%), E-017
  (taker→maker: +$0.02/mkt best gate, stranded side wins 2.2%, negative even
  at zero latency), E-018 (deep-book maker at six depths: hold-all negative
  everywhere; zero-latency completion IS profitable from δ=0.02 but 140 ms
  of repricing consumes exactly the cushion).
- **The recurring wall**: ~3–4 c of complement repricing within 140 ms, plus
  unconditional adverse selection on any passive fill. Two of five families
  would be profitable at ~0 ms (E-015 $1.88/mkt; E-018 deep completion) —
  the edge exists and belongs to colocated speed.
- **Options that need a human ruling** (any subset):
  1. Approve P-009 (live DRY-RUN maker fill-quality measurement) — bounds
     the worst-queue pessimism with real data; cheap; if benign-lift share
     is high, several KILLs weaken and E-006/E-007-class families reopen.
  2. Widen strategy space beyond buy-only (allow sells / mid-market merges
     per RULES amendment) — changes the residue economics that killed
     every family.
  3. Widen universe: other timeframes (1h/4h/1d have slower repricing
     walls?) and/or ETH/SOL/XRP — same mechanics, different microstructure.
  4. Revisit the 140 ms latency assumption (infrastructure ruling — is
     sub-50 ms placement realistic for us? E-015/E-018 quantify the prize).
- **Cost if unanswered**: after M1–M5 hardening and sibling-memory review,
  the in-rules research frontier is empty; the loop would be reduced to
  re-testing killed families on new data windows.
- **Addendum (2026-07-31, session 7) — data facts to inform the ruling**:
  - Option 3 (widen universe) has a data-pipeline prerequisite the loop
    cannot fulfil itself: the converted (backtestable) dataset is
    **btc-15m only** — 25,842 done delta-typed conversions (10,747 post
    protocol floor, matching run 870 exactly) plus 6 stray btc-5m markets.
    ETH/SOL/XRP-15m are cataloged but unconverted (25,593 / 24,633 / 24,663
    markets since 2025-10); 5m is cataloged in volume (~44k per symbol since
    2026-02, incl. btc); **1h/4h/1d are not cataloged at all** (a
    telonex:sync scope change, before any conversion). Choosing option 3
    therefore means the human (producer machine) runs
    `data:sync:main --market <sym>:<tf>` (+ priceToBeat backfill; chainlink
    crypto_prices coverage is symbol-independent but feed parity for
    non-BTC symbols is unverified) before any backtest can run. [db
    telonex_markets ⋈ telonex_market_conversions GROUP BY symbol,timeframe |
    2026-07-31]
  - Option 1 (P-009 live fill-quality probe) has design-level precedent:
    the parent workspace's plan (`protocols/pair/VISION_AI.md`, phase P2.5)
    already schedules a ~$50 micro live probe as "the one question no
    backtest can answer", explicitly for calibrating the simulator's fill
    model. P-009 is a narrower, cheaper version of that planned phase.
  - Also on option 3: our RULES.md pins the market to btc `btc-updown-15m-*`
    / 15 min (lines 6–7), and its feed-coverage epochs are stated for btc-15m
    specifically — so options 2 and 3 both need a RULES amendment, not just
    data.
- **Addendum (2026-07-31, session 8)**: human ruling (inbox 8758567d)
  rejected the class-level kill that motivated this escalation and directed
  research to resume in-backtest on six identity-derived axes (absolute
  per-side price ceiling first). P-010 and P-009 remain open per the ruling
  but are explicitly NOT blockers; the "frontier is empty" premise of this
  proposal is withdrawn (see evaluator.md §Kill standards).

## P-011: fill model cannot pin maker capture within a factor of ~29–235 — queue-aware fill model / trade-print calibration needed before any HF maker work
- status: proposed
- date: 2026-07-31
- context: E-024 (pre-registered hf-fill-probe.md, executed session 12 via
  tools/fillprobe.ts on the pinned 800): an always-quoting top-of-book
  10-share bid captures 897 shares/mkt under the engine's worst-queue rule
  (140 ms) vs 26,215 shares/mkt under an optimistic front-of-queue bound
  (level-decrease capture) — a 29× gap at deployable latency (235× at
  0 ms), above the pre-registered 3× "materially binding" bar on every
  single day. Raw top-of-book bid-level decrease flow is ~225k shares/mkt,
  so the human-reported 700-trades/window operator is inside observed
  activity. The engine therefore cannot certify OR refute the HF maker
  regime: "fill-limited" conclusions (E-013) are model-scoped.
- proposal: before any HF maker strategy code, close the W..O interval by
  one of (in our cost order):
  1. (no engine change, already pre-registered as E-025) trade-print
     calibration on the 36 locally recorded live-WS btc markets —
     last_trade_price events give true executed volume at the bid; the
     loop runs this itself and reports the cancel-share of level
     decreases and the T/W ratio.
  2. If E-025 shows trade-confirmed capture ≫ worst-queue: an engine-side
     queue-position-aware maker fill option for backtests (track
     rest-time queue position from level sizes + trade prints; the
     recorded dataset has what is needed, the telonex dataset does not —
     it lacks trade prints, so a telonex-wide model needs either a
     conversion change upstream or an explicit calibrated-factor model).
  3. P-009 (live maker fill-quality micro-probe) remains the ground-truth
     option and would double as the calibration for (2).
  No decision needed to unblock current research (E-025 is in-rules
  reanalysis); a ruling is needed only if (2)'s engine work should be
  scheduled, or if HF maker strategy work should be prioritized after
  E-025 reports.
