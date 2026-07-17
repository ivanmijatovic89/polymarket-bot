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
- **A25 (data-api /trades is TAKER-ONLY):** probe on
  btc-updown-15m-1784258100, tx 0xacc56fb8…: the on-chain receipt has
  3 maker OrderFilled rows + 1 taker aggregate row; /trades returned
  ONLY the taker row. Market-wide /trades therefore cannot discover
  pure-maker wallets (the archetype variant is invisible in it);
  wallet discovery must run on-chain (OrderFilled on the 3 exchange
  contracts). /activity?user= DOES include maker fills, so Phase-1
  dossiers are unaffected. Also corroborates P-fact that /trades
  single-counts fills (one row per taker order). [verified]
  (measurements/variant-scan-method.md)
- **A26 (the "failed challenger" was a World Cup blow-up — A23's read
  REFUTED):** full daily timeline of `0x95f5…779f` (Jan 07 → Jul 17)
  + positions-ledger loss attribution: the −$542k/30d was lost
  market-making 2026 FIFA World Cup books (fifwc-*: −$615k gross
  losses across 254 positions, worst single market −$136k) at ~$105
  clips, Jun 24–Jul 17. Its crypto-updown life was dust-scale and
  near-breakeven throughout: a gabagool-shaped grind (BUY-only, $3.1
  clips, no merges, btc 5m+15m) Apr 22–Jun 10 at only ~$28k/day
  notional, total crypto loss-ledger residue −$2.6k, pre-whale
  all-time PnL ≈ −$5k. The class therefore has NO known large-loss
  casualty; "losing big is a live outcome of this family" (A23,
  _META cons. d, BRIEF §8.2) is withdrawn — the observed downside on
  crypto-updown is slow bleed (HelixEdge −$20k/30d) or margin
  compression, not blow-up. Blow-up risk demonstrably lives in
  jump-driven event books, which is evidence FOR the bounded-window
  continuous-underlying niche. W1 closed as reclassified. [verified]
  (wallets/95f5-challenger.md, scripts/challenger-timeline.ts)
- **A27 (b27bc932 merge usage is a TOGGLED module; A24's "zero
  merges" is era-bound) — corrected same-session:** the first write of
  this amendment claimed "first MERGE ever Jul 1"; the full-life
  timeline refuted it within the hour. True eras (per-day
  /activity?type=MERGE): **ON** ~Mar 7 → **2026-04-28T14:27Z** (500+
  merges/day; 7 stragglers Apr 30) → **OFF** for 2 months (zero
  merges/day Apr 29–Jun 30, matching A24's June pull) → **ON** again
  at **2026-07-01T07:53:10Z**, steady-state ~200/h within minutes
  (binary deployments both ways). REDEEMs continue in all eras; merge
  blocks p50 $50–110 (= 50–110 pairs) vs $3 clips; no volume
  step-change at either toggle; neither toggle date matches a known
  venue event (May-28 rebate tiers ≠ Apr-28; Jul-2026 fee revision =
  sports-only [reported]). Class implication (now stronger): exit
  style (merge vs hold-to-redeem) is a hot-swappable efficiency
  module independent of the entry engine — the operator has switched
  it twice without touching entries; expose as a family parameter,
  don't assume capital locks to resolution. [verified]
  (wallets/b27bc932.md §exit-style,
  data/b27bc932-timeline-full.json)
- **A28 (rebate economics per policy — the subsidy curve favors
  cheap-side):** from the A22 estimator: rebate = 1.4%·(1−p) per $1
  maker notional (taker pays 7%·(1−p) on the same dollar; venue keeps
  80%). Balanced two-sided ⇒ ~0.7% of maker notional; cheap-side
  p≈0.1 ⇒ ~1.3%. $1/day/market threshold ⇒ viability step at ~$143
  (balanced) / ~$75 (cheap-side) maker notional per market (≈48 maker
  fills/market at $3 clips). Calibration: predicts b27bc932 $2.7k/day
  (obs $3.2k) and b55f ~$0.9k/day (obs $0.77–1.06k). b27bc932's
  entire at-scale profit = +0.43% of turnover subsidy on breakeven
  trading. Sim rebate line = ~2× lower bound for touch-heavy policies
  (D2). Policy risk: program terms changed twice in 6 months;
  majority-subsidy EV inherits unpriceable venue discretion (G8).
  [verified — arithmetic on verified inputs]
  (measurements/rebate-economics-per-policy.md)
- **A29 (on-chain OrderFilled layout differs on the 2026 fee-native
  exchange):** on 0xe111… the event data is `(sideFlag, tokenId,
  making, taking, fee, ?, ?)` — d[0]∈{0,1} is the side, tokenId always
  d[1] (verified tx 0x7711684…). v1-style decoding drops ALL sells on
  the new exchange (binned under token "1"). Any on-chain tape
  analysis of post-April-2026 crypto-updown flow MUST use the dual
  layout; the "selling disappeared in May/June" pattern in the first
  era-scan pass was this artifact, not a meta shift. Scanner fixed;
  affected days re-scanned. [verified]
  (measurements/variant-scan-method.md §A29)
- **A30 (new atlas find — 0x04b6d7e9, the only known
  trading-profitable parity wallet at scale today):** born 2026-03-25
  (post-fees, post-reshape), BTC-only (5m/15m/hourly; ~35% btc-15m),
  BUY-only, maker share 0.88–1.00, pairRate 0.78 @ pairCost
  0.964–0.976 (DEEP pairs, patient completion), clips ~$5, ~24k
  fills/day, ~$350k/day notional, zero merges ever. Income: +$300,795
  all-time lb (trading) + $167,926 maker rebates since Mar 26; last
  30d ≈ $1.0k/day trading (+0.30%T) + $1.75k/day rebates (~64%
  subsidy). Topped the parity-edge cluster on ALL of Apr/May/Jun
  sample days; unknown to every prior source. Variant sits between
  seed 1 and seed 2: parity discipline with deep-discount economics —
  add a "deep-pair" cell to the seed sweeps. Method note: /activity
  single-page density extrapolation under-read this wallet ~8×; use
  window-sampled on-chain scans for high-cadence wallets. [verified]
  (wallets/04b6d7e9.md)
- **A31 (livebreathevolatility 0x818f214c — the class PREDATES the
  archetype):** first fills 2025-10-12, 17 days before gabagool22;
  btc-updown-15m specialist in the golden era (pair 0.90–0.92 @
  0.959–0.966, maker 0.80–0.84, clips $7–9); all-time lb profit
  +$385,802 (~93% trading, only $27.7k rebates); scaled Oct $23k/day →
  Mar $734k/day, adapting to the fee eras (pair→0.985+, maker→0.96,
  multi-book), then QUIT AT PEAK 2026-04-11 — second observed
  "walk away at scale" exit (n=2 with gabagool22). Merge usage
  toggled here too (Oct–Nov mix → zero from Dec): exit style as a
  switchable module is a CLASS-WIDE pattern (n=3 wallets). gabagool22
  is NOT the class originator; earliest-known is now 0x818f214c.
  [verified] (wallets/818f214c-livebreathevolatility.md)
- **A32 (cold-start viability is completion-mode-specific — the tier
  moat only taxes taker completion):** four specimens (measurements/
  cold-start-economics.md): maker-pure cold-starts WIN today
  (0x13e0d447: born May-29 with a week of penny probes, ≈+$121k in 5
  weeks; ohio-house 0xe114e5ca: born Jul-10, deep pairs 0.95@0.968,
  +$6k week 1); taker-heavy cold-starts bleed (HelixEdge −$20k/mo);
  maker-pure WITHOUT pair discipline is a fragile subsidy loop
  (0x76d4d470: −$98k trading + $137k rebates ≈ +$39k in 3.5mo).
  Maker fills earn the same rebate rate at any tier (A28), so the
  A16 "cold-start moat" applies ONLY to taker-completion variants —
  the lab's maker-only and deep-pair sweep cells are tier-immune; sim
  taker legs must use tier-0 (3%). [verified] 
- **A33 (vidarx 0x2d8b401d — the regime drifter; adaptation paid
  $660k):** all-time lb +$659,586 (+$76k rebates, day-2 rebate
  adopter), trajectory across the era scans: cheap-side (Dec, 0.68 @
  0.978) → deep parity-edge through the fee shocks (Feb–Mar, 0.84–0.86
  @ 0.95–0.976, #2 on btc-5m the week all-crypto fees landed) →
  farmer (Apr) → wind-down (alive Jul 15, +$4.3k/30d). Third
  deep-pair existence proof, and the third documented career path
  (adapt-across-eras, vs quit-at-peak ×2 and born-native ×2). The
  "professionals exit, don't bleed" pattern is now n=3. [verified]
  (wallets/2d8b401d-vidarx.md)
- **A34 (0x04b6d7e9 btc-15m mechanism: shallow ladder + timing, taker
  completion concentrated on 15m; pairRate 0.78 was cross-book):**
  fills×books join + per-market audit over 30 consecutive Jun-12
  US-session windows (measurements/deep-dive-04b6d7e9-btc15m.md):
  offsets vs touch p10 −2c (vs b55f −12c) — a touch-hugging ladder
  whose deep pair costs (p25 0.940, p50 0.982) come from timing dips,
  not resting depth; btc-15m pairRate is 0.94 p50 (0.78 was dragged
  down by 5m/hourly sleeves); excess leg is a favorite-side
  directional CHOICE that won 60% (not adverse cheap-side pile-up);
  resting fills drift FAVORABLY post-fill; ~all taker flow lives on
  btc-15m (5m/hourly sleeves maker-pure — execution differs per
  book); sleeve gross +0.65% of outlay with 47% losers in the hard
  regime → ≈ breakeven net of fees + rebates on top. Requote cadence
  seconds-scale (43–46 levels/side, 1s p50 inter-fill gap). Widens
  H1: shallow+fast is a second road to sub-$1 pairs. [verified]
- **A35 (0x04b6d7e9 keeps business hours — the strongest living
  variant is a weekday-US-session bot):** hour-of-day over the July
  pull: 87% of trades 12–19Z, ZERO 20–05Z; life-long weekday/weekend
  split 81/83 weekdays active vs 11/32 weekends; the only true dark
  weekday is US Memorial Day (2026-05-25). Its entire +$473k was
  earned in the O7 hard regime (worst realized pair costs, 2–5×
  flow) in ~7h/day × 5d/wk — fills are the binding resource, not
  quiet books; 24/7 uptime is not what wins today. The unit-2
  "overnight repeat" residue is moot for this wallet (no overnight
  data exists); regime comparisons need b27bc932 (24/7). [verified]
  (wallets/04b6d7e9.md §Session schedule)
- **A36 (session-dependence is real and recipe-specific — the 24/7
  grinder bleeds exactly where the business-hours wallet wins):**
  b27bc932's 222 June btc-15m markets bucketed by window start hour
  (measurements/session-split-b27bc932.md): US 12–19Z is its ONLY
  gross-negative session (−$384, 50% losers, pairCost p50 1.006,
  doubled left tail) despite max capital and fills there; overnight
  /EU/evening all print (+$219/+$274/+$566, pairCost p50 0.988–0.991).
  Combined with A35: the two living winners DIVIDE THE DAY — parity
  grind wins off-hours, shallow-fast+favorite-lean wins the US
  session. Also: b27bc932's excess leg won 67–81% by session →
  informed unpaired lean is a class pattern (n=2, A34). Session must
  be a sweep/reporting dimension; W4 should stratify by session over
  months. [verified]
- **A37 (maker fill density: the rebate step is reachable maker-only,
  and (offset × requote speed) is a joint axis with two local optima
  = the two living recipes):** worst_queue-rule density over the 30
  Jun-12 US-session books (measurements/fill-density-btc15m.md):
  at-touch/1s requote = 133 fills/mkt p50 → $532 maker notional at $4
  clips, ≥$143 rebate step in 100% of markets (−1c/5s: $268, 93%);
  fast requoting helps at the touch but HURTS at depth (−2c: 26
  fills at 1s vs 45 at 5s; −5c: 4 vs 18 at 15s) — deep rungs want
  patient standing orders. Fast+shallow (A34, 0x04b6d7e9) and
  slow+deep (A17, b55f) are the two optima; the middle is dominated.
  Deep rungs are rare-event harvesters (~5/mkt at −5c) whose value
  must be per-fill price, not volume. Caveat: high-flow regime
  sample; W4 re-runs off-session. [verified]
- **A38 (W4 scale-up of the density grid — A37 replicates across 4
  months × 4 sessions; January Telonex has stub-file gaps):** 192
  books on Jan-15/Mar-16/May-13/Jun-10 (48 each, every 2nd window):
  pooled touch/1s = 71 fills/mkt p50 (Jun-12 was a ~1.9× hot
  stretch); the (offset × requote) interaction and touch≫depth hold
  in EVERY stratum; rebate step reachable maker-only in ≥75% of
  markets in every clean stratum; NO monotone Jan→Jun density decay
  (vol dominates calendar); session is not a stable density axis (
  A36's split is pair-cost/adverse-flow, not fill availability).
  DATA FLAG: 13/48 Jan-15 parquets are near-empty stubs — January
  backtests must filter by event count or silently under-fill.
  [verified] (measurements/fill-density-btc15m.md §W4)
- **A39 (four-wallet execution fingerprint complete — the edge
  signature is post-fill drift, not depth):** b27bc932 joined the
  fills×books table (same 30 Jun-12 books): shallowest + most
  taker-heavy of the four (45.5% taker fills, offsets p10 −2c, flat
  timing with m14 cut — A24's ~50% taker confirmed at fill level).
  The two shallow wallets separate ONLY on resting-fill drift:
  04b6d7e9 +0.9c@60s (margin +0.30%T) vs b27bc932 −0.4c on deeper
  fills (margin ≈0) — fill SELECTION quality, not ladder shape, is
  what pays; the microstructure twin of A36's session split.
  Post-fill drift per fill class becomes a first-class sweep
  diagnostic (METRICS.md updated). [verified]
  (measurements/edge-source-btc15m.md §Session-8 addendum)
- **A40 (D1 measured at last — sub-$1 dips are 100%-present but
  sub-second flickers worth ~$2.5/market today; January had STANDING
  discounts):** 209 books across Jan/Mar/May/Jun
  (measurements/dip-scan-btc15m.md): current era = 6–10
  episodes/market, all closed by the next book event, top-of-book
  harvest $0.10/episode p50 → taker-taker instant arb is dust and
  race-contested; passive capture (resting bid eaten by the sweep
  that makes the flicker) is the only expression — confirms P38
  re-scope, A37, D2. January (fee-era week 2): dip-time p90
  124s/market, minSum p10 0.72, standing value up to ~$10k/market
  top-of-book [reported — possible stale-book inflation, G10 era]:
  the pool the Jan cheap-side winners harvested, repriced away by
  March. A standing-discount regime detector is a cheap live metric
  if a dislocation era returns. [verified for Mar→Jun; Jan tagged
  reported]
- **A41 (guh123 0xa45fe11d — the 33-day sprint; fee shocks open
  harvest windows):** +$215,900 lb profit (ex-rebates) on $51.5M in
  ~33 days (first trade Feb 18–20, last 2026-03-24T08:50Z) =
  ~$6.5k/day trading — the fastest documented daily trading rate in
  the class, entirely post-fees, THROUGH the Mar-06 all-crypto fee
  shock (Mar-15 scan: #1 that day, pairRate 0.971 @ 0.9895, maker
  0.79, clips $4.6, btc+eth all timeframes). Fourth quit-at-peak
  specimen; started the very days gabagool22 exited (succession
  timing [reported], no on-chain link). With A40's January pool:
  fee/venue shocks create weeks-long rich windows before the class
  re-adds capacity — venue-change events are opportunity signals.
  [verified except where tagged]
- **A42 (the January winners harvested A40's pool and left when it
  closed; quit-at-peak n=6; completion mode tracks fee regime):**
  0x961afce6 "CRYINGLITTLEBABY" +$381,215 (last trade Jan-26) and
  0x93c22116 +$382,998 (last trade Feb-01, born Dec-28 → ~$10.6k/day
  over 36 days — fastest documented daily trading rate). 961afce6's
  scans show makerShare 0.105 @ pairCost 0.921 in fee-free December
  (taker-sweeping standing discounts) flipping to makerShare 0.766
  once fees landed — wallet-level behavioral proof of the A16/A32
  completion arithmetic. Both are cheap-side dislocation harvesters
  (pairRate 0.57–0.58), seed-2-shaped. Twin-operation suspicion
  [reported]: profits within $1.8k, same recipe/books/era. No winner
  in the class has ever bled out — all exits are abrupt at full
  speed. [verified except twin link]
  (wallets/jan-winners-961afce6-93c22116.md)
- **A43 (golden-era originals dossiered; the per-operator daily-rate
  ceiling compressed ~5× in 8 months; the first exit predates
  fees):** 0x589222a5 "PurpleThunderBicycleMountain" +$853,686 in ~9
  weeks (Nov-20→Jan-21, ~$14k/day) — the class's #2 all-time,
  ~tying gabagool22 in half the time; 0x52483137 +$485,895 in ~5
  weeks (Nov-01→Dec-06, ~$13.9k/day) and quit BEFORE fees existed —
  competition alone forced the first documented exit. Era ceiling
  series (best documented rate): Nov ~$14k/day → Dec–Jan ~$10.6k →
  Feb–Mar ~$6.5k → living best ~$2.75k (incl. rebates). Each venue
  shock opened a rich window (A40–A42) but the post-window ceiling
  ratcheted DOWN every time; realistic new-entrant ceiling today =
  $1–3k/day, and the durable edge is operational (A39 fill
  selection, A35/A36 session choice, A28 subsidy), not a structural
  pool. Quit-at-peak n=8, spanning every era. [verified]
  (wallets/golden-era-originals.md)
- **A44 (the entry gate found — momentum context of the resting
  fill, not book geometry, separates the winner from the breakeven
  grinder):** pre-fill features on 5.7k resting fills of
  04b6d7e9 + b27bc932, same 30 Jun-12 books
  (measurements/drift-features-btc15m.md): momentum CONTINUES at
  30–60s (fills during falls keep falling — the adversely-selected
  subset is literally "caught the falling ask"); the winner's fills
  sit in near-calm states (preDrift30 +1.5c, post60 +0.47c) while
  the breakeven wallet's fills fire mid-chase at local tops
  (+5.5c pre, −0.15c post — fast requotes trailing rallies).
  Spread/depth/event-rate/minute discriminate NOTHING. Lab gate:
  quote when |preDrift30| ≈ 0; veto after 10–30s falls; don't
  instant-requote upward under rallies. Favorable share is ~48% for
  BOTH wallets — judge gates on aggregate drift/pair cost, not
  per-fill win rate. [verified]
- **A45 (A44 gate validated out-of-sample — habitat and 10s veto
  survive, 30s directional rule dies):** May-13 + Jun-10 repeats
  (measurements/drift-features-btc15m.md §validation): (1) habitat
  separation ROBUST — b27bc932's resting fills always fire in +3–4c
  chase states, the winner's at ≈0; (2) the 10-second falling-ask
  veto holds 3/3 samples (May-13 corr +0.21); (3) the 30s
  directional momentum rule REVERSES sign by day (Jun-10 corr
  −0.19) — day-regime-dependent, must be swept not fixed. Revised
  gate: prefer low-|30s momentum| states, hard-veto fills within
  ~10s of a fall, never chase rallies; no fixed 30s+ direction
  signal. Bonus: b27bc932 had ZERO btc-15m resting fills May-13 —
  its May downtime windows confirmed from a second data source.
  [verified]
- **A46 (A36 session ordering replicates — US worst, evening best,
  2/2 samples; grinder gross-negative days are normal):** Jun-10
  full-day session split (85 markets): US −$1,220 of −$1,508 total,
  evening +$509 (27% losers); whole-day btc-15m sleeve gross −0.9%
  of outlay — rebates+other books carried it, per A24/A28. May-13:
  zero btc-15m markets (third independent confirmation of the May
  downtime). [verified] (measurements/session-split-b27bc932.md
  §Replication)
- **A47 (endgame flip table at scale — 209 markets, 4 months):**
  P(favorite loses): 0.99+ favorites NEVER flipped (0/393 pooled,
  incl. 5-min-out); 0.90–0.99 flip 2–4% at 30–300s (cheap-side
  completion vs them ≈ fairly priced to slightly negative — P43
  quantified); mid-band 0.50–0.70 favorites flip 30–40% even at
  300–600s (parity protects real variance). A34 calibration: the
  winner's favorite-lean win rate (60% @ 0.547) = the bucket base
  rate — the lean's value is avoiding the adverse cheap-side lean,
  not selection. Leg-risk rule: cap cheap-side excess, tolerate
  favorite-side; leave ≥0.99 legs unpaired to redemption.
  [verified] (measurements/flip-table-btc15m.md)
- **A48 (time-to-pair is a ~1-minute clock, stable across recipes
  and days):** share-weighted completion lag on 4 samples / 408
  market-instances (measurements/time-to-pair-btc15m.md): p50
  40–67s, ~2/3 of pair volume ≤60s, 95–99% ≤300s, only 15–20% ≤10s.
  Leg unpaired after ~5 min = structural excess (A34 lean) — manage
  as inventory, don't await. Leg-risk timeouts belong in 60–300s.
  Patient deep-pair recipe pairs slower (p50 67s) than the parity
  grinder (39–43s) — speed/depth tradeoff as A37 predicts.
  [verified]
