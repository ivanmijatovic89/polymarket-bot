# Capability: live/backtest parity boundary (for the pair strategy)

verified: 2026-07-30 @ e96b246 (code-read of both execution adapters, OrderManager,
StrategyRunner, user-WS account source, telonex replayer, Portfolio id-mapping.
Behavioral claims about the running EXCHANGE are marked PARKED — unverifiable from
this repo's code.)
watches: src/trading, src/market, src/strategy, src/polymarket, src/parquet/replay

This is the definitive map of what a backtest does and does not prove about live
behavior, for THIS strategy (maker-leaning both-side BUY accumulation, no sells,
settle-valued pairs). Companion notes: simulator.md (fill mechanics detail),
metrics-storage.md (what persists).

## 1. Truly shared — identical code runs in both modes

- **MarketEngine + orderbook engines**: live constructs it on the WS stream
  [code src/cli/trading-bot.ts:564 @ e96b246], telonex-delta replay constructs the
  same class and feeds reconstructed book/price_change messages
  [code src/parquet/replay/replayTelonexDeltaParquetForMarket.ts:139-188 @ e96b246].
  EngineTick emission rules (book + price_change only) are engine-side ⇒ identical.
- **StrategyRunner**: serial run queue, account-event cascade with
  maxEventsPerDrain, cached per-tick plugin snapshot reused for cascades,
  position/orderbook metrics computation — one class, both modes
  [code src/trading/StrategyRunner.ts:380-574 @ e96b246].
- **OrderManager**: GTD min-expiry (+60s), price/size validation, dedupe by
  clientOrderId (freed on done/rejected), risk-limit enforcement on EVERY intent
  batch — shared [code src/trading/OrderManager.ts:97-509 @ e96b246]. The risk
  walls (20 open orders / 2000 size / 2000 abs position / −500 loss stop) are
  therefore identical live and backtest.
- **Portfolio**: fills→positions/PnL, taker-fee computation from the fill's
  feeRateBps, orderId↔clientOrderId mapping built from order_accepted
  [code src/trading/Portfolio.ts:39-46,121-130 @ e96b246].
- **Intent execution mode**: 'immediate' in both — backtest hardcodes it
  [code src/backtest/runSingleMarket.ts:146-156 @ e96b246], live defaults to it
  (env INTENT_EXECUTION_MODE could change it; the protocol assumes the default)
  [code src/cli/trading-bot.ts:155-158 @ e96b246].
- **Strategy code, params, plugins** — by construction.

## 2. Different clock & vantage point

- Backtest "now" = Telonex's recorder receive time `ts_local_ms`
  [code replayTelonexDeltaParquetForMarket.ts:172-179 @ e96b246]. Live "now" = our
  WS receive time. Same event stream content, different network vantage; the
  --latency-delay-ms 140/20 pin models OUR intent→exchange leg on top of it.
- External feed visibility is re-modeled per feed (BACKTEST_PRICE_TO_BEAT_LATENCY_MS,
  BACKTEST_RTDS_CHAINLINK_LATENCY_MS, binance measured-latency offset) — see
  CLAUDE.md; not re-verified here.

## 3. The simulated boundary — behavior by intent/event

| Aspect | Backtest | Live |
|---|---|---|
| Placement ack | synthetic order_accepted at the latency-due tick [code BacktestExecution.ts:556-565,458-459] | HTTP roundtrip; order_accepted only on API success; lifecycle then comes from user WS [code LiveExecution.ts:299-368] |
| Order status stream | synthetic: MATCHED (sizeMatched 0) at placement, CONFIRMED on complete fill, **MINED never**, RETRYING/FAILED never [code BacktestExecution.ts:462-477,515-529] | real progression MATCHED→MINED→CONFIRMED; RETRYING/FAILED possible — a MATCHED trade can still fail on-chain [code userWsAccountSource.ts:42-49] |
| Fill visibility | fill event at simulated match tick, always | portfolio-impacting fill emitted only at USER_WS_FILL_AT_STATUS (default **MINED** [code userWsAccountSource.ts:452; trading-bot.ts:759]) — position knowledge is delayed by chain confirmation unless MATCHED is configured; deduped per trade id |
| Maker fill | worst-queue: only when price trades THROUGH the level; then ALL remaining size in one fill at limit price [code BacktestExecution.ts:59-113] | real queue position; takers can lift the level without price trading through (fill RATE understated in backtest — RULES safe bias); fills dribble in as partial matched_amounts across multiple trade events [code userWsAccountSource.ts:283-327] |
| Taker fill | walks VISIBLE recorded depth at the due tick, per-level partials [code BacktestExecution.ts:116-167] | exchange matches against the real book at arrival (≈ one latency newer than what the strategy saw) |
| FOK unfillable | ws_order_update CANCELED + order_done reason **'killed'** [code BacktestExecution.ts:479-503] | API rejection ⇒ **order_rejected** (success:false path) [code LiveExecution.ts:331-345] — different event kind for the same outcome |
| place_batch >15 | accepted, all orders processed — no cap anywhere in backtest path [code BacktestExecution.ts:289-421; OrderManager.ts:379-482] | ENTIRE batch rejected, each order gets order_rejected 'batch_too_large(max_15_orders)' [code LiveExecution.ts:155-167] |
| cancel_order | cancels by **clientOrderId only**; orderId ignored; unknown id = silent no-op [code BacktestExecution.ts:567-591] | cancels by **orderId only**; clientOrderId-only intent = silent no-op; API errors swallowed and order_done('canceled') emitted regardless [code LiveExecution.ts:384-414] |
| cancel_all | cancels this market's sim orders, emits order_done each [code BacktestExecution.ts:605-623] | client.cancelAll() — **account-wide, all markets, all bots on the key**; emits NO events; order_done arrives per order via user WS CANCELLATION [code LiveExecution.ts:416-425] |
| GTD expiry | sim-checked each tick, order_done reason **'expired'** [code BacktestExecution.ts:671-682] | exchange-side; user WS CANCELLATION maps to order_done reason **'canceled'** [code userWsAccountSource.ts:398-401] — reason string differs |
| split | instant, zero latency, mints at costBasis 0 [code BacktestExecution.ts:205-261] | on-chain tx, seconds + retry loop [code LiveExecution.ts:433-581] |
| merge | MIS-SCORED, banned by RULES | real on-chain merge; the once-per-market live merge is an execution detail outside strategy logic |
| Taker fee rate | hardcoded 700 bps stamped on sim fills [code BacktestExecution.ts:14,197] | fee_rate_bps read from the WS message — live follows exchange changes, backtest does not [code userWsAccountSource.ts:234,305] |
| Warmup | absent; isWarmed()=true | first-order per-token tickSize/negRisk/feeRate fetch, pre-warmed on startup/rotation [code LiveExecution.ts:108-132] |
| Price grid / min size | any price >0 accepted [code OrderManager.ts:492] | clob-client applies real tick-size rules; off-grid or below-minimum orders can be rejected/rounded — backtest cannot catch this |
| Fill id linkage | fills carry clientOrderId | user-WS fills carry orderId only; clientOrderId reconciled via Portfolio's mapping [code userWsAccountSource.ts:414-415; Portfolio.ts:41-46] |

## 4. Resolved open questions (from the initializer survey)

1. **place_batch ≤15**: RESOLVED. Enforced ONLY live, as whole-batch rejection
   (LiveExecution.ts:155-167). Backtest and shared OrderManager have no cap ⇒ a
   >15 batch is a silent parity trap (works in backtest, dead live). Filed P-005.
2. **FOK visible-depth semantics**: RESOLVED as far as code allows. Backtest FOK is
   all-or-nothing against VISIBLE recorded depth at the due tick
   (sumFillableSize, BacktestExecution.ts:33-48). Live FOK is decided by the
   exchange against the real book at arrival. No hidden-order-type handling exists
   anywhere in this codebase; whether the exchange matches against liquidity we
   can't see is PARKED (unverifiable from code — see §7). Kill surfaces as
   order_done('killed') in backtest vs order_rejected live (§3).

## 5. pair-fable strategy conventions (binding — parity-safe by construction)

1. **cancel_order always carries BOTH ids**: clientOrderId + orderId (from
   `portfolio.openOrdersByClientId[cid].orderId`, populated by order_accepted
   [code Portfolio.ts:126]). Either-only is a silent no-op in one of the modes.
2. **place_batch ≤ 15 orders**, always.
3. **Never gate on MINED or CONFIRMED** (MINED never fires in backtest; CONFIRMED
   only on complete fill). Gate on fills/position state. We never sell, so the
   live MINED-before-sell/merge rule does not constrain strategy logic.
4. **Treat order_rejected and order_done(killed|expired|canceled) uniformly** as
   "order gone, clientOrderId free" — the same outcome arrives as different
   events/reasons across modes (§3 FOK, GTD rows).
5. **Quote only book-derived on-grid prices**; never synthesize sub-tick prices.
6. **Be indifferent to fill chunking**: logic must produce the same decisions
   whether a fill arrives as one all-at-once maker fill (backtest) or dribbled
   partials (live). Never count fill events; sum sizes.
7. **Stamp `Intent.meta` on every order** (side/price/size/tick context) — the
   only per-order analytics channel that persists. Definitive key spec +
   dedup/price-improvement caveats: memory/process/evaluator.md (verified
   run 856).
8. **Design inside the shared risk walls**: ≤20 open orders, ≤2000 shares/side,
   order size ≤2000, loss stop −500.

## 6. Live-trust evidence bar

A variant's backtest results are trusted for live promotion only when ALL hold
(threshold numbers belong to evaluator.md; the bar here fixes WHAT must be shown):

1. **Universe**: full protocol universe (≥ 2026-04-02, all eligible btc 15m
   markets), run via the fleet with provenance (`--protocol pair-fable --model
   <id>`), not a hand-picked subset.
2. **Latency robustness (RULES)**: profitable at the 140/20 baseline AND across an
   upward sweep (e.g. 300/50, 600/100, 1000/150, 2000/200), each latency pinned by
   flags in its own run's cmd. EV must not collapse toward ≤0 as latency grows.
3. **Jitter reproducibility**: latency jitter uses Math.random (nondeterministic)
   — at least one duplicate run at baseline; run-to-run EV spread must be small
   relative to the claimed edge, else the edge is noise.
4. **Maker-bias awareness**: worst-queue understates maker fill RATE (safe) but
   fills are all-or-nothing at the level (optimistic for large resting size) —
   increments must be small enough that size-optimism is negligible; and the
   profit must come from pair completion (mergeable shares), not from directional
   windfalls on residual winner shares (run 852 lesson: cheap resting bids fill
   preferentially on the losing side). Evidence: per-market up/down shares,
   imbalance path, pnl decomposition.
5. **Temporal stability**: positive across monthly segments (recent months
   weighted) and passes the walk-forward stability gate — an all-time average
   hiding a dead last-60-days is not promotable.
6. **Rubric compliance audit**: zero sells, zero merge intents, fee-inclusive
   accounting (maker fills fees 0; any taker legs carry the 700 bps curve).
7. **Capital realism**: per-market stake cap set to intended live capital;
   invested-per-market and profit-per-$100-invested reported (no cash model
   exists — capital discipline is strategy-side only).
8. **Live dry-run gate**: before real money, the variant runs live with
   DRY_RUN=true through several 15m windows — verifies feeds, warmup, intent
   stream sanity, and the §5 conventions under real WS conditions. First real
   orders at minimum size (catches tick-grid/min-size rejections backtests
   cannot see).

## 7. Parked (unverifiable from this repo — mitigations noted)

- **Exchange-side FOK matching internals** (hidden liquidity, in-flight order
  interleaving): cannot be verified from bot code. Mitigation: the strategy leans
  maker GTC/GTD; FOK is optional garnish, and §6.8's live dry-run + small-size
  phase is the empirical check.
- **Live tick-size / minimum-order-size rejection rules**: inside
  @polymarket/clob-client + exchange. Mitigation: §5.5 convention + §6.8.
- **RETRYING/FAILED frequency on live fills**: unknown rate; determines how risky
  USER_WS_FILL_AT_STATUS=MATCHED accounting is for us. Mitigation: buys-only means
  a failed buy leaves us flat (no phantom inventory sold); keep default MINED for
  accounting until measured live.
- **Producer-vs-Telonex recorder vantage skew** (tick timing differences between
  their WS connection and ours): unmeasurable until we record live in parallel;
  the not-latency-dependent rubric is the structural defense.

## Engine findings filed from this work

- P-005 place_batch cap only in LiveExecution (parity trap).
- P-006 cancel_order id-space mismatch between adapters (parity trap).
- P-007 LiveExecution.cancelOrder swallows API errors and reports
  order_done('canceled') unconditionally (live-only correctness hazard).
