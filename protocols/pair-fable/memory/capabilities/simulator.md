# Capability: backtest execution simulator

verified: 2026-07-30 @ 4fde3ae (code-survey; the merge trap is also asserted independently in RULES from live verification. NOT yet run-verified — PLAN `smoke-local-backtest` / `parity-boundary-map`)

## Fill models

- **Maker (resting GTC/GTD)**: mode hardwired `worst_queue` in backtests — a resting BUY at P fills ONLY when bestAsk < P (strictly THROUGH; touch never fills). Conservative on the trigger (understates fill RATE — RULES flags this as the safe-direction bias for our maker-leaning strategy). BUT when triggered, the ENTIRE remaining size fills at once at the limit price — no queue/depth constraint ⇒ optimistic on fill SIZE for large orders. Keep sizes small (RULES increments) so the size optimism is negligible. [code src/trading/execution/BacktestExecution.ts:59-113,196]
- **Taker (crossing at placement)**: true depth walk level-by-level at-or-better than limit, per-level partial fills, each fill stamped TAKER + feeRateBps 700. FOK: kills (reason 'killed') if visible depth < size, else fills fully. GTC/GTD: take what crosses, rest the remainder as maker. [code BacktestExecution.ts:116-167,479-553]
- Maker-fill checks + GTD expiry run on each real tick BEFORE the strategy's onMarketTick; skipped on synthetic feed ticks.

## Order status in backtests

Placement immediately emits ws_order_update MATCHED (sizeMatched 0); full fill emits CONFIRMED. **MINED is NEVER emitted** — `isOrderTradeStatusAtLeast(…,'MINED')` passes only after COMPLETE fill; partial fills never satisfy MINED/CONFIRMED gates. Live-vs-backtest status semantics differ; strategies must not gate on MINED for backtest behavior. [code BacktestExecution.ts:458-530]

## Latency

executeAt = now + delay + uniform(−jitter,+jitter), applied to placeLimit/placeBatch/cancelOrder/cancelAll. Queued actions execute on the first REAL tick with nowMs ≥ executeAtMs — in a quiet book that is later than delay+jitter, and against the book AT THE DUE TICK. **A resting order can fill while its cancel sits in the latency queue** (fill loop runs after draining due actions; cancel of a gone order is a silent no-op). Jitter uses Math.random ⇒ delay>0 runs are nondeterministic run-to-run. [code BacktestExecution.ts:200-203,644-701]

## split / merge

- split_positions: instant (no latency), mints qty on BOTH sides at costBasis 0; splitCost = size (intent.costPerShare IGNORED); charged only in stats layer.
- **merge_positions: MIS-SCORED — never emit in backtests (RULES rubric).** Portfolio decrements qty but credits NO $1/pair anywhere and does not reduce costBasis (partial merge leaves stale full basis; full merge deletes basis+position). computeMarketStats has no merges input ⇒ the $1/pair proceeds vanish from pnl. Settlement already values min(up,down) at $1/pair — leave pairs unmerged. Clamp-to-zero merge returns NO event (no merge_failed feedback). [code src/trading/Portfolio.ts:366-395; BacktestExecution.ts:263-287; marketStats.ts:141]

## Constraints active in backtests

- OrderManager dryRun=false, intentExecutionMode='immediate' (intents go straight to the adapter).
- **Risk limits HARDCODED and active**: maxOpenOrders 20, maxOrderSize 2000, maxAbsPosition 2000, maxLossStop −500 (blocks new places once realizedPnl ≤ −500; cancels/merge/split always pass). A both-sides accumulator hits maxAbsPosition at 2000 shares/side and maxOpenOrders at 20 resting orders — design variants inside these walls or file a proposal when they bind. [code src/trading/riskLimits.ts:24-29; src/backtest/runSingleMarket.ts:146-150]
- **No cash model**: nothing constrains buying power; INITIAL_CAPITAL is reporting-only. Capital discipline must live in strategy params (per-market stake cap) — this is also why EV-at-capital-levels must be swept, not derived.
- GTD min expiry: now + 60s (OrderManager rejects sooner).
- Cascade guard: StrategyRunner drops account events past maxEventsPerDrain silently (log only). cancel_all ignores any assetId scoping — cancels ALL resting sim orders.
- Fill harvest cap: portfolio.recentFills capped at 500 — >500 fills per market within one tick's cascade would silently drop oldest from stats.
- Per-market isolation: fresh Strategy/Runner/OrderManager/Execution/Portfolio per market; nothing leaks across markets.

## Open questions

- place_batch ≤15 enforcement unverified. FOK vs real CLOB hidden-liquidity semantics unknown (visible-depth only here).
