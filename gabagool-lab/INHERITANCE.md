# INHERITANCE — Phase 0 distillation (session 1, 2026-07-17)

What the lab inherited, verified, and will act on. Sources: the live KB
(`../polymarket-bot-gabagool/research/gabagool/`, read at its session-4
state), fable-lab, strategy-research-protocol (SRP), repo root docs, and
my own first-hand code verification. Facts I verified myself in code are
marked **[verified-in-code]**; everything else cites its source doc.
Re-check the KB's STATE.md every session — it was near saturation
(SATURATION.md → LAB-HANDOFF.md pending) when read.

## 1. Engine facts (all verified first-hand this session)

1. **Maker fill model = `worst_queue`, hardcoded.** A resting BUY at P
   fills only when `bestAsk < P` strictly (through the level), at P, for
   the FULL remaining size, `liquidity='MAKER'`, zero fee
   (`src/trading/execution/BacktestExecution.ts:59-114`). Mode
   `touch_or_better` exists but `src/backtest/runSingleMarket.ts:134`
   hardcodes worst_queue; not CLI-exposed, and that file is outside my
   write scope. **[verified-in-code]**
   - fable E19: touch mode is NOT an upper bound (toxic full-size fills
     made it strictly worse in both regimes). Fill-model bounds are
     instrument ends, never dominance proofs.
2. **Taker path**: a marketable BUY crosses at placement via
   `buildFillsFromBook`, walking ask levels (size does consume levels
   within one order), fills carry `feeRateBps`
   (`BacktestExecution.ts:116-160,365,393`). **[verified-in-code]**
3. **Taker fee model is era-wrong in shape**: `fee = (bps/1e4) ·
   min(p,1−p) · size`, default 156 via `BACKTEST_TAKER_FEE_BPS`
   (`src/trading/fees.ts`). Real current-era fee = `0.07 · p(1−p)` per
   share (KB VENUE-MECHANICS, verified on-chain to 5 decimals). Sim
   undercharges takers 2–4× (p=0.5: 0.78c vs 1.75c). No bps value fixes
   the shape. **[verified-in-code]** → any taker-completion variant needs
   post-hoc per-fill fee correction (see §4).
4. **PnL is fee-inclusive** through position/proceeds channels: taker BUY
   fee docked in shares (`netSize = size − feeBase`), taker SELL fee in
   proceeds (`src/trading/Portfolio.ts:665-715`). `feesPaid` in
   marketStats is a diagnostic column, NOT subtracted again
   (`src/backtest/stats/marketStats.ts:126-134,169`). **[verified-in-code]**
5. **Pair payoff is scored natively**: `min(upShares, downShares) × $1 +
   winner-side redeem − remaining cost basis`
   (`marketStats.ts:104-169`). No merge intent needed — and emitting
   `merge_positions` mid-episode DESTROYS value in sim (erases legs
   without the $1 credit; fable E4). Never merge in sim.
   **[verified-in-code]**
6. **Latency**: `BACKTEST_LATENCY_DELAY` (default 0) +
   `BACKTEST_LATENCY_JITTER` (default 20, inert when delay=0)
   (`src/cli/backtest.ts:546-547`, `runSingleMarket.ts:131-132`).
   Cancels are ALSO delayed (`cancelLatency=true` default) → fill-before-
   cancel is real. Jitter uses Math.random → the only nondeterminism;
   jitter=0 → deterministic. **AMBIENT TRAP: repo `.env` sets
   `BACKTEST_LATENCY_DELAY=140`, `JITTER=0`** — every run from this repo
   is silently 140ms unless pinned (fable E7/E28 were bitten twice).
   All lab tooling pins latency explicitly per run. **[verified-in-code]**
7. **Risk limits are ACTIVE in backtest and hardcoded**
   (`src/trading/riskLimits.ts:24-29`): `maxOpenOrders 20` (global! a
   two-sided ladder gets ≤10 rungs/side), `maxOrderSize 2000`,
   `maxAbsPosition 2000` shares/asset, `maxLossStop 500` (realized only —
   never triggers for buy-only strategies since buys realize nothing).
   Breaches are SILENT `order_rejected` events — strategies must count
   rejections. **[verified-in-code]**
8. **Resolution** comes from venue records (Gamma/DB), not price-derived
   (`src/backtest/stats/marketResolution.ts`); unresolved markets are
   skipped entirely. Ties→UP is venue truth (Chainlink BTC/USD data
   stream; KB A18) and not a sim concern. **[verified-in-code]**
9. **Maker fills emit NO order-status updates** in sim — only `fill` +
   `order_done`. Gate strategy logic on `fill` events (fable E5).
   Recorded books can be self-crossed (delta artifacts) — guard before
   resting quotes (fable E6, KB P39).
10. **Per-fill data is NOT persisted.** The only strategy-authored
    channel reaching the DB is `intent_meta` (per FILLED order, deduped
    by clientOrderId) in `backtest_run_markets`
    (`marketStats.ts:171-180`). Maker fills are all-or-nothing at the
    order's own price → placement meta (price, size) reconstructs maker
    fills EXACTLY. This is the lab's per-fill channel. **[verified-in-code]**

## 2. Concept priors that shape variants (KB, measured)

- **The archetype (@gabagool22, $869k all-time)**: buy-only two-sided
  ladders, ~0.1% leg imbalance held continuously, $4 median clips,
  30–600+ fills/market, band p25–p75 = 0.31–0.63, burst cadence.
  Zero-fee era: pair cost p50 0.98 → +1.9% of turnover, 98.7% win on
  btc-15m. Fees (2026-01-06) → adapted in ~6 days via 130bp deeper
  discounts → competitive compression → rebate-farming end-state → quit
  2026-02-20 (STRATEGY-BRIEF §1, era-comparison, jan-transition).
- **The current winners are DIFFERENT**: b55f +2.31% fee-inclusive on
  btc-15m (Jul 2026, on-chain audit A16), 47% win, LOOSE parity (p50
  20–40% imbalance), deep patient ladders (offset p10 −12/−13c below
  touch, ~35% of fills), cheap-side touch rests (fill px p50 0.14),
  **~62% TAKER by notional** (mid-band completions, px p50 0.58),
  back-loaded minutes 10–13 (39.7% of fills), final minute cut.
  Post-fill mid drift ≈ 0 — no visible adverse signature (A17).
- **Completion aggressiveness is the margin knob (H6)**: same operator,
  two wallets, +2.31% vs +0.31% — the gap tracks WHERE taker completion
  happens on the fee curve (b55f crosses at px p25 0.34, further from
  the p=0.5 fee peak). Sim can rank completion policies exactly (same
  maker fills under all arms).
- **Parity is a zero-fee-era artifact, not a concept invariant** (BRIEF
  §5): today's one perfect-parity wallet is trading-negative. Sweep
  parity tolerance 0.1%→40% as a first-class knob.
- **Books are 1c-tight all window**; L1 depth 150–250 shares; "cheap
  side" is a 1–2c + depth-sweep phenomenon, never a wide spread (D5).
  Endgame: leading side ≥0.90 with <5min flips 0–6%; trailing cheap side
  is ~1–5c OVERpriced in all bands ≥0.6 — the stale cheap side is a trap
  (A20); deep-discount completion only (b55f's 0.14 rests).
- **Sizing**: clip $1–28 (p50 $4); rebate income ∝ fill count ×
  fee-weight. Min order 5 shares, tick 0.01 in [0.04,0.96] (0.001
  outside). Marketable orders need ≥1 pUSD notional [reported].
- **Who's in the pool**: btc-15m maker pool ($7.3k/day) is ~40% owned by
  one entrenched archetype-style incumbent (b27bc932, 97% of its income
  = rebates); a $1.48M/day parity-style challenger lost −$542k in 30d
  (A23). Competition is priced in bodies. The lab's target profile is
  the EDGE-wallet shape (small clips, moderate parity, deep ladders,
  cheap completion) — not the farmer shape.

## 3. Sim-interpretation doctrine (the D2 result — load-bearing)

- worst_queue admits **44–49%** of the archetype's real fills (touch
  64–68%); the missed half is the benign uninformed-arrival half. The
  **~30–45% of real fills that were taker completions** are expressible
  in sim. → **Sim EV ≈ EV of the toxic subset**: sim-negative is
  expected and NON-FATAL for the maker leg; **sim-positive is
  extraordinary evidence**; relative rankings across variants that share
  the maker-fill stream (e.g. completion policies) are trustworthy.
- fable measured pure spread-capture (symmetric, no parity, no pair
  logic) dead under both fill modes on this book (E16/E17/E19/E30).
  What was NEVER tested in sim: parity-driven pair accumulation with a
  pair-cost cap, deep ladders, time-weighting, and taker-completion
  policy — exactly the gabagool shape (KB P42 note + BRIEF §4). That
  gap is this lab's opening.
- **Rebates are exactly computable post-hoc** (A22, estimator proven
  exact — pool share cancels): `rebate = 0.20 × Σ 0.07·p(1−p)·size over
  own maker fills`, subject to a **$1/market/day minimum** (dust configs
  earn $0). btc-15m pool ≈ $7.3k/day. Trading line and subsidy line must
  be reported SEPARATELY, never silently summed (H3; program risk is
  the systemic risk).

## 4. Fee eras and the evaluation window (decisive for design)

Timeline (VENUE-MECHANICS, on-chain verified): fee-free → **2026-01-06**
15m-crypto taker fees (`0.25·p·(p(1−p))²`, peak $0.78/100sh; NO Feb
halving — press figure wrong) + 20% maker rebates → **2026-03-06** all
crypto → curve reshaped to **`0.07·p(1−p)`** (peak $1.75/100sh) between
2026-03-05 and 2026-04-01 → **2026-05-28** taker rebate tiers (3%→50%
refund by trailing volume; top-tier incumbents pay ~half fees).

Data on disk: 22,142 telonex btc-15m parquet files, **2025-10-11 →
2026-06-14** (`data/events/telonex/delta-typed/btc/15m/`); Binance
BTCUSDT aggTrades day files 2025-11-29 → 2026-07-15 contiguous. Telonex
coverage ENDS 2026-06-14 (G9) — the July meta is not replayable until
the operator resumes sync.

**Consequences** (frozen into EVALUATION.md):
- Current-era-valid evaluation window: **2026-04-01 → 2026-06-14** (fee
  shape certain; ~7,100 markets). 2026-03-06→04-01 is a
  transition band (curve changing) — usable for mechanism screens,
  flagged, never for verdicts. Pre-fee Dec is mechanism-sanity only.
- The **June 1–14 slice (~1,300 markets)** is the only replayable data
  under the post-2026-05-28 rebate-tier meta → reserve it as the
  confirmation holdout (never browsed during search).
- Taker fee correction: reconstruct per-fill economics from intent_meta
  (maker: exact; taker: intended-cross price at placement), validate the
  reconstruction against the sim's own `fees_paid` per market, then
  re-price taker fills at `0.07·p(1−p)` and report corrected EV. A
  cold-start entrant pays the FULL curve (no tier refunds) —
  evaluate at full fee; tier refunds are upside, not baseline.

## 5. Pipeline + tooling facts

- Strategy files: `src/strategies/gabagool-lab/**` auto-discovered by
  the standard registry — no injection wrapper needed (fable needed one
  only because its strategies lived outside `src/strategies/`).
- Run paths: sequential `npm run backtest -- ... --sequential` (no
  Redis); parallel via BullMQ (default) — producer enqueues per-market
  jobs on `backtest-markets`, workers (`scripts/run-worker.sh`, tracks
  the branch HEAD is on, self-updates via `git pull --ff-only`, exits 75
  to relaunch) require COMMITTED+PUSHED code. Telonex research profile:
  `--input-mode telonex-delta --read-from local-or-download-from-r2-to-local
  --symbol btc --timeframe 15m` + `--from-ms/--to-ms` windows.
- Results: MySQL via Drizzle (`src/db/`) — `backtest_runs` (submission_uid
  unique, batch_uid grouping label), **`backtest_run_segments`** (the
  evaluation source: `all|daily|weekly|monthly` rows with
  `ev_per_market_total`, `total_fees_paid`, `pnl_max_lose`,
  `pnl_avg_lose`, `streak_max_lose*`, win/played/total counts),
  **`backtest_run_markets`** (per-market `pnl`, `up_shares`,
  `down_shares`, `mergable_shares`, `cost`, `intent_meta`,
  `final_outcome`). Weekly/monthly time slices come FREE from segments.
  Pairing health (unpaired-leg inventory per market) comes FREE from
  the share columns. Read the DB directly; never depend on the :3051
  dashboard being up.
- `--extend <runId>` grows one run's coverage in place (stage climbs);
  batchUid/submissionUid split: batchUid groups (label), submissionUid
  identifies (unique). Adopt SRP's naming discipline.
- Feeds: `binanceWsSpotPrice` is replayable NOW (as-of lookup, ~110ms
  measured offset; strategy opts in via ExternalFeedsRequestPlugin;
  producer preflights day files). `polymarketPriceToBeat` and Chainlink
  are NOT landed (docs/datasets/polymarket-data/price-feeds-for-backtests.md
  — Chainlink pending Telonex `crypto_prices` subscription; strike =
  separate future task). H4 fair-value variants: strike proxy =
  window-open Binance spot; Chainlink-basis caveat applies near the
  boundary (A18).

## 6. What I take from the quarries (decided)

From SRP (steal): Zod-schema'd memory with cross-field invariants;
frozen hypothesis+successCriteria at first submission; verdicts quote
criteria verbatim with measured numbers; append-only logs; measured
costs from `backtest_run_segments` (no invented cost constants — with
the ONE lab exception: the era-correct taker fee re-pricing in §4, which
is an on-chain-verified formula, not an invented constant); mechanical
naming (experiment ids `NNN-slug`, registry ids derived, batchUid
suffixes `--smoke/--pN-<param>/--refine/--rN`); code-freeze after first
evidence run; batchUid/submissionUid split. REDESIGNED: the scalar
`netEvPerMarket > 0` gate → multi-criteria score vector (EVALUATION.md);
the family/dedup/ProposeFamily layer (one concept, one lineage);
minExperiments-20 stopping rule.

From fable-lab (steal): EXP-006 strategy skeleton (crossed-book guard,
fill-event quote clearing, monotonic-deque windows, deterministic
clientOrderIds, per-market state reset); results/parity/detach tool
patterns; two-disjoint-sample screening (E31); seeded one-shot
confirmation draws (E32: max-of-40 selection inflated t by >4 units,
+3.25 → −0.98 — the measured winner's curse); minority-outcome-count
precision rule (E14: want ≥30 minority outcomes before trusting a
skewed-payoff number); "paste the log line" verification rule (E28);
latency-pin refusal in the submit wrapper (D51). AVOIDED: audit towers
(AUDIT-COVERAGE residue backlogs), breadth, meta-verification as a unit
source; idle-session manufacture — **when there is nothing to run, say
so in JOURNAL and stop the session.**

## 7. Trap list (mechanical, checked by tooling where possible)

1. Ambient `.env` latency 140ms — pin `BACKTEST_LATENCY_DELAY`/`_JITTER`
   on every run; record them in the ledger entry.
2. Never emit `merge_positions` in sim (E4). Hold pairs to settlement.
3. Never gate on order-status events for maker fills (E5) — use `fill`.
4. Guard crossed books before quoting (E6/P39).
5. maxOpenOrders=20 — ladder designs must fit ≤10 rungs/side; count
   `order_rejected` events in-strategy and surface via intent_meta.
6. A bid ≥ bestAsk crosses as TAKER at placement — the never-overpay
   guard must check the ask before pricing a rung.
7. In-sim size scaling lies (all-or-nothing fills) — keep clips small,
   never claim capacity from sim fills; capacity notes are priors-based.
8. `ev_per_market_played` vs `ev_per_market_total`: gate on `_total`
   (idle markets count against a maker); `_played` is diagnostic.
9. Don't dedupe by content anywhere in analysis pipelines (KB puller v1
   incident); same-second identical fills are real.
10. `--latest` leaks the newest data into screens — select screens with
    explicit `--from-ms/--to-ms`; June 1–14 is holdout, untouchable.
11. Smoke runs (`--smoke` batchUid suffix) are never evidence and never
    freeze code.
12. Idle-in-many-markets is expected for gated makers — a verdict must
    quote played-share alongside EV so "positive on 3% of markets"
    can't masquerade as coverage.

## 8. Amendments (append-only; newest last)

### A-1 (2026-07-17T06:15Z) — KB saturated, handed off, and re-tasked; A24 corrections

Source: KB LAB-HANDOFF.md + SATURATION.md + git log (session 5 Phase 2).

1. **CORRECTION to §2**: b27bc932 holds **~3–4% of the btc-15m maker
   pool, NOT ~40%** (A24 self-correction; it is multi-book). The pool
   (~$7.3k/day) is FRAGMENTED — no monopolist incumbent to displace.
   Competition risks stand (failed −$542k/30d challenger, taker-tier
   moat ≈ 2× effective fee for entrants, program discretion A21).
2. **Live existence proof of the exact concept (A24)**: b27bc932 runs a
   pair-accumulator TODAY — pair cost p50 **0.993**, leg parity 1.6%,
   no merges, **50% taker completion** — trading thin but positive,
   income mostly rebates. The target profile is validated live.
3. **Seed-1 sweep priors** (handoff, for my L2 axes): parity tolerance
   {0.1%, 2%, 10%, 20%, 40%}; completion policy {maker-only, taker-cap
   pair≤0.99, taker-cap pair≤0.97, taker-free}; ladder = touch + rungs
   −2c…−13c below touch; time-weighting {uniform, minutes 8–13 heavy};
   minute-14 cutoff always; never open-heavy (E24/A20).
4. **Seed 3 unblock note**: the handoff marks fair-value-gated-maker
   "blocked on feed merge" — stale for THIS branch: binanceWsSpotPrice
   is merged and replayable here (verified Phase 0). Strike proxy =
   window-open spot; Chainlink-basis caveat near the boundary stands.
5. **KB is alive again (Phase 2)**: operator re-tasked the sibling
   shift — "research the strategy CLASS, not just the wallet";
   VARIANT-ATLAS is its W0. Watch it as a future experiment-seed
   source; re-read its STATE.md every session (unchanged rule).

### A-2 (2026-07-17T04:35Z) — A25/A26 fold: no known blow-up casualty in class

Source: KB PRIORS.md A25–A26 (session-2 re-read).

1. **A26 REFUTES the −$542k challenger casualty story** (was cited in
   A-1.1 as a standing competition risk): the full timeline shows that
   loss was 2026 FIFA World Cup market-making (−$615k gross on
   fifwc-*), NOT crypto-updown. Its crypto-updown life was a
   dust-scale gabagool-shaped grind, near-breakeven (−$2.6k residue).
   The class now has NO known large-loss casualty on crypto-updown;
   observed downside is slow bleed (HelixEdge −$20k/30d) or margin
   compression. Evidence FOR the bounded-window continuous-underlying
   niche: blow-up risk lives in jump-driven event books.
   Consequence for the lab: tail discipline stays (my tails are my
   own risk surface — backtest-measured, TAIL_K calibration
   unchanged), but "this family blows up" is no longer a live prior.
2. **A25 (method, KB-side)**: data-api /trades is taker-only, so
   pure-maker wallets are invisible to market-wide /trades scans; the
   KB's wallet discovery must run on-chain. No direct lab impact —
   noted so I never quote /trades-derived pool shares as complete.

### A-3 (2026-07-17T04:55Z) — A27–A31 fold: the deep-pair existence proof

Source: KB PRIORS.md A27–A31 (session-3 re-read; variant atlas W0 in
progress on the KB side).

1. **A30 — the strongest post-fee existence proof yet, and it names a
   region my sweeps under-weighted.** 0x04b6d7e9 (born 2026-03-25,
   post-fees post-reshape) is the ONLY known trading-profitable parity
   wallet at scale today: BUY-only, maker share 0.88–1.00, pairRate
   0.78 at pair cost **0.964–0.976** (deep pairs, patient completion),
   clips ~$5, zero merges, last-30d ≈ +$1.0k/day trading (+0.30% of
   turnover) + $1.75k/day rebates (~64% subsidy). Consequence: add a
   **deep-pair cell** to the campaign axes — pairCostCap ∈ ~{0.96,
   0.97, 0.98} with patient completion, i.e. quote so deep that a
   completed pair locks ≥2.4c, and accept lower fill counts. My E002
   baseline caps at 0.99; the one wallet printing on trading alone
   lives 2–3c deeper. (LEDGER backlog amended.)
2. **A28 — rebate curve favors cheap-side ~2×.** rebate ≈ 1.4%·(1−p)
   per $1 maker notional (20% of the venue's 7%·p(1−p) taker take, both
   sides of p): balanced two-sided ≈ 0.7%, cheap-side p≈0.1 ≈ 1.3%.
   The $1/day/market payout floor ⇒ viability step ≈ $143 (balanced) /
   $75 (cheap-side) maker notional per market. Also: the sim REB line
   under-counts touch-heavy policies ~2× (D2 — worst_queue drops the
   benign half of fills). Matters for candidate-grade sizing
   (EVALUATION §2's ≥$150) and for E009's economics.
3. **A27 + A31 — exit style is a hot-swappable module, class-wide
   (n=3 wallets toggled merge on/off without touching entries).** In
   sim, merge-vs-hold changes only capital efficiency (both realize
   $1/pair; sim scores hold natively). Low-priority axis; capital
   metrics already capture most of it.
4. **A31 (history)**: the class predates gabagool22 (0x818f214c from
   2025-10-12, +$386k, 93% trading, quit at peak 2026-04-11 — second
   observed walk-away-at-scale). Archetype ≠ originator; no prior
   change beyond framing.
5. **A29 (method, KB-side)**: 2026 fee-native exchange has a different
   OrderFilled layout; KB scanner fixed. No lab impact.

### A-4 (2026-07-17T05:12Z) — A26/A32/A33 fold: cold-start economics + tail reassurance

Source: KB PRIORS.md A26, A32, A33 + measurements/cold-start-economics.md
(session-3 re-read #2; KB session 7 active in parallel).

1. **A32 — the lab's cold-start status does NOT handicap maker-only or
   deep-pair cells.** Post-2026-05-28 tier system refunds taker fees by
   tier (cold-start tier-0 = 3% refund; incumbents ~50%). Maker fills
   earn the same rebate at any tier (A28), so: maker-pure cold-starts
   win TODAY at scale (0x13e0d447, born May-29, ≈+$121k in 5 weeks,
   pair 0.89@0.984; ohio-house born Jul-10, deep pairs 0.95@0.968,
   +$6k wk 1); taker-heavy cold-starts bleed (HelixEdge −$20k/mo);
   maker-pure WITHOUT pair discipline = adverse-selection bleed wrapped
   in a fragile subsidy loop (0x76d4d470: −$98k trading, +$137k
   rebates). Lab consequences: (a) E003 axis-1 (maker-only) and the A30
   deep-pair cell are the transfer-relevant regions — tier-immune;
   (b) EVALUATION's TRADE_corr "full curve, no refunds" assumption for
   taker legs is *validated to within 3%* by the tier-0 refund — keep
   it, it is conservative in the right direction; (c) E004
   (taker-completion axis) verdicts must state they price the
   cold-start (tier-0) fee, not incumbent tiers — incumbents' observed
   taker-completion economics are ~1.5–3.5%-of-taker-notional better
   than what a newcomer gets.
2. **A26 — "losing big is a live outcome of this family" is WITHDRAWN
   (KB refuted its own A23).** The −$542k challenger loss was World Cup
   sports-MM, not crypto-updown; its crypto-updown life was
   near-breakeven dust. Class-wide observed downside = slow bleed, not
   blow-up. Lab consequence: my tail gates (G7) still guard the
   *mechanical* left tail (worst_queue adverse subset realizes leg
   risk), but the empirical prior that this family blows up is gone —
   do not cite it in verdicts.
3. **A33 — third deep-pair existence proof, plus regime-drift as a
   career pattern.** vidarx (+$660k all-time): cheap-side (Dec) → deep
   parity-edge 0.84–0.86 @ 0.95–0.976 through the fee shocks → farmer →
   wind-down. Deep-pair region now has n=3 independent wallets printing
   through fee eras (0x04b6d7e9, ohio-house, vidarx) — the E005
   deep-pair cell (pairCostCap {0.96,0.97,0.98}) is the best-evidenced
   region in the whole variant space. Also: profitable operators DRIFT
   regimes rather than tune one — supports the charter's per-period
   stability requirement (a variant that only pays in one regime is a
   regime bet, not an edge).

### A-5 (2026-07-17T05:52Z) — W2/W7 measurement fold: capital anchor + terrain decline (context, no new axes)

Source: KB wallets/b27bc932.md §per-market capital curve (W2),
measurements/terrain-books.md (W7). KB assumption register still tops
at A33 — these are measurement docs, folded as context.

1. **W7 — btc-15m is the margin book inside a ~9× flow decline.**
   Sampled day totals: $3.18M/day (2026-01-15 peak) → $347k/day
   (2026-07-15); class share of book flow rising 23%→37%. Lab
   consequences: (a) the final dossier's capacity notes must be
   terrain-cited — a v1 bot at $20–50k/day turnover is 6–14% of
   TODAY'S book; (b) month-over-month EL trends in E-series verdicts
   must be read against venue-wide flow decline before claiming
   strategy decay (regime attribution, charter eval-req #1); (c)
   "expand to alt-15m" is not a capacity escape (eth-15m ~$96k/day
   sampled; sol/xrp 15m dead since Feb); btc-5m is the only real
   expansion terrain and is fee-inclusive NEGATIVE for every audited
   wallet — out of scope unless the operator widens it.
2. **W2 — capital-efficiency anchor from the strongest live wallet.**
   b27bc932, June (pre-merge-module): btc-15m BUY outlay per market
   p50 $896 / p90 $1.67k; the ENTIRE btc-15m sleeve runs on ~$4–8k
   working capital (one active window + ~4 windows awaiting
   redemption); outlay tilts late in the window (deciles 7–9 heavy,
   final decile cut). Lab consequences: (a) capital-efficiency
   comparisons in champion scoring get a live anchor (~$0.9k/market
   p50 at the strongest wallet — quote EL per peak-$ against it);
   (b) my sizing prior ($150–500/market) sits comfortably inside
   observed practice — capital is not the entry barrier (W2's own
   conclusion); (c) late-window outlay tilt is one more independent
   signal for the E006 timing axis (A17/A24 already point there).

### A-6 (2026-07-17T14:09Z) — KB fold A34–A39: the joint (offset × requote) axis + independent confirmation of the LS-11 remainder mechanism

Source: KB PRIORS.md amendments A34–A39 (register now tops at A39),
measurements/{deep-dive-04b6d7e9-btc15m,session-split-b27bc932,
fill-density-btc15m,edge-source-btc15m}.md. Folded s16 u53, AFTER the
E006 judgment and BEFORE the E008 draft — these amendments materially
shape E008.

1. **A34 + A37 — (offset × requote speed) is a JOINT axis with two
   living optima; the middle is dominated.** 0x04b6d7e9 is a
   touch-hugging ladder (offsets p10 −2c) with seconds-scale requote
   cadence whose deep pair costs come from TIMING dips, not resting
   depth — a second road to sub-$1 pairs. Density measurement (A37,
   worst_queue rule): fast requoting helps at the touch but HURTS at
   depth (−2c: 26 fills at 1s vs 45 at 5s; −5c: 4 vs 18 at 15s) —
   deep rungs want patient standing orders; fast+shallow (A34) and
   slow+deep (A17/b55f) are the two optima. Lab consequences: (a) my
   chassis (rungOffsets [0.02, 0.13], ONE shared requoteDelta)
   straddles this joint axis — E006 tested a shared delta and found
   0.02 best; A37 predicts the two rungs want DIFFERENT requote
   policies (fast touch rung, patient deep rung). Per-rung requote
   policy is now a mechanistically-seeded variant (needs a small
   strategy-code change — schema addition, backlog as E006b unless
   E008 subsumes it); (b) A37's "deep rungs are rare-event
   harvesters (~5 fills/mkt at −5c) whose value must be per-fill
   price, not volume" independently matches my battery's lat0
   finding (sparse organic deep fills, cheap: S 0.80–0.82).
2. **A36 + A39 — the informed excess leg is the class edge
   signature; wallet forensics independently confirms LS-11.** The
   living winners' unpaired lean tracks the eventual winner (excess
   leg won 60% for 04b6d7e9 by CHOICE, 67–81% for b27bc932 by
   session), and the two shallow wallets separate ONLY on post-fill
   drift (+0.9c@60s vs −0.4c) — fill SELECTION, not ladder shape,
   is what pays. My E006 settlement decomp found the same object
   from the sim side: the winner-remainder payload ($2.2–2.4/mkt at
   ref) is what price-chasing requotes buy, and killing it kills
   the cell. Lab consequences: (a) E008's design target is
   confirmed from two independent directions — preserve
   winner-tracking while cutting the cross/churn cost; the axis is
   HOW quotes track the mover, not whether; (b) post-fill drift per
   fill class (KB METRICS has the recipe) is adoptable as a sweep
   diagnostic from intent_meta fill data — tool backlog, dossier
   grade; (c) A36 session split (parity grind wins off-hours,
   shallow-fast wins US session) → session stratification joins
   weekly slices as a dossier-grade reporting dimension (charter
   eval-req #1 alignment; cheap addition to results.ts, backlog).
3. **A35 + A38 — data and terrain caveats.** (a) A38 DATA FLAG:
   13/48 Jan-15 Telonex parquets are near-empty stubs — any future
   run extending into January must filter by event count or it will
   silently under-fill (my current halves Apr/May are clean); (b)
   no monotone Jan→Jun fill-density decay — vol dominates calendar;
   cite in monthly-trend attribution alongside W7's flow decline;
   (c) A35: the strongest living variant earns entirely in ~7h/day
   × 5d/wk — fills are the binding resource, not uptime; capacity
   notes context.

### A-7 (2026-07-17T14:33Z) — KB fold A40–A43: dip closure + winner genealogy (context; no new axes)

Source: KB STATE session-8 summary (register now tops at A43),
folded s17 u59 while E008 drained — blind-safe (no arm data read).

1. **A40 — dip harvesting is CLOSED as a variant family.** Current-era
   order-book dips are sub-second flickers (~$2.5/mkt of taker-taker
   arb dust); January's standing discounts have been repriced away.
   Lab consequence: no "buy the flicker" variant is worth seeding —
   it would be latency-dependent (charter-barred) and the KB now
   shows the prize is dust anyway. Passive capture (standing rungs,
   which is what this lab already does) is the only way that flow
   is reachable. Cheap closure of a whole idea family.
2. **A41–A43 — winner genealogy: the addressable edge compresses.**
   Full history now mapped: PurpleThunder $854k (#2 all-time),
   January pool harvesters $381k + $383k, guh123 33-day sprint at
   $6.5k/day. Per-operator daily ceiling compressed ~5× over 8
   months ($14k → $2.75k/day); quit-at-peak n=8 with NO winner ever
   bleeding out; fee shocks open brief rich windows before the pool
   re-equilibrates. Lab consequences: (a) capacity notes in any L3
   dossier must cite the CURRENT ceiling (~$2.75k/day/operator), not
   historical peaks; (b) "fee schedule changes" is now
   evidence-backed retryOnlyIf material — every fee shock in the
   genealogy created a short window of outsized returns; (c) the
   quit-at-peak pattern suggests winners exit when their recipe's
   regime ends, not when capital is lost — consistent with my
   time-sliced evaluation requirement (decay must be visible).
3. **KB's new OQ #1 is adjacent to my E008 axis.** Their top open
   question — what book-state predicts the favorable-drift fills —
   is the forensic mirror of E008's design target (external spot as
   the fill-selection signal). If they find a book-state predictor,
   it becomes a candidate gate input on this branch; re-check their
   measurements/ next session.
4. Housekeeping: KB session-8 journal stamps drifted +1h again (git
   times are ground truth there too) — same failure mode as my
   stamp rule; keep pasting `date -u`.
