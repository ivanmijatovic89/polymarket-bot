# PRIORS — every load-bearing claim, tagged

Phase 0 output (session 1, 2026-07-17). Tags:

- **[verified]** — confirmed against primary sources available to this shift
  (repo code, engine docs cross-checked against code, or data pulls whose
  method is visible). "Verified" means *the claim as stated*; scope caveats
  are given inline.
- **[reported]** — asserted by a prior investigation/session or an external
  party; plausible, method described, but not re-checked by this shift.
- **[contested]** — sources disagree, or the claim contradicts another prior.

Sources: `INV` = `GABAGOOL-INVESTIGATION.md` (repo root, Jul 13–14 2026
sessions); `SRP` = `strategy-research-protocol/` docs; `SC` =
`src/strategies/research/spread-capture/FAMILY.md`; `EPB` =
`src/strategies/research/endgame-panic-bid/FAMILY.md`; `FL` =
`../polymarket-bot-fable/fable-lab/knowledge/LESSONS.md` (E-numbers) and
`EDGE-SPACE.md`; `CH` = `research/gabagool/CHARTER.md` operator claims.

---

## 1. The concept (pinned by charter)

- P1. Gabagool strategy = passive two-sided maker on crypto up/down binaries
  that accumulates BOTH legs over the window when each gets temporarily
  cheap, targets combined avg pair cost < $1.00, holds to resolution,
  redeems the winning leg. Unpaired inventory is THE risk. **[verified]** as
  the charter's pinned definition; **[reported]** as a description of what
  the real wallet did (INV reconstruction, §3 below).

## 2. The archetype: @gabagool22

- P2. Real Polymarket trader; 28,620 predictions, ~745k profile views;
  account now $0 — stopped OR rotated wallets, unknown which.
  **[reported]** (INV; profile-page reads, not re-pulled).
- P3. Never published anything; no official repo or verified X account; all
  public writeups are reverse-engineering. **[reported]** (INV).
- P4. Arbigab / gabagool22.com is NOT him (third party riding the name; the
  earlier "he sells the bot" claim was retracted). **[reported]** (INV,
  self-corrected).
- P5. All GitHub "gabagool bot" repos are third-party clones demanding
  `PRIVATE_KEY` — treat as wallet-drainer pattern; nothing needed from them.
  **[reported]** (INV).
- P6. Active ~Nov 2025 → Feb 2026, then stopped entirely. **[reported]**
  (CH operator claim; consistent with P2 but neither is dated by data yet —
  wallet forensics workstream C must pin the active window from fills).
- P7. Up to ~700 fills in a single 15m market. **[reported]** (CH).
- P8. ~$34k deployed per 15m market for ~$30–120 profit, win rate ~99%.
  **[reported]** (CH). Note tension with P16 (INV measured ~breakeven per
  market for the flagship *successor* on 337 markets) — different wallet,
  possibly different era; both can be true. Resolve in workstream C.

## 3. Mechanism (INV reconstruction, 337 markets / ~$272k turnover of the successor wallet)

- P9. Both-sides maker: buys UP and DOWN whenever each is temporarily cheap
  so the pair costs < $1. Pair settles at $1 → profit locked at purchase.
  **[reported]** (INV; stable across 337 markets, but analysis not re-run).
- P10. Never merges — 0 merges in all 337 markets; only redeems the winning
  leg after resolution. Corrects the public "buy YES+NO then merge" premise.
  **[reported]** (INV, self-corrected).
- P11. The one rule that separates winners from losers: combined avg
  UP+DOWN entry < $1.00 → prints (~80%+ of markets); ≥ $1.00 → loses ~90%
  of the time. **[reported]** (INV).
- P12. Per-market edge thin and often negative: net ≈ +0.07% of turnover
  across the 337-market sample. Money = thousands of repetitions across ~16
  books (4 coins × 4 timeframes). **[reported]** (INV).
- P13. NOT a latency game: median inter-fill gap 11s (mean 114s, p90 ~5min);
  deliberate accumulation over ~2h per market (1h/4h books). Edge biggest on
  the least latency-sensitive timeframes. Moat = fair-value model + patient
  entry. **[reported]** (INV; the investigation itself flipped on this).
- P14. Directional/trend risk is the loss channel: one leg fills, the other
  doesn't → naked position; buy-both-sides assumes mean reversion within the
  window; the −$500 markets come from accumulating the losing side through a
  strong move. **[reported]** (INV).

## 4. The incumbent flagship and the meta

- P15. Wallet `0xb55f…64d4`: all-time profit ~$644,736 on ~$64.3M volume;
  last 30d ~$83,786 on ~$8.9M; "yesterday" ~$5,488 on ~$930k; margin ≈ 0.9%
  of volume. **[reported]** (INV, leaderboard + data-api pulls, ~Jul 13-14
  2026; needs re-pull — is it still printing?).
- P16. Realized rate fell ~$7k/day → ~$3k/day as clones arrived; the
  "$10–11k/day" headline is a mark-to-market snapshot of the open book (1d
  and 7d leaderboard values identical), not daily income. Bottom-up 16-book
  sweep reproduced +$3,267/day vs lb-api ~$2,985/day (~10% match).
  **[reported]** (INV; method described, cross-validated two ways).
- P17. Per-leg display trap: Polymarket UI lists each leg separately, so a
  both-sides market shown as "Won +$147.93" was actually −$54 net once the
  losing leg is counted. Any UI-based PnL read of a both-sides wallet is
  systematically inflated. **[reported]** (INV) — treat as a method rule for
  workstream C.
- P18. Edge by timeframe (per-market both-legs netted daily sweeps):
  5m ≈ 0% (12k+ wallets/day, toxic); 15m ≈ 0%/slightly negative (4,050
  wallets/day); 1h +1.7–3.7% (1,585 wallets/day); 4h +2.4%+ (555
  wallets/day). Alts (SOL/XRP) highest %-edge. Leading book rotates daily.
  **[reported]** (INV).
- P19. A current large wallet trades ALL crypto symbols and timeframes with
  a simpler, more loss-tolerant version, "~$8M/day" (volume or PnL
  unclear). **[reported]** (CH; identify the wallet in workstream C —
  candidate handles are listed in the charter).

### The central tension — ledgered

- **T1.** The lab's frozen scope is **BTC 15m only** (SRP SCOPE.md
  **[verified]**), but the INV sweeps put the gabagool-style edge at ≈ 0 on
  15m and concentrated on 1h/4h + alts (P18, **[reported]**). If P18 holds,
  the lab is attacking this concept on its *thinnest* book. Priors work must
  either (a) find what distinguishes the 15m winners that do exist, or (b)
  measure whether P18 is even right (INV's sweep method netted both legs —
  re-derivable from data-api). LAB-HANDOFF must state this tension
  explicitly; scope change is the user's call, not ours.

## 5. Data access (endpoints & their limits)

- P20. `data-api /trades`: market-wide fills, price rounded (~1% noise),
  offset cap 4,000. `data-api /activity?user=<proxyWallet>`: per-wallet
  fills + REDEEM/SPLIT/MERGE with exact `usdcSize`. `CLOB /trades`: own
  trades only (auth). On-chain `OrderFilled`/subgraph: ground truth, no cap,
  both addresses. History ≥ 6 months back. **[reported]** (INV; verified
  empirically there, endpoints must be re-exercised by our scripts anyway).
- P21. No source exposes placed-then-cancelled orders — off-chain CLOB never
  records them. Order-book dynamics (aggregate per level) only via WS
  recording, forward-only. **[reported]** (INV). Consequence: level offsets
  vs mid for gabagool must be inferred from *fills* joined to *recorded
  books* (Telonex covers his active window — P36), never observed directly.

## 6. Venue mechanics (mostly UNVERIFIED — workstream B)

- P22. Taker fee on these series: the repo models 156 bps
  (`DEFAULT_BACKTEST_TAKER_FEE_BPS = 156`, `src/trading/fees.ts:14`;
  fee = bps · min(p, 1−p) · size shape per FL E3). **[verified]** as the
  repo's model; **[reported]** as the venue's actual current schedule —
  primary-source check + fee history needed (fees appeared on these series
  at some date; which?).
- P23. Maker fills carry no taker fee (live + sim). **[verified]** in sim
  (`fees.ts` applied on taker path only; SC measured ~$0.7–7.6 fees per
  1000 markets on all-maker runs); **[reported]** for live current schedule.
- P24. Liquidity/maker rewards: existence and terms for 15m crypto series
  unknown; whether two-sided quoting there earns rewards, and $/day at min
  size — open (PLAYBOOK Game E first step, never done). **[reported]**.
- P25. Tick size, min order size, rate limits: not yet collected in one
  place. GTD minimum expiry 60s enforced by OrderManager. **[verified]** for
  the GTD rule (SRP ENGINE.md + CLAUDE.md); rest open.
- P26. Resolution source/precision/timing for crypto up/down: not verified
  anywhere in the repo docs read so far (PLAYBOOK Game J "one evening
  reading resolution rules" — never done). `polymarketPriceToBeat` (strike)
  feed exists live-only. **[reported/open]**.
- P27. Endgame books trade at sub-cent ticks (EPB: measured avg standing bid
  0.9662, orders rounded to 3 decimals). **[reported]** (EPB measured on
  17k-episode extraction) — implies tick size is finer than $0.01 at least
  in some price bands; reconcile with P25 in workstream B.

## 7. Engine & backtest model (the instrument the lab will use)

- P28. Maker fill model `worst_queue`: resting BUY fills only when
  `bestAsk < restingPrice` (price goes THROUGH the level), full remaining
  size, at the resting price. `touch_or_better` optimistic mode exists in
  code. **[verified]** (`src/trading/execution/BacktestExecution.ts:31,62,90,196`).
  Consequence: the sim grants only the most adversely-selected subset of
  real passive fills, and in-sim size scaling lies (full-size fills).
- P29. Matched UP/DOWN pairs auto-credit at $1 at market end in stats
  (`mergableShares = min(upShares, downShares)`, valued $1/pair) — no merge
  needed; **merging mid-episode in a backtest erases both legs without the
  credit** (FL E4). **[verified]** (`src/backtest/stats/marketStats.ts:65,104,142`
  + FL E4). A gabagool-style backtest strategy must never emit
  `merge_positions`.
- P30. Backtests emit MATCHED only; MINED/CONFIRMED not simulated; resting
  maker fills emit no `ws_order_update` — gate on `fill` events (FL E5).
  Live: must wait for MINED before selling/merging bought shares.
  **[verified]** (SRP ENGINE.md + CLAUDE.md gotchas).
- P31. Queued intent execution in backtests: intents from tick N flush at
  tick N+1; latency env knobs exist; ambient `.env` may set
  `BACKTEST_LATENCY_DELAY=140` silently (FL E7). **[verified]** (ENGINE.md;
  E7 incident documented).
- P32. Maker/liquidity rewards are not modeled at all in the engine.
  **[verified]** (no rewards code anywhere in `src/trading/`; ENGINE.md
  lists the full cost model).
- P33. Strike (`polymarketPriceToBeat`) is live-only — no strike in replay;
  backtest strategies must reformulate in market-implied terms (FL E1).
  **[verified]** (CLAUDE.md external feeds; FL E1).

### Binance spot replayability — the NEW instrument

- P34. Binance aggTrades feed for backtests is **implemented and
  live-verified** on branch `binance-aggtrades-r2-sync` (local + origin;
  NOT merged to main as of 2026-07-17): as-of lookup over
  `data.binance.vision` daily dumps, strategy-driven opt-in via
  `ExternalFeedsRequestPlugin`, bit-identical replay for non-opted
  strategies, measured live latency p50 110ms (default
  `BACKTEST_BINANCE_FEED_LATENCY_MS=110`), verify CLI proves dump ==
  recorded WS stream (0 mismatches on 48k trades). **[verified]** by
  reading the branch (`docs/datasets/polymarket-data/binance-aggtrades-feed.md`,
  `src/backtest/feeds/binanceAggTradesSource.ts`). The charter's pointer
  "under docs/datasets/" is stale — the doc lives on that branch under
  `docs/datasets/polymarket-data/`.
- P35. Strategies still wake ONLY on Polymarket book ticks; Binance values
  are sampled as-of at those ticks (~100k–180k PM ticks vs ~5k–21k aggTrades
  per 15m window measured). Binance-driven synthetic ticks are a PROPOSED,
  NOT IMPLEMENTED ADR (prereq: feed branch merged). **[verified]**
  (`docs/backtest/adr-binance-driven-ticks.md` on that branch). Consequence:
  a fair-value quoter in backtest can only reprice when the PM book ticks —
  fine in liquid windows (ms), a real gap in quiet books.

## 8. Datasets

- P36. Telonex: 19k+ historical markets (order-book `book_snapshot_full`
  channel), one parquet per market, delta-typed is the research default;
  eligibility floor `TELONEX_DATASET_ELIGIBLE_FROM` default 2025-12-01;
  coverage gaps before 2026-01-19; `market_start_ms` (not `start_date_us`)
  is the window start. **[verified]** (docs/datasets/telonex/overview.md,
  CLAUDE.md). Gabagool's active window (Nov 2025–Feb 2026) overlaps Telonex
  coverage from ~2025-11-29 → the D2 fills-vs-book measurement is feasible.
- P37. Telonex has `trades`, `quotes`, `onchain_fills` channels upstream;
  measured coverage on the fable-lab universe: trades 95.9% of 18,635
  markets (2025-11-29 → 2026-06-14), quotes 100%, onchain_fills 91.6%. NOT
  ingested; a schema probe was blocked by vendor quota (HTTP 403) as of
  2026-07-11. **[reported]** (FL EDGE-SPACE §3.2, U42/U66). This is the
  missing ingredient for a queue-realistic fill model.
- P38. Recorded top-of-book UP/DOWN books mirror EXACTLY
  (`bid_DOWN = 1 − ask_UP`, `ask_DOWN = 1 − bid_UP`): 16,352/16,353 paired
  samples over 2,646 markets. **[reported→near-verified]** (FL E9
  strengthening, CAL-001; method visible, huge n). Consequences: (a)
  top-of-book `ask_UP + ask_DOWN = 1 + spread_UP ≥ 1` — an *instantaneous*
  sum-of-asks dutch book essentially cannot exist in this dataset (FL E9:
  0 hits in 500 markets net of fees); charter measurement D1 must be
  re-scoped to *time-separated* accumulation and/or depth beyond
  top-of-book; (b) gabagool's pair cost < $1 is achieved across TIME, not
  across the book at one instant — the concept survives P38, Game A
  (instant arb) does not.
- P39. Recorded books can be self-crossed (bestBid > bestAsk on one asset) —
  delta-stream artifact; "too good" quotes must be guarded or the sim grants
  phantom fills (FL E6). **[reported]** (FL; concrete example given).
- P40. The newest ~39 BTC 15m telonex markets (after
  `btc-updown-15m-1781394300`) are recorder dead-tail: no in-window ticks
  (FL lesson `the-newest-market-files-can-be-recorder-dead-tail`).
  **[reported]** — may be stale by now (data may have grown since June);
  re-check before any `--latest` sampling.
- P41. PMXT: independent hourly Polymarket orderbook archive, v1
  2026-02-21→04-16, v2 2026-04-13→ongoing. **[verified]**
  (docs/datasets/pmxt/overview.md). Covers the *tail* of gabagool's window
  (Feb 2026) and the successor era — a second source if Telonex gaps bite.

## 9. What prior campaigns already measured (do not rediscover)

### SRP families (this repo, BTC 15m, worst_queue)

- P42. spread-capture (SELL-side mirror of gabagool: split $1, quote asks
  both legs): ALL 23 cells across 3 experiments net- AND gross-negative;
  fees irrelevant (~$0.7–7.6/1000 mkts); loss channel = adverse selection on
  the first fill; EV → $0 from below as you quote less. Post-first-fill
  policy (hold/sell-faster/stop) worth ±$0.01 — the loss lives in the first
  fill. Roadmap #6 "bid-side mirror (buy-and-merge)" — the gabagool baseline
  — is UNIMPLEMENTED. **[verified]** (SC Research log; runs cited there).
- P43. endgame-panic-bid (resting bid on ~0.99 favorite in last seconds,
  hold to settlement): stage-1 pass (+0.01/mkt) → stage-2 recycle
  (−0.01/mkt at 3000); fill win rate 92.6% vs 95.5% breakeven; ~7% of fills
  are genuine last-second flips costing the full stake; the +2.3–4.5c
  standing margin ≈ fair price of the flip tail under worst_queue.
  Post-placement cancel logic is structurally blind (the informed fill
  arrives at/before the first reactable tick). **[verified]** (EPB Research
  log).

### fable-lab campaign (sibling worktree; BTC 15m, Telonex replay, 42 ideas, 41 dead + 1 parked)

- P44. Taker side: fairly priced everywhere expressible — five point
  measurements (tails/jumps/book-shape/open/dutch books, E9–E14) plus
  systematic plane scans (fixed-time 126 cells E20; move-conditional E21;
  two-segment paths E22; spread-state E23; event-time triggers E24; 16
  features E25). Zero buyer-favorable cells; the 156 bps fee makes every
  tested taker strategy net-negative. **[reported→near-verified]** (FL;
  extensive pre-registered method, but instrument-conditional: power limits
  stated per scan, mid-range resolves only |d| ≳ 3.8c).
- P45. Maker side IN-MODEL: closed at both fill-model bounds. Worst-queue
  punch-through adversely selected in quiet (E16 −0.79/played), loud (E17
  −1.27/played), and at every distance 1c–10c (E26a). At-touch (optimistic
  bound): gated cells lose MORE (E19, E24 — opening 90s two-sided quoting
  t=−5.16; no pre-information grace window); the UNGATED DOWN-side touch bid
  breaks exactly even (E29 — premium = adverse-selection cost, zero rent);
  the best measured fill-mix gate did not transfer (E30). Maker family
  closed pending trade-print fill model or venue regime change.
  **[reported→near-verified]** (FL). **Critical scope caveat for this
  shift:** every one of these cells was *unconditional or book-state-gated*
  quoting WITHOUT an external fair-value anchor (no Binance feed existed;
  E1: books + clock were the only signals). A Binance-anchored quoter is
  outside the measured set — that is exactly the new territory.
- P46. Fill-conditional pair sums are adverse: conditional on a maker fill
  at p, same-tick opposite ask a has p + a + fee > 1 (locking every pair
  −6.80/mkt, t=−3.17, E26b); the book does not lag itself after a sweep
  (mirror fact P38 makes same-tick hedges structurally dead, E27).
  **[reported]** (FL). Consequence for gabagool: completing the pair
  *immediately* via the other book is dead; the concept's pairing must wait
  for oscillation (time-separated), consistent with P13.
- P47. Exit structures don't rescue fair entries: maker-TP loses at high win
  rate, taker-SL loses at low win rate (E31, 8 cells); in-sample max-of-40
  selection inflated t by >4 units and flipped sign out-of-sample (E32 —
  winner's curse is measured, not theoretical). **[reported]** (FL).
- P48. 15m BTC mid-moves CONTINUE rather than revert (following won 40% vs
  fading 27.6%, pre-protocol; corroborated by E10/E16/E17/E21). Trending
  windows are when both-sides accumulation bleeds (P14). **[reported]**
  (SC edge economics + FL).

### The second central tension — ledgered

- **T2.** FL/SRP measured "passive two-sided maker on BTC 15m loses" under
  both sim fill bounds — yet gabagool-style wallets verifiably extracted
  ~$644k live doing (a superset of) exactly that (P15). Candidate
  reconciliations, each testable: (i) the sim's fill models miss the benign
  at/inside-touch flow that is most of real maker volume → measurement D2
  (fills-reality gap) quantifies this directly; (ii) the edge lives on
  1h/4h + alts, not 15m (T1); (iii) the edge needs a fair-value anchor
  (Binance spot) that no prior campaign had (P45 caveat); (iv) the edge is
  liquidity-rewards subsidy the engine doesn't model (P24/P32); (v) the
  operators eat small negative EV per market and profit via something else
  entirely (rewards, or P16-style mark-to-market illusions — but $644k
  all-time realized converging across sources argues against "illusion").
  Ranking these is the shift's core job; D2 is the highest-information
  next measurement.

## 10. Method rules inherited (proven the hard way)

- P49. Probe precision for skewed payoffs = count of minority-outcome
  events (want ≥ ~30), not t-stats (FL E14). Win-rate ~99% claims (P8) need
  loss-count arithmetic before believing any per-market EV. **[reported]**
  (FL; mechanism clear).
- P50. Public writeups about gabagool are presumed wrong until data-checked
  — the operator and INV both found most of them wrong (P4, P10, P13, P16
  all corrected earlier public claims). **[verified]** as a track record.
- P51. UI/leaderboard PnL for both-sides wallets: use realized (30d lb-api
  or activity-derived) figures, never 1d/7d marks or per-leg UI wins
  (P16/P17). **[reported]** (INV method finding).

## 11. Immediate implications for the work queue

1. D2 (passive-fill reality gap) is the decisive measurement (T2-i) — it
   tells the lab whether ANY sim-visible gabagool variant can exist.
2. D1 must be re-scoped (P38): not instantaneous sum-of-asks (≈ never), but
   the *time-separated* pair-cost opportunity: distribution of
   min-over-window (askUP(t1) + askDOWN(t2)) and of achievable passive
   accumulation cost.
3. Workstream B must date the fee introduction (P22) — if gabagool's active
   window straddles a fee change, his economics changed mid-life and the
   PnL time series should show it (natural experiment).
4. Workstream C should start with @gabagool22 handle→address resolution and
   the activity pull, then 0xb55f re-pull (is it still printing? P15 is 3
   days old).
5. Rewards question (P24) is cheap to answer from primary docs and could
   single-handedly explain T2 (reconciliation iv).

---

## Amendments (session 1, post-forensics — append-only)

- **A1 (amends P6, P2):** Active window pinned by data: first trade
  2025-10-29T12:34:51Z, last trade 2026-02-20T09:06:14Z, last redeem
  2026-02-21. Account still receives referral rewards (Jun 2026) — not
  "dead". [verified]
- **A2 (amends P10 → contested):** gabagool22 DID merge — dominant exit
  (~99% of exit dollars in both sampled eras). "Never merges / redeems
  winner" is a SUCCESSOR-wallet trait (INV's 337-market analysis of
  0xb55f), not the archetype's. Merge-vs-redeem is operator choice, not
  concept-defining. [verified]
- **A3 (amends P8):** "99% win, $30–120/market" VERIFIED for the Dec-2025
  zero-fee era on BTC books (98.7% win, p50 +$54.75, p90 +$128.84,
  btc-15m, n=229); REFUTED for the Feb-2026 tail (win 38.6–64.7%). The
  "$34k/market" part matches nothing measured (Dec p50 outlay $3.2k, max
  $7.9k). [verified both ways]
- **A4 (amends P18/T1):** BTC-15m was the archetype's BIGGEST earner in
  Dec 2025 (~$5.9k/day from that book alone, one wallet). "15m ≈ 0"
  described the late/fee era. T1 re-framed: the lab's scope hosted the
  crown-jewel edge in the zero-fee era; the open question is what the
  fee+rebate+multi-bot era left. [verified for Dec era]
- **A5 (amends P15/P16):** Incumbent 0xb55f full address
  0xb55fa1296e6ec55d0ce53d93b9237389f11764d4; STILL ACTIVE (fills hours
  before the 2026-07-17 pull); 30d profit GREW to $110.6k (vs $83.8k on
  Jul 13-14) — "edge decaying" contested. ~7 active gabagool-style
  wallets print ~$18.5k/day collectively (wallets/_META.md). [verified]
- **A6 (new):** MAKER REBATES: 15m-crypto taker fees (introduced
  2026-01-06/07) fund a 20% maker-rebate pool, paid daily ~00:11 UTC.
  End-state gabagool: trading −$1,767 vs rebates +$1,819 over the final
  2.6 days — he was a rebate farmer at the end and quit at breakeven.
  The engine models no rebates (ENGINE-GAPS G4). [verified]
- **A7 (amends P22):** Fee formula evolved: Feb era
  `C·p·0.25·(p(1−p))²` (peak $0.78/100sh — repo's 156bps matches this
  peak); current `C·0.07·p(1−p)` (peak $1.75/100sh). Shape AND rate
  changed 2026-02-28→05-31; Jan rate contested (press vs snapshot 2×
  discrepancy). [verified endpoints]
- **A8 (new, method):** data-api /activity has NO row ids +
  second-granularity timestamps → byte-identical same-second rows are
  REAL fills; content-dedupe silently destroys ~20%+ of a bot's trades
  (puller v1 incident: flipped measured tail PnL from −$1.8k to +$45k).
  [verified the hard way]
- **A9 (D2 — the charter's key measurement):** worst_queue admits ~44–49%
  of gabagool22's real btc-15m fills (touch_or_better ~64–68%; 3s
  alignment window; 43k fills across both eras). The missed half is the
  benign uninformed-arrival half → sim EV ≈ EV of the toxic subset only.
  Sim results are a lower bound, not a verdict. Also: 29–45% of his
  fills printed at/above the ask — he taker-completed substantially;
  "passive maker" is only ~60-70% of the story. [verified]
- **A10 (new, current meta):** The venue now runs THREE subsidy programs:
  maker rebates (20% crypto pool, since ~2026-01-06), tiered taker
  rebates (3–50% refund, since 2026-05-28, crypto weight 2.3×), and pUSD
  YIELD. Powerwinner (hottest 30d wallet, +$122.8k) is a PURE
  taker-rebate farmer: trading −$13.90/market on btc-5m only, rebates
  +$6.1k/day. Leaderboard "profit" for rebate-era wallets requires
  decomposition before interpretation (extends P51). [verified]
- **A11 (T1 RESOLVED):** btc-updown-15m carries live positive trading
  edge in July 2026 for both measured edge wallets: b55f +3.20% of buy
  turnover (best absolute book), 0xce25 +1.97% (2 full days, complete-
  market cash flow). P18's "15m ≈ 0" was an era artifact. The lab's
  frozen scope is the right hunting ground. ETH books measured NEGATIVE
  for both — edge is coin-asymmetric. [verified]
- **A12 (bonereaper resolved + bulk-payout discovery):** bonereaper's
  negative window is structural, not luck (5 days: trading −1.13% of
  $3.16M buys) — a hybrid: btc-5m rebate manufacturing (−0.90%) + real
  15m edge sleeve (btc-15m +1.12% — THIRD independent confirmation of
  A11) + sports punts. New venue fact: taker rebates can arrive as
  off-schedule BULK payouts (one $62.6k event = 20–45× the daily rate;
  daily cadence is 00:10Z taker / 00:45Z maker). Any wallet-income
  analysis using short windows is hostage to these lumps; and eth-15m
  was POSITIVE for bonereaper (+0.77%) while negative for b55f/0xce25 —
  A11's coin-asymmetry is wallet-specific, not a book property.
  [verified] (wallets/bonereaper.md)
- **A13 (fee mechanics + the accounting bias — corrects the LENS on
  A10/A11/A12):** On-chain, every fill is charged 10%×min(p,1−p)×size
  in the output asset to both sides; the operator module refunds in the
  same tx — makers 100% (net maker fee = $0), takers down to the
  published curve. data-api /activity reports GROSS size/usdcSize, so
  net taker fees (docked in shares on buys) are invisible: **every
  fee-era cash-flow net in this knowledge base is gross of taker
  fees**, and the July decompositions added rebate income without
  subtracting the fees being refunded. Jan btc-15m example: +$24.52/mkt
  gross → +$10.24–15.32/mkt after fee drag at the D2 taker share
  (29–45%). Whether the July "edge wallets" survive fee-inclusive
  accounting is now the top open question. [verified]
  (measurements/jan-transition-gabagool22.md)
- **A14 (Jan fee rate resolved; exit-trigger candidate eliminated):**
  January's effective taker fee = the Feb-snapshot formula
  0.25·p·(p(1−p))² ($0.78/100sh peak) — measured on-chain from his own
  Jan 11–12 taker fills. The press 2× figure is wrong; there was no
  Jan→Feb halving, so a mid-Feb fee/rebate cut is ELIMINATED as
  gabagool's 2026-02-20 exit trigger. December receipts show fee=0
  (zero-fee era verified on-chain). [verified]
- **A15 (transition curve is adaptation, not monotone decay):** btc-15m
  by market-start day: Jan 10 win 49.4% / +$0.69/mkt / pair cost
  0.9945 → Jan 12 win 94.0% / +$45.93 / 0.9815, while the FEE-FREE
  btc-1h control held 87–96% win with flat pair cost the same days.
  He re-tuned to the fee within ~6 days by demanding ~130bp deeper
  discounts on the fee book only. The Feb collapse is a SECOND
  phenomenon (mid-Jan→Feb compression), not the fee shock itself.
  Decay prior for the lab: a structural-fee shock costs days (fast
  re-tune possible); competitive compression takes weeks. [verified]
- **A16 (fee-inclusive re-audit — A13's question answered):** measured
  on-chain net fees for the July actives (120–150 receipts/cell,
  Jul 14–16): b55f btc-15m keeps **+2.31% fee-inclusive** (was +3.20%
  gross) — the edge is real; 0xce25 btc-15m barely survives (+0.31%,
  was +1.97%; taker-heavier style, rank vs b55f REVERSES after fees);
  btc-5m cells are fee-negative (−2.0 to −2.9%) confirming rebate
  manufacturing. Edge wallets are ~62% TAKER by notional even on edge
  books; doggystyie is 100% taker (its "perfect parity maker"
  fingerprint is a taker loop). NEW venue fact: July crypto up/down
  settles on a NEW exchange `0xe1111800…996b` (fill event 0xd543adfd…,
  native fees: maker 0, taker = published curve in USDC, mint-matching;
  launch date unbracketted). /activity remains gross-of-fee in the
  current era. [verified] (measurements/fee-audit-actives.md)
- **A17 (edge-source fingerprint, Jun 12–14 fills×books):** the current
  btc-15m edge expression = deep patient ladders (offset p10 −12c below
  touch, p25 −2c; ~35% of fills), cheap-side touch-resting (b55f touch
  px p50 0.14), mid-band taker completion (~43% of notional, px p50
  0.58), BACK-LOADED into minutes 10–13 (b55f 39.7% of fills) with the
  final minute cut and NO open concentration (Game F negative for this
  cohort). b55f vs 0xce25: the better wallet waits longer and crosses
  further from the fee peak (taker px p25 0.34 vs 0.42) — sharpens H6.
  Post-fill drift at 10s/60s ≈ 0 for both. [verified]
  (measurements/edge-source-btc15m.md)
- **A18 (venue facts batch):** resolution for btc-updown-15m =
  **Chainlink BTC/USD data stream** (data.chain.link/streams/btc-usd),
  end-price ≥ start-price → UP (**ties resolve UP**); negRisk = false;
  tick 0.01; min order 5 shares (gamma market object, live pull
  2026-07-17). Telonex dataset coverage ENDS 2026-06-14 globally (sync
  has not run since) — the lab cannot currently backtest the July era;
  June is the newest replayable slice. [verified]
- **A19 (venue limits batch, primary docs 2026-07-17):** sub-cent tick
  regime switches exactly at price >0.96 or <0.04 (`tick_size_change`,
  docs orderbook page) [verified]; rate limits generous — POST /order
  5,000/10s + 120,000/10min, batch POST /orders 2,000/10s, CLOB API
  9,000/10s, data-api 1,000/10s (docs rate-limits page) [verified] —
  NOT a binding constraint at archetype cadence (~700 fills/15m peak);
  marketable orders (FOK/FAK or crossing BUY) need ≥1 pUSD notional,
  resting GTC/GTD only 5 shares [reported, NautilusTrader adapter
  docs]; Chainlink Data Streams ≈200ms signed reports, 18-decimal
  prices [reported] → price ties at window boundaries are measure-zero;
  the ties→UP clause is not a tradable asymmetry. (VENUE-MECHANICS.md)
- **A20 (window lifecycle + flip table, 288 June markets):** btc-15m
  books are 1c-tight all window (p90 2c only after min 10); L1 ~150-250
  shares; mid-oscillation is FRONT-loaded (midTravel p50 0.42 min-0 →
  0.00 min-14) while decision accumulates smoothly (|mid−0.5| 0.045 →
  0.415). Flip table: leading side ≥0.9 with <5min left flips 0-6%;
  0.5-0.6 band is a coin toss at every horizon; measured flips sit at or
  BELOW price-implied in all bands ≥0.6 — the trailing cheap side is
  slightly overpriced (~1-5c gross, sub-fee), matching fable E25/E14
  from the other leg. The A17 back-loading is therefore NOT oscillation
  harvesting — winners position late, against front-loaded churn that
  fable E24 showed is adversely selected at the open. [verified]
  (measurements/window-lifecycle-btc15m.md)
- **A21 (bulk payout = program-wide backpay):** the $62.6k bonereaper
  lump (A12) is one same-second batch (2026-07-08T23:34:35Z) across 6/7
  actives, $174k total in this cohort; daily TAKER_REBATE payouts start
  exactly 2026-06-20 in every wallet while the program launched
  2026-05-28 → the lump is the May 28–Jun 19 accrual true-up (June
  income paid in July — don't read it as a July windfall). Also: manual
  round-number grants exist (powerwinner $7,500.00, badfallen
  $1,500.00); payout jobs batch and hiccup (same-second whole-day
  delays Jul 4/Jul 13); doggystyie/powerwinner near-zero maker rebates
  confirm pure-taker fingerprints; taker-rebate stream out-earns the
  maker stream ~5-10×/day for every wallet. Program discretion is now
  DIRECTLY evidenced (H3/G8 systemic risk). [verified]
  (measurements/rebate-payout-provenance.md)
- **A22 (G4 resolved — rebate estimator is exact):** official formula
  (docs maker-rebates page): per-market daily pro-rata by
  fee-equivalent (same curve as taker fees), pool = 20% of that
  market's taker fees → the share CANCELS: own rebate = 0.20 ×
  Σ 0.07·p(1−p)·size over own maker fills, exactly; $1/day/market
  minimum threshold (min-size bots round to ZERO). Measured Jul 15:
  btc-15m ≈ $1.9M/day matched notional, $36.4k/day taker fees, $7.3k/day
  rebate pool; per-market fees p50 $332. H1 is now fully sim-judgeable
  (fees exact + rebates exact). [verified]
  (measurements/rebate-pool-btc15m.md)
- **A23 (leaderboard sweep — the cohort was undercounted):** top-50
  30d-volume sweep found 4 unknown crypto-updown wallets ≥$0.7M/day.
  Headline: `0xb27bc932…5b82` = the archetype fingerprint at scale
  (100% BUY, $3.2 clips, all-time lb profit +$762,732), collecting
  ~$3.2k/day maker rebates since Mar 14 — trading profit today ≈
  +$95/day, i.e. ~97% of its income is venue subsidy. (The initial
  "btc-15m only / 40% of its pool" read was a sampling artifact —
  CORRECTED in A24.) Also: `0x95f5…779f` LOST −$542k
  in 30d doing $1.48M/day of parity-style BUY-only flow (failed
  challenger; caveat lb-profit excludes rebates); HelixEdge (btc-5m
  new entrant) −$20k/30d. P19's $8M/day: unmatched in top-50 — nearest
  is a mixed sports+crypto whale (suntori $6.3M/day); claim stays
  contested and the search is closed. [verified, quick-scan grade]
  (measurements/leaderboard-sweep.md, wallets/b27bc932.md)
- **A24 (b27bc932 full dossier — and a self-correction):** the June
  full pull (249k rows/2.4d) overturns A23's quick-scan read: the
  wallet is MULTI-BOOK (btc-5m $785k > btc-15m $241k > eth-5m $234k)
  and its ~$3.2k/day maker rebates span ≥3 pools → its btc-15m pool
  share is ~3–4%, NOT 40%; no wallet owns the book. Verified profile:
  ~104k fills/day (3× archetype cadence), pair cost p50 0.993 on
  btc-15m, leg imbalance p50 1.6% (tight parity), ZERO merges
  (redeems), win 58%, gross trading +0.28% of turnover ≈ breakeven
  after fees; execution = 50.1% taker by notional, deep ladder p10
  −15c, near-uniform timing with mild late tilt. The H1 mechanism
  demonstrably survives the fee era at breakeven-plus-subsidy, with
  completion half taker-executed. Lesson ledgered: last-500 /activity
  scans can span <1h — never infer book mix from them. [verified]
  (wallets/b27bc932.md)
