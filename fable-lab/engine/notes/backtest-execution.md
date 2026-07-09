# Raw study notes — backtest execution subsystem

_Source: fresh-context Explore subagent, session 1. These are input notes for
`engine/CAPABILITIES.md`; the synthesized doc is authoritative._

Scope reviewed: `src/trading/execution/BacktestExecution.ts`, `src/trading/OrderManager.ts`, `src/trading/fees.ts`, `src/trading/riskLimits.ts`, `src/backtest/runSingleMarket.ts`, `src/backtest/marketProcessor.ts`, `src/backtest/stats/marketStats.ts`, `src/backtest/stats/marketResolution.ts`, `src/parquet/replay/replayOrderBookForMarket.ts`, `src/utils/minHeap.ts`, `src/cli/backtest.ts`, `src/trading/Portfolio.ts`, and docs under `docs/engine/` and `docs/backtest/`.

---

## 1. Fill simulation model

### Taker fills (FOK, and immediate portion of GTC/GTD)
- Computed by `buildFillsFromBook` (`BacktestExecution.ts:116-167`). It walks the opposite side of the book level-by-level, filling `min(remaining, level.size)` at each level's price. BUY consumes `book.asks` ascending, stopping when `ask.price > limitPrice` (`:150-155`); SELL consumes `book.bids` descending, stopping when `bid.price < limitPrice` (`:156-161`).
- Partial taker fills across price levels ARE modeled — one `Fill` per level consumed, each tagged `liquidity: 'TAKER'` (`:142`).
- Fills carry `feeRateBps` only when `> 0` (`:143-145`).

### Maker fills (resting GTC/GTD)
- Computed by `buildMakerFillTouchCross` (`BacktestExecution.ts:50-114`), invoked once per resting order on every `onMarketTick` (`:686`).
- Default mode `worst_queue` (`:196`, forced in `runSingleMarket.ts:133`): a resting BUY at P fills only when `bestAsk < P` strictly (`:66`); resting SELL fills only when `bestBid > P` strictly (`:94`). Models last-in-queue / price must trade *through* the level.
- Alternative `touch_or_better`: fills when `bestAsk <= P` / `bestBid >= P` (`:62-63`, `:90-91`). **`runSingleMarket.ts:133` hardcodes `makerFillMode: 'worst_queue'`** — no CLI/env flag selects `touch_or_better` in the actual backtest runner. Only reachable by directly constructing `BacktestExecution` (tests).
- Maker fills execute at the resting limit price with **no slippage** (`:78-80`, `:105-107`).
- **Maker fills are always the FULL remaining size** — NO partial maker fills. `o.remaining` set to 0 in one shot (`:84`, `:112`), regardless of actual size at `bestAsk`/`bestBid`. Book's available size at the crossing level is never consulted for maker fills.
- Maker fills carry **no `feeRateBps`** (`:71-83`) — zero maker fee assumed.

### Self-trade handling
- **Not modeled at all.** Strategy's own resting orders are never inserted into the replayed book. Book is reconstructed purely from recorded WS events (`replayOrderBookForMarket.ts:101-118`).

### Explicitly NOT modeled
- Queue position (beyond binary worst_queue/touch toggle); no FIFO queue, no size-ahead tracking.
- Market impact — own orders never consume replayed-book liquidity; own taker fills don't move the book for later ticks.
- Adverse selection / information leakage.
- Partial maker fills.
- Book size at maker crossing — a resting order of any size fills fully the instant price crosses, even if only 1 share traded through.

---

## 2. Order types & operations supported in backtest

`SimOrder.orderType` is `'FOK' | 'GTC' | 'GTD'` (`BacktestExecution.ts:24`).

| Operation | Support | Notes |
|---|---|---|
| FOK | Yes | Pre-checked vs `sumFillableSize` (`:319`, `:340-363`); if `fillable < size` → immediate kill (`order_accepted → MATCHED → CANCELED → order_done(killed)`); else full fill + `CONFIRMED` (`:364-389`). |
| GTC | Yes | Immediate taker fill of available, remainder rests in `openByClientId` (`:390-415`, `:533-552`). |
| GTD | Yes | GTC + expiry check each tick (`:672-683`). `expireAtMs` required, ≥ `nowMs + 60_000ms` enforced by OrderManager (`OrderManager.ts:496-501`). |
| placeBatch | Yes | `placeBatchNow` loops orders individually (`:289-421`); NOT atomic — partial rejects possible (`OrderManager.ts:394-438`). |
| cancelOrder | Yes | Removes from `openByClientId`, emits `order_done(canceled)`. **Cancel of unknown/filled clientOrderId is a silent no-op** (`:574-578`). |
| cancelAll | Yes | Cancels all open; ignores any market/asset filter in intent (`:621`). |
| splitPositions | Yes (simulated) | Instant, no latency, always succeeds for valid inputs; mints 1 collateral per set, `splitCost = size` (`:205-261`). |
| mergePositions | Yes (simulated) | Instant; actual = `min(requested, qtyA, qtyB)` (`:263-287`). |
| Redeem intent | **Unsupported** — no redeem lifecycle in `BacktestExecution`; redemption is a terminal accounting step in stats only (§5). |

- OrderManager dedupes by `clientOrderId` (`OrderManager.ts:85, 276-277, 396-404`); reuse of active id → `duplicate_clientOrderId` reject.
- No modify/replace — cancel + re-place only. No FAK/IOC type.

---

## 3. Latency simulation

- Env parsed in `src/cli/backtest.ts:557-558`: `BACKTEST_LATENCY_DELAY` (default 0), `BACKTEST_LATENCY_JITTER` (**default 20**). Passed as `latency: {delayMs, jitterMs}` (`:757`, `:1008`).
- **Jitter only applied when delay > 0**: `runSingleMarket.ts:132` sets `jitterMs: args.latency.delayMs > 0 ? args.latency.jitterMs : 0`. Default delay=0 ⇒ jitter inert.
- `executeAtMs = max(nowMs, nowMs + latencyMs + jitter)`, jitter ∈ [−j, +j] uniform via `Math.random()` (`BacktestExecution.ts:200-203`) — the single source of engine nondeterminism.
- Delayed ops: `placeLimit`, `placeBatch`, `cancelOrder`/`cancelAll` (when `cancelLatency: true`, hardcoded true at `runSingleMarket.ts:132`) (`:423-432`, `:556-565`, `:593-635`).
- **NOT delayed:** `splitPositions`, `mergePositions` (`:205-287`); maker-fill evaluation.
- Pending queue drained at START of each `onMarketTick`, before maker-fill checks (`:644-669`), sorted by `(executeAtMs, seq)` — deterministic tie-break (`:651-653`).
- Ordering effect: cancel can arrive after a fill → no-op (`backtest-execution.md:47-49`). Latency is tick-quantized — a delayed action executes on first tick with `nowMs >= executeAtMs`; effective latency snaps to inter-event gap.

---

## 4. Fee model

- `getBacktestTakerFeeBps()` reads `BACKTEST_TAKER_FEE_BPS`, default **156 bps** hardcoded (`fees.ts:14-22`).
- `computePolymarketTakerFee` (`fees.ts:30-49`): `baseRate = feeRateBps/10_000`, `priceEdge = min(price, 1−price)`.
  - SELL: `feeQuote = baseRate * priceEdge * size` (collateral).
  - BUY: `feeBase = baseRate * priceEdge * (size/price)` (shares).
  - `MIN_FEE = 0.0001`; below that rounds to 0 (`fees.ts:13, 24-28`).
- Fee applied **only to TAKER fills** with `feeRateBps > 0` (`Portfolio.ts:667`; `marketStats.ts:126`). Maker fills: zero fee.
- Portfolio reduces net proceeds/net size per fill (`Portfolio.ts:665-715`); stats separately tally `feesPaid = feeQuote + feeBase*price` for reporting (`marketStats.ts:126-135`).
- **Fidelity caveat:** modeled approximation — 156 bps + `min(p,1−p)` shape + maker=0 are hardcoded assumptions, not live per-market schedules. No gas/blockchain cost modeled for split/merge/redeem.

---

## 5. Episode boundaries, settlement, unresolved markets

- **Per-episode isolation:** each 15m market gets fresh `Strategy + StrategyRunner + OrderManager + BacktestExecution` via `buildRunnerForMarket` (`runSingleMarket.ts:110-151`). No state shared across markets (`running-backtests.md:9-13`).
- Whole parquet file replayed start-to-finish (`runSingleMarket.ts:295-302`). Market auto-detected from first decoded event; other markets' events dropped (`replayOrderBookForMarket.ts:106-118`). **No explicit 15m clock boundary** — episode ends when rows are exhausted.
- **Settlement is end-of-episode arithmetic only**, in `computeMarketStats` using externally fetched `marketResolution.outcome` (`marketStats.ts:141-169`):
  - Mergable pairs `min(upShares, downShares)` at $1/pair (`:105, 143`).
  - Winning shares redeemed at $1, losing at $0 (`:146-157`).
  - `pnl = realizedPnl + mergeValue + redeemValue − remainingCostBasis − splitCost` (`:169`).
- **Unresolved markets:** `marketStats: null` + `skipReason` when slug unparseable (`:187-197`), resolution missing (`:305-315`), or `outcome === null` (`:316-326`). Contribute NO PnL — silently dropped.
- Resolution from DB/Gamma API, not replay (`marketResolution.ts:101-203`); outcome normalization is string-heuristic (`normalizeResolvedOutcome`, `:59-89`).
- Redeem lifecycle NOT simulated (no events, timing, gas). Open resting orders at episode end are not force-cancelled; remaining `costBasis` subtracted (`:164-169`), unrealized value of open orders not marked.

---

## 6. Determinism

- With `jitterMs === 0` and no strategy randomness, `runSingleMarket` deterministic (`runSingleMarket.ts:161-163`); docs claim bit-identical BullMQ-vs-sequential with `BACKTEST_LATENCY_JITTER=0` (`running-backtests.md:155-158`).
- Only engine-level nondeterminism: jitter's `Math.random()` (`BacktestExecution.ts:201`). Default run (delay=0) is deterministic.
- Event ordering (`replayOrderBookForMarket.ts:43-63`, `minHeap.ts:16-21`):
  - `--order recorded` (default): `ingest_seq`, then `ts_local`, then `fileIdx`.
  - `--order exchange_time`: intended `ts_exchange_ms` primary, BUT `MinHeap.less` compares `keySeq` first (`:18`) and both modes push `keySeq = ingest_seq` — **exchange_time may be a partial no-op**; verify before relying on it. (Docs at `running-backtests.md:136` claim it reorders.)
- Only `book`/`price_change` drive strategy ticks (`replayOrderBookForMarket.ts:110`); `tick_size_change`/`last_trade_price` update engine, no tick; others skipped without JSON parse (`:92-100`).
- `--time-driven` (`:75-82`): wall-clock sleeps only (capped 10s); no math change.
- Intent execution mode is `'immediate'` in runSingleMarket (`runSingleMarket.ts:143`) — NOTE: conflicts with ENGINE.md claim of queued next-tick execution in backtests; verify which is current.

---

## 7. Evidence-quality caveats (researcher MUST know)

1. Own orders never affect the replayed book — systematically optimistic for any size that would move a thin 15m book; maker fills full-size even if a sliver trades through.
2. Maker fill binary and full-size — overstates maker fill quantity, understates time-to-fill.
3. `touch_or_better` maker mode unreachable from CLI (`runSingleMarket.ts:133` hardcodes `worst_queue`).
4. Fees are a hardcoded model (156 bps default, `min(p,1−p)` edge, maker=0); no gas for split/merge/redeem.
5. Settlement idealized: exact $1/$0, zero cost, guaranteed, no redeem timing risk.
6. Unresolved markets silently excluded (`skipReason`) — sample bias toward resolvable markets.
7. Resolution from external DB/Gamma; stale/incorrect `resolvedOutcome` corrupts PnL.
8. Latency tick-quantized to `book`/`price_change` boundaries.
9. `MATCHED` only WS status for resting/partial orders; `MINED`/`CONFIRMED` not simulated for resting (FOK full-fill emits `CONFIRMED`, `:515-529`). MINED-gated live logic never exercises in backtest.
10. Risk limits hardcoded and active in backtest (`riskLimits.ts:24-29`: maxOpenOrders 20, maxOrderSize 2000, maxAbsPosition 2000, maxLossStop 500) — silent `order_rejected` possible; loss-stop blocks new placements but allows exits (`:84-104, 179-184`).
11. `--order exchange_time` possibly a partial no-op (§6).
12. `DRY_RUN` env has no effect on backtests (`running-backtests.md:207-209`, `runSingleMarket.ts:137`).
