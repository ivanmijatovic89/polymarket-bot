# ENGINE-GAPS — what the engine/backtest cannot express for this concept

From READING code/docs (charter rule: no testing). All file:line refs
verified in this worktree, 2026-07-17. Ordered by how much each gap
distorts a gabagool-style (passive two-sided accumulate → merge/redeem)
evaluation.

## G1 — Maker fills: worst_queue only, all-or-nothing, adverse-only

- `src/trading/execution/BacktestExecution.ts:31,62,90,196`: default mode
  `worst_queue` — a resting BUY fills only when `bestAsk < restingPrice`
  (price goes THROUGH the level), at the resting price, for the FULL
  remaining quantity. `touch_or_better` exists in code but
  `src/backtest/runSingleMarket.ts:133` hardcodes `worst_queue` (the fable
  lab forced touch mode via a wrapper hook; nothing in this repo's CLI
  exposes it).
- Distortion for this concept: gabagool's real fills are overwhelmingly
  at-touch/in-queue passive fills from retail taker flow; worst_queue
  grants only the adversely-selected subset (and touch mode grants
  full-size instantly — both wrong for queue economics). In-sim size
  scaling lies (full-size fills). Fable-lab measured both bounds negative
  for unconditional quoting (E16/E17/E19/E29) while live wallets print —
  measurement D2 (his actual fills vs the worst-queue rule on Telonex
  books) will quantify the fill-reality gap as one number.
- No partial fills at a level; no queue position; no market impact.

## G2 — No trade prints in replay → no queue-realistic fill model possible

- Replay streams carry only `book`/`price_change` (ENGINE.md; fable
  E-lessons verified `byType` on every run). `last_trade_price` is decoded
  live (`src/market/marketChannelDecoder.ts`) but not present in Telonex
  converted parquet.
- Telonex upstream HAS a `trades` channel (95.9% coverage on 18.6k
  markets, P37) — un-ingested; the vendor quota blocked the fable probe
  (HTTP 403). This is the single highest-value instrumentation for the
  concept (standard queue model: fill when printed volume at your price
  exceeds queue ahead).

## G3 — Taker fee model: wrong shape AND wrong rate vs the real venue

- Repo (`src/trading/fees.ts:30-49`): `fee = (bps/104) × min(p, 1−p) ×
  size`, default 156 bps; BUY fee charged in shares
  (`baseRate × priceEdge × size/price`), SELL in USDC. Piecewise-LINEAR
  in p.
- Venue (docs.polymarket.com, 2026-07-17): `fee = C × feeRate × p(1−p)`,
  QUADRATIC, crypto feeRate 0.07 now (0.0624 in Jan 2026).
- Magnitudes per share, taker BUY at p: repo 156bps vs venue now —
  p=0.5: 0.78c vs 1.75c (repo = 45%); p=0.7: 0.47c vs 1.47c (32%);
  p=0.9: 0.16c vs 0.63c (25%); p=0.97: 0.047c vs 0.204c (23%).
  The sim UNDER-charges takers 2–4×. For maker families the direct effect
  is nil (maker fills fee-free, correct), but every taker-leg variant
  (completion buys, endgame takes) is evaluated ~2-4× too cheap, and the
  fee-driven behavior of the COUNTERPARTY flow is absent entirely.
- Env knob `BACKTEST_TAKER_FEE_BPS` changes rate only, not shape.

## G4 — Maker rebates: not modeled at all, and they are the end-state edge

- No rebate/rewards code anywhere under `src/trading/` (grep `rebate|
  reward` — only redeem watcher). The venue pays makers 20% of the crypto
  taker-fee pool, fee-curve weighted, daily (VENUE-MECHANICS.md).
- Quantified distortion (tail forensics): gabagool's final 2.6 days were
  trading −$1,767 vs rebates +$1,819 — the rebate term flips the sign of
  the whole strategy. Any sim of the CURRENT meta that ignores rebates
  mis-signs the equilibrium. A post-hoc rebate estimator (20% × venue-fee
  curve × your maker volume × your share of market maker volume) can be
  bolted onto backtest stats without engine changes — but your *share* of
  the pool needs the market's total maker volume, which needs trade
  prints (G2) or an assumption.

## G5 — Pair credit & merge semantics in sim

- `src/backtest/stats/marketStats.ts:65,104,142`: `min(upShares,
  downShares)` valued at $1/pair at market end automatically. Correct for
  hold-to-end pairing, BUT a strategy that emits `merge_positions`
  mid-episode erases both legs WITHOUT the $1 credit (fable E4) — the
  exact opposite of live, where mid-window merge returns $1 immediately
  and frees capital for re-quoting (gabagool merged ~every few minutes,
  batched cross-market).
- Consequence: capital-recycling velocity — a core lever of the real
  strategy (small bankroll, high turnover) — cannot be expressed; in sim,
  capital stays locked to episode end. Also `split_positions` is
  simulated immediately/costless (fine), and redeem timing/gas is not
  modeled (live redeem latency locks capital across windows).

## G6 — Fair-value inputs: strike live-only; Binance feed unmerged; PM-tick wakeups only

- `polymarketPriceToBeat` (the strike) is live-only — replay has no
  strike; strike-distance fair value must be reformulated or the Binance
  feed used as proxy (the slug epoch gives window start; strike ≈ spot at
  window open from Binance aggTrades).
- Binance aggTrades backtest feed is implemented + live-verified on
  branch `binance-aggtrades-r2-sync` (NOT merged; PR #121/#122 per its
  docs). As-of sampling at PM ticks only (~100-180k PM ticks vs 5-21k
  trades/15m window); Binance-DRIVEN ticks are an unimplemented ADR. A
  fair-value quoter cannot reprice in quiet-book moments — exactly when
  stale quotes get picked off live.
- Merging that branch (operator decision) is a prerequisite for any
  fair-value-anchored family the lab would test.

## G7 — Account/latency semantics (minor but real)

- Backtest emits MATCHED only; MINED/CONFIRMED absent — live sell/merge
  gating on MINED is unexercised in sim (CLAUDE.md gotcha). Gabagool-style
  merge cadence live requires MINED waits the sim never rehearses.
- Queued intents: tick-N intents flush at tick N+1; latency env knobs
  exist (`BACKTEST_LATENCY_DELAY/JITTER`); ambient `.env` sets DELAY=140
  silently (fable E7) — pin explicitly in any measurement plumbing.
- Maker fills emit no `ws_order_update` in sim — gate on `fill` events
  (fable E5).

## G8 — No wallet-vs-wallet competition dynamics

- The sim replays recorded books; it cannot express "your quotes change
  the flow" (queue competition with the other 6+ active bots, rebate-pool
  dilution, taker-flow reaction). The current live meta is an equilibrium
  among ~7 wallets — any sim answer is a partial-equilibrium statement.
  Priors work, not engine work; recorded here so the BRIEF states it.

## Summary table

| gap | severity for this concept | fixable without src/ changes? |
|---|---|---|
| G1 fill model | decisive (D2 measures it) | no (operator: trades-based model) |
| G2 no trade prints | decisive (blocks G1 fix + G4 share) | no (operator: ingest channel) |
| G3 fee shape/rate | moderate (taker legs, counterparty realism) | partially (env rate only) |
| G4 rebates absent | decisive for CURRENT meta | post-hoc estimator possible |
| G5 merge credit | high (capital velocity invisible) | strategy-side workaround: never merge in sim (E4), accept locked capital |
| G6 fair-value inputs | high (blocks Game-B anchor) | operator: merge feed branch |
| G7 status/latency | low-moderate | pin envs; design around |
| G8 competition | unquantifiable in sim | no |
