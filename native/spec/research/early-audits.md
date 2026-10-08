# Early audits (2026-10-08)

Condensed results of three audits run before the spec work. Paths are
relative to the repository root.

## A. Polymarket docs vs engine (gap table)

| # | Polymarket now | Engine now | Impact |
|---|---|---|---|
| 1 | Order types GTC/GTD (limit), FOK/FAK (market). Post-only only on GTC/GTD, rejected if crossing. docs.polymarket.com/trading/place-orders | FOK/GTC/GTD only, no FAK (`src/strategy/Strategy.ts:13`). Post-only correct. | Add FAK. |
| 2 | GTD expires 60 s **before** the stated expiration; expiration must be ≥ 3 min ahead. | Min offset 60 s (`OrderManager.ts:189,770`); backtest expires exactly at `expireAtMs`. | GTDs live 60 s too long in backtest; sub-3-min GTDs accepted. |
| 3 | V2: GTC/GTD BUY targets shares; FOK/FAK BUY targets collateral; fee added on top. | FOK BUY fills exactly `size` shares. | Wrong position size live. |
| 4 | `fee = shares × rate × p(1−p)` (crypto rate 0.07, makers 0), rounded to 5 dp, min 0.00001; per-market `feeSchedule` authoritative (BTC 15m today `{exponent:1, rate:0.07, takerOnly:true}`). No 15m crypto fees before 2026-01-05; Jan 5 – ~Mar 30 2026 curve rate 0.25 exponent 2 (third-party report). | Formula OK but 4 dp / min 0.0001 (`src/trading/fees.ts:18-24`), **hardcoded 700 bps**, ignores `feeSchedule` (Recorder V4 already captures it). | Overcharges ~2.2× in Jan–Mar; charges fees before Jan 5. |
| 5 | Maker rebates 20% of crypto taker fees; taker rebate tiers since 2026-05-28. | Ignored. | Accounting stat later. |
| 6 | **Taker delay**: marketable orders on crypto up/down held 150 ms since 2026-09-04 (50 ms from 08-17; 250 ms before); not cancellable during the delay; re-checked then match or rest; status `delayed`. | Not modeled. | Missing adverse selection on every taker order. |
| 7 | Tick table (0.01 tick → 2 dp price/size, 4 dp amount); off-tick prices rejected; `min_order_size` 5 on BTC 15m; price in [tick, 1−tick]; fills `floor(fill×takerAmt/makerAmt)` in 1e6 units. | Only price>0, size>0 checked (`OrderManager.ts:760-761`); floats everywhere. | Accepts orders live would reject. |
| 8 | Market WS: `book`, `price_change` (best_bid/best_ask/hash), `last_trade_price` (fee_rate_bps, tx hash), `tick_size_change`; with `custom_feature_enabled`: `best_bid_ask`, `new_market`, `market_resolved`; text `PING` every 10 s. | Decodes first four, ticks only on book/price_change; trade prints never reach strategy/simulator; live subscription lacks the flag; protocol pings every 2 s. | Trade prints are needed for a queue model. |
| 9 | Marketable = at/through best; taker gets price improvement; partial fills; self-trade prevention undocumented. | Taker sweep correct; **book never depleted**; maker fills full size on trade-through; own orders not in book. | High. |
| 10 | User WS order statuses LIVE/MATCHED/DELAYED/UNMATCHED/CANCELED; trade statuses incl. RETRYING and FAILED (final). | FAILED/RETRYING rank 0 and dropped (`userWsAccountSource.ts:243-245`) → phantom fills with MATCHED; maker fills lost when owner id unknown (`:287` after `:281`); taker fill uses top-level price. | High (live). |
| 11 | `POST /v1/heartbeats` every 5 s; no heartbeat for 10 s cancels all orders. | Not used. | Live safety. |
| 12 | HTTP 425 + Retry-After, 2-min post-only mode (503), cancel-only, trading disabled; batch results may be `success:true` with `errorMsg`. | Generic reject; batch checks only `success===false`. | Live. |
| 13 | Batch 1–15; cancel batch 1,000–3,000 ids (docs conflict); POST /order 500/s burst, 200/s sustained. | No client-side limiter. | Low. |
| 14 | **CLOB V2 since 2026-04-28**: V1-signed orders unsupported; order struct drops nonce/feeRateBps/taker, adds timestamp/metadata/builder; pUSD collateral; fees set at match time. Protocol V2 adds ExchangeV3 / PositionManager / `positionIds` for `version:"v2"` markets (BTC 15m still v1). | clob-client 5.8.1 signs V1 (issue #249) → **TS live is broken**. | Blocking for live. |

Also: FAK/FOK responses return `tradeIDs` since Jul 24; RTDS is legacy, PolyBolt WS replaced it on Sep 15; 5m/15m resolve on a Chainlink TWAP (5m window 30 s → 60 s on Aug 14). Unverified (third-party): taker-delay history before Aug 2026, Jan–Mar fee curve.

## B. Backtest vs live execution

Backtest model (`src/trading/execution/BacktestExecution.ts`, "BE"):
- Taker: walks levels to limit, partial fill per level as TAKER at 700 bps (BE:139-190, 236). **Book never mutated**: next tick sees full liquidity again; same-tick cascading orders can consume the same liquidity twice.
- FOK: insufficient depth → CANCELED + `order_done('killed')` (BE:395-418). GTC/GTD: take what crosses, rest remainder.
- Post-only: reject when crossing, checked at execution time (BE:37-54).
- Maker (worst-queue, fixed at `runSingleMarket.ts:189`): BUY@P fills only when bestAsk < P (SELL: bestBid > P); whole remaining size at P, fee 0; no partials, no volume cap.
- **Bug**: a crossing GTC larger than depth rests its remainder at P; the unchanged book still shows asks below P, so the remainder fills in full at P with zero fee on the next real tick (same tick with latency on).
- Latency: execute time = now + delay + uniform(−jitter, +jitter), unseeded `Math.random`; placements and cancels share it; queued actions run on the first real tick with ts ≥ execute time, against the book after that tick's event (one-event look-ahead). Default delay 0 (jitter forced 0).
- No tick/min-size/batch validation; synthetic statuses (MATCHED at placement, CONFIRMED only for FOK, never MINED); unknown cancel silently ignored; GTD expiry reason `'expired'`.

Live (`LiveExecution.ts`, `userWsAccountSource.ts`): sign + postOrder → `order_accepted`; errors → `order_rejected`, no retry/429 handling; batch >15 rejected whole; warmup pre-fetches tick/negRisk/fee. Lifecycle from user WS (PLACEMENT/UPDATE/CANCELLATION); GTD expiry arrives as `'canceled'`. Fills emitted once per trade id at `USER_WS_FILL_AT_STATUS` (default MINED, seconds after match). Cancels: only confirmed ids → `order_done`, others → `cancel_failed`. Dry-run: accepted + opened, never filled.

Measured latency (`docs/other/MeasureLatency.md:68-93`, 20 cycles, intent → portfolio change): place avg 116 ms (71–379), cancel avg 91 ms (65–210), right-skewed. Docs suggest 140/30 ms; protocols use 140/20. MATCHED→MINED never measured.

Gaps ranked by PnL impact: (1) maker fills ignore size and queue (E-025 in `protocols/pair-fable/memory/experiments/hf-fill-probe.md:200-260`: worst-queue filled 944 shares/market vs ≤610 possible even at queue front; 99.1% of best-level size reductions are cancels; latency raised worst-queue fills 3.8× via stale-quote pick-off); (2) free remainder fill; (3) no depletion; (4) latency fidelity; (5) fill reporting timing / FAILED; (6) own orders not in strategy-visible book; (7) exchange rules.

Data: telonex-delta = diffed `book_snapshot_full`, full book every 500 ticks, **no trades** (`deltaTyped.ts`); Telonex sells `trades` / `onchain_fills` channels (not ingested). Recorder V4 records `last_trade_price` with price, size, taker side, fee_rate_bps, tx hash, plus receive order/time. Queue-position modeling is feasible on V4 now; on Telonex only after ingesting trades.

Recommended Rust execution design: `trait FillModel` (WorstQueueCompat, QueuePosition à la hftbacktest), `LiquidityLedger`, `LatencyModel` (separate place/cancel/ack/fill-report samplers, seeded per market; constant/uniform/empirical/lognormal), discrete-event scheduler (exact time; `next_tick` compat mode), `ExchangeRules`, `ReportModel` (MATCHED/MINED delays, optional FAILED rate); calibrate against live dry-run + small real orders.

## C. Codex prototype evidence (reusable facts)

Location (read-only): `/Users/mijat/.codex/worktrees/rust-backtest-benchmark/polymarket-bot/experiments/rust-backtest/` (REPORT-END-TO-END.md, SHARED-PARAMETER-REPLAY-CONTINUATION.md).
- End-to-end, 1,000 June BTC 15m markets, lagsnipe.v15, 8 worker processes, real Redis/MySQL, one Rust process per market: TS 617 s vs Rust 99.6 s = **6.19×**. Aggregation + MySQL + cleanup ≈ 0.8 s in both.
- Shared candidate replay (one market, Rust): 1 → 0.97×, 10 → 3.18×, 100 → 3.98× vs sequential standalone runs; 100 candidates peak RSS 34.6 MiB.
- Profile of one market: ~50.6% Parquet row reconstruction, 16.1% decoding/validation, 8.7% book updates/snapshots, 3.6% feed loading.
- Arrow storage conversion rejected (1.34× faster replay, 25× larger files).
- The Codex goal afterwards drifted into emulating JS/Node semantics (Number, structuredClone, RegExp) — the failure mode this spec must prevent.

## D. Rust WIP on branch `rust-engine` (commit fef5f199, does not compile)

Verdict of the approach audit: salvage the leaves, rewrite the stateful core.
- Keep (after review/fixes): `pmb-core/src/fixed.rs`, `market.rs` book semantics + tests, `rules.rs` fee-curve math (taker delay table is wrong: 0 everywhere; must be dated 250/50/150 ms keyed by exchange time), plugin math under `pmb-core/src/plugins/` (golden-tested equal to TS), `pmb-replay/src/{pq.rs, telonex.rs, slug.rs, feeds/binance.rs}`, job contract structs, TS-side native artifact code (`src/strategy/artifacts/native.ts`, worker/producer branches), parity harness (`scripts/parity/`, `src/cli/parity/`, `src/backtest/parity/`, TS exerciser).
- Rewrite: `order_manager.rs`, `portfolio.rs`, `stats.rs` (method-by-method transliterations of the TS async design, incl. two ledgers and the TS PnL quirks).
