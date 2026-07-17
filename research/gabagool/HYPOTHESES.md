# HYPOTHESES — ranked, testable (living)

Session 1 draft. Each: mechanism, parameter ranges (justified), expected
metrics, kill criteria, SRP family. All are CURRENT-ERA hypotheses (post
2026-01-06 fees; ideally post 2026-05-28 taker rebates) — the zero-fee
edge is dead by regime change, do not test it.

## H1 — Parity-grinder maker survives in the current era IF rebate-adjusted (rank 1)

- **Mechanism**: archetype-faithful two-sided BUY ladders with continuous
  delta-parity (BRIEF §1); income = residual pair-cost margin + 20% maker
  rebate share. The archetype ran this to breakeven by Feb; the question
  is whether TODAY's thinner bot field + broader fee curve (0.07·p(1−p)
  extends fees to tails → richer rebate pool per fill) re-opened it.
- **Parameters**: clip $1–10 (archetype p50 $4); band p25–p75 ≈
  0.31–0.63; parity tolerance ≤1% of accumulated shares; ladder depth
  1–3 levels/side; books: btc-15m first (lab scope).
- **Expected metrics** (METRICS.md): pair cost ≤ 0.995 required gross;
  rebate estimate ≥ |trading net| when pair cost ∈ [0.995, 1.005];
  fills/market ≥ 50 for rebate mass; pair completion ≥ 99%.
- **Kill**: sim (worst_queue) pair cost consistently ≥ 1.005 even with
  parity control → NOT fatal alone (D2 measured: worst_queue admits
  44–49% of real fills — the adverse half — so sim-negative is expected;
  sim-POSITIVE would be extraordinary evidence). Structural kill only if
  rebate-pool arithmetic (20% × fee curve × plausible pool share) can't
  cover a measured 0.5c/pair deficit; otherwise disposition = live-paper
  or trades-channel queue model (fable EDGE-SPACE §3.2/3.3).
- **SRP family**: spread-capture roadmap #6 (bid-side mirror) IS this
  baseline — propose as new family `pair-accumulator` with parity as the
  decision driver (spread-capture's driver was symmetric premium
  collection without parity; measured dead, P42).

## H2 — Tail-completer (incumbent variant): cheap-side accumulation, hold to redeem (rank 2)

- **Mechanism**: buy deep cheap side (2–15c) as pair-completer/lottery,
  loose parity, no merges, redeem winners. Verified live-profitable NOW
  (b55f: +$2.7k/day trading, 47% win, payoff right-tail). Who pays:
  panic-dumpers of dying longshots + late favorite-chasers (EPB's donor
  channels) — and the venue via both rebate streams.
- **Parameters**: entry band 0.02–0.15 (b55f p25 0.09, p5 0.017); clip
  ladder $1–200 (his p90 $39, p99 $192); hold-to-resolution always.
- **Expected metrics**: win% per market 40–55%; net$/market mean ≈ +$1–3
  at his scale; worst-market ≥ −(3-5)× best-market — TAIL SHAPE IS THE
  RESULT, judge on market-level EV with minority-outcome count ≥30 (E14).
- **Kill**: sim EV < 0 across the 2026-03+ window at ANY band cell after
  fee modeling at BOTH fee tiers (156bps-era model is wrong now — needs
  the 0.07·p(1−p) curve, G3), given maker fills only. Note EPB measured
  the ENDGAME slice of this ≈ breakeven (P43) — H2 differs by operating
  the whole window and both sides, not the last seconds.
- **SRP family**: closest existing = endgame-panic-bid (late slice);
  propose `cheap-side-accumulator` with entry-band × hold as driver.

## H3 — The current edge is mostly venue subsidy; strategy = qualify for it efficiently (rank 3)

- **Mechanism**: incumbent income is ~60% rebates (maker 20% share +
  taker 50% refund at top tier). If trading nets ≈ 0 for a new entrant
  (plausible: competition) the game is "maximize fee-weighted maker
  volume + reach high taker tier with minimal EV bleed" — a subsidy
  yield, decaying with pool dilution and program changes.
- **Test WITHOUT code**: decompose the active wallets. FIRST RESULT
  (powerwinner, the hottest 30d wallet): trading −$13.90/market, taker
  rebates +$6.1k/day — pure subsidy farmer; STRONG support. b55f still
  shows real trading edge (~40% of income). Remaining: 0xaaaaa,
  badfallen, doggystyie, bonereaper, 0xce25.
- **Kill (of the hypothesis)**: majority of remaining actives show
  trading-dominant income like b55f → real alpha persists for entrants.
- **Status: leading.** The ecosystem's headline P&L is subsidy-inflated;
  every wallet claim needs decomposition (PRIORS A10).
- **SRP family**: none directly (rebates unmodelable in sim, G4); this
  hypothesis gates how much sim work is worth doing at all.

## H4 — Binance-anchored selective quoting beats blind parity quoting (rank 4, blocked)

- **Mechanism**: Game B fair value (spot-vs-strike + time + vol) as a
  quote filter — suppress the side that fair value says is rich; keep
  parity otherwise. No prior campaign could test this (feed is NEW, G6).
- **Blocked on**: operator merging `binance-aggtrades-r2-sync`; strike
  proxy = window-open spot (validate vs live `polymarketPriceToBeat`
  on a recorded day first).
- **Parameters**: suppression threshold |p_book − p_fair| ∈ 1–5c; vol
  estimator window 5–60 min; latency offset 110ms (measured).
- **Expected**: fewer adverse first-fills (the P42 loss channel) at cost
  of fill count; improves pair cost by ≥0.5c vs H1 baseline on the same
  markets.
- **Kill**: no pair-cost improvement at any threshold, or fill count
  collapses >80% (rebate mass dies with it).
- **SRP family**: new `fair-value-gated-maker`; scope caution — SCOPE.md
  currently FORBIDS external feeds; the handoff must flag that the feed
  is replayable-deterministic now (the ban's rationale changed).

## H5 — 15m is again the best lab book because 5m concentrates the bots (rank 5, cheap check)

- **Mechanism**: post-fee flow migrated (archetype tail was 5m-heavy;
  incumbent's top book is btc-5m). If the pro bots crowd 5m, 15m may
  carry relatively more un-arbitraged retail flow per bot today —
  supporting the lab's frozen scope rather than fighting it (T1).
- **Test**: per-book margin decomposition of 2-3 actives (same pulls as
  H3); compare net$/market and rebate-weight by timeframe.
- **Kill**: actives' 15m books uniformly negative-to-zero while 5m/1h
  carry everything → lab scope hosts a dead book; say so in LAB-HANDOFF.

## Discarded (do not re-raise without new evidence)

- Instantaneous sum-of-asks dutch book (Game A): impossible at
  top-of-book in recorded data (mirror-book fact, P38) and measured ~0
  live-era (FL E9). Time-separated pair building is the only version.
- Zero-fee-era replication: regime is gone (VENUE-MECHANICS timeline).
- Post-first-fill unwind cleverness: measured ±$0.01 sideshow (P42).
