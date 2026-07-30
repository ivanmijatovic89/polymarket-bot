# Capability: strategy system

verified: 2026-07-30 @ 4fde3ae (code-survey), RUN-VERIFIED 2026-07-30 by PLAN
`baseline-pair-strategy` (runs 861/862, strategy `pair-fable-v0`): protocol
auto-discovery, Zod param defaults land in `backtest_runs.params`,
ctx.market up/downAssetId, ctx.metrics.position, portfolio
positionsByAssetId/openOrdersByClientId reconciliation, GTD expiry +
order_done(filled|expired) event flow, meta stamping. Fill-mechanics nuance
found: a placement-time price<bestAsk check does NOT guarantee maker — book
drift across simulated latency turned 1 of 291 fills taker (run 862); judge
maker-ness by trades_taker.
watches: src/strategy, src/trading/StrategyRunner.ts

## Interface

- `Strategy = { name, onMarketTick(tick, portfolio, ctx?) → Intent[], onAccountEvent(ev, portfolio, lastMarket?, ctx?) → Intent[] }`. onMarketTick fires only on book/price_change (+ opt-in synthetic feed ticks). [code src/strategy/Strategy.ts:423-475]
- Tick snapshot per assetId: bestBid/bestAsk/mid/spread, FULL sorted levels, 10-level cumulative depth arrays. [code src/market/orderbook/types.ts:27-53]
- `ctx.market` (GammaMarketMeta) gives `upAssetId`/`downAssetId`. `ctx.metrics.position` is tailor-made for the pair strategy: `shares_mergeable=min(upQty,downQty)`, `pair_avg=up_avg+down_avg`, `total_cost`, `pnl_merge=shares_mergeable−total_cost`, `pnl_if_up_wins`, `pnl_if_down_wins`, `imbalance=upShares−downShares` — computed per tick AND per account event. [code src/trading/positionMetrics.ts:15-49]
- Intents: place_limit {clientOrderId, assetId, side, price, size, orderType FOK|GTC|GTD, expireAtMs (required for GTD, min +60s), meta?}, place_batch {orders[]} (≤15/batch per comment — enforcement unverified), cancel_order, cancel_all, split_positions, merge_positions. [code src/strategy/Strategy.ts:29-124]
- Params: repeated `--param k=v` strings → Zod z.strictObject with z.coerce + .default(); unknown keys/duplicates are hard errors; JSON params arrive as strings.
- Definition: `export const definition = { id, schema, create(params) → { strategy, plugins?|pluginSet? } }` — auto-discovered.

## Protocol discovery (our strategies)

- `protocols/pair-fable/strategies/**` auto-discovered FAIL-SOFT: broken file / wrong prefix ⇒ warn + skip ⇒ symptom is "unknown strategy id" at run time. Ids MUST start `pair-fable-`. Core src/strategies ids win collisions. **Always run `npm run protocol:check -- pair-fable` before pushing** (scoped tsc --noEmit + eslint; exit 0 if no strategies yet). [code src/strategy/protocolStrategyDiscovery.ts:78-197; scripts/protocol-check.mts]
- `instanceof` on plugin classes FAILS across the registry's CJS-require/ESM boundary — detect structurally (isExternalFeedsRequestPlugin pattern); `handlesSyntheticTicks` is a data property for the same reason.

## Closest existing strategies to ours (reuse material)

1. `buyBothSidesAndMerge.v1` — the ONLY strategy emitting merge_positions. One-shot FOK both sides at ask+bump when either bestAsk ≤ trigger, merge gated on trade status. NOT incremental, no fee-inclusive pair check. Its merge gate `MINED` passes in backtests only after FULL fill (backtests emit MATCHED→CONFIRMED, never MINED). [code src/strategies/buyBothSidesAndMerge.v1.ts]
2. `spread-capture` research family — the INVERSE (split then maker-SELL both legs); its FAMILY.md lists "bid-side mirror (buy-and-merge): rest maker BUY bids below mid on both legs" as an UNTRIED variation — closest documented idea to our target. Reusable: symmetric maker resting, reprice-on-drift, cancel near expiry, hold to resolution. [code src/strategies/research/spread-capture/000-baseline.ts; FAMILY.md:150-151]
3. `SplitSellRedeem` v1-v6 family — pair arithmetic via split+sell (we do the inverse); v5 shows plugin composition (TimeWindowGate 240-600s, DwellGate, ExternalFeedsRequestPlugin declaration pattern). [code src/strategies/split/SplitSellRedeem.v5.ts:47-66]
- **`buyBoth.v1` is NOT a buy-both strategy** — logging probe, always returns [].

## Fees (not a plugin — Portfolio-level)

Taker fee = size × 0.07 × p × (1−p) USDC (700 bps hardcoded), zero at p≤0/p≥1, min 0.0001; applied ONLY to fills with liquidity='TAKER'. **Maker fills pay exactly $0.** Fee-inclusive pair price for two taker legs at pU,pD = pU+pD + 0.07·pU(1−pU) + 0.07·pD(1−pD) (~0.035/pair worst case near 0.5). Maker-accumulation variants have zero fee drag. [code src/trading/fees.ts:10-42; src/trading/Portfolio.ts:665-681]

## Plugins

Existing ids: dwellGate, timeWindowGate, timeWindowVolatility, technicalIndicators, deribitVolatilityIndex, externalFeeds. Snapshot computed once per tick, CACHED for cascading onAccountEvent (no refresh between account events). Feeds declared via `new ExternalFeedsRequestPlugin({...})` in create() — backtest fulfillment reads ONLY the plugin (legacy requiredFeeds is live-only). From the 2026-04-02 universe floor, declaring binance/priceToBeat/chainlink never shrinks the universe (RULES).
