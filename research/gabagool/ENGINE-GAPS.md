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
  mis-signs the equilibrium. ~~A post-hoc estimator needs a pool-share
  assumption~~ **RESOLVED (A22): the estimator is EXACT — the official
  formula is per-market pro-rata by fee-equivalent with pool = 20% of
  the same fee measure, so the share cancels: rebate = 0.20 ×
  Σ 0.07·p(1−p)·size over own sim maker fills.** One-line post-hoc
  stats addition; no trade prints, no engine change, no assumption
  beyond pro-rata-as-documented. Only nuance: $1/day/market minimum
  payout threshold (min-size configs earn literally $0). Measured
  scale: btc-15m pool ≈ $7.3k/day (Jul 15;
  measurements/rebate-pool-btc15m.md).

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

## G9 — Dataset currency: Telonex coverage ends 2026-06-14

- Not an engine gap but a dataset gap the lab must know: the Telonex
  sync/conversion pipeline last ran through **2026-06-14 09:30Z**
  (verified via listEligibleTelonexMarkets, latest, session 3). The
  July-2026 meta (A16 fee-inclusive numbers, current wallets) cannot be
  replayed until the operator resumes the sync. June 2026 is the newest
  era-consistent replayable slice (post 2026-05-28 taker rebates,
  current fee formula) — use Jun 1–14 for any current-era backtest.

## G10 — Telonex January stub files (silent under-fill risk)

On the sampled day 2026-01-15, 13 of 48 delta-typed converted parquets
are near-empty stubs (~20 KB vs ~2 MB normal; discovered in A38, they
produced zero-fill markets until filtered). Mar-16 / May-13 / Jun-10
samples have zero stubs, so this initially looked January-specific.
**A58 correction (session 11): NOT January-specific** — all 24
Jun-13 00–06Z btc-15m conversions are ~16KB stubs (a full overnight
session missing at the recording layer), while the same day's
20–24Z files are normal ~2MB. Unit 8 extends: Jun-14 00–06Z is ALSO
48/48 stubs while Jun-13 US/evening and Jun-14 daytime are healthy —
the outage pattern is a weekend-overnight ops window, so WEEKEND
OVERNIGHT cells are systematically unmeasurable in June. Stub
screening by file size (<100KB
suspect) or event count is required on ANY day/session before
joining or backtesting; a cell whose post-fill drift computes as
exactly 0.0000 is the tell. Any backtest or measurement
must filter markets by event count / file size first —
otherwise passive-fill results are silently biased low and
per-market averages are contaminated by empty episodes. (The
eligibility layer `listEligibleTelonexMarkets` does NOT screen for
this; conversion rows exist and point at valid-but-empty files.)

## G11 — No btc-5m book data at all (timeframe coverage gap)

`countEligibleTelonexMarkets({symbol:'btc', timeframe:'5m',
converter:'delta-typed', readFrom:'r2'})` returns **0** for the
Jun-10–14 window (vs 423 for 15m) — the Telonex dataset carries NO
btc-5m conversions, and own WS recordings are 15m-window files. Why
it matters (raised by A57): the strongest LIVING wallet (13e0d447,
~$3.2k/day, deepest sub-$1 pair costs) and most of the current meta's
volume run on btc-5m — none of it can be book-level studied
(ladder offsets, fill-vs-touch, D2-style fill-reality checks) or
backtested. Any 5m-scope decision (W7) currently rests on
activity-API forensics only. A60 quantifies the stakes: btc-5m
carries $13.6M/day notional, $296k/day taker fees and a $59k/day
maker-rebate pool — 8.7× the lab book's subsidy pool, all on the
book with zero book data. Fix directions (for the ops side, not
this shift): extend telonex sync to 5m markets, or record live 5m WS.
