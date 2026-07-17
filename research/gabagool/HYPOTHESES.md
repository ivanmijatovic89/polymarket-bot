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
  0.31–0.63; parity tolerance: SWEEP 0.1% → 40% as a first-class knob
  (archetype ran 0.1% in the zero-fee era; current edge wallets run
  20–40%, and the one 0%-parity wallet today is trading-negative —
  BRIEF §5); ladder depth 1–3 levels/side; **completion policy**: sweep
  maker-only vs taker-complete-when-lagging (fee 0.07·p(1−p) on the
  crossing leg — exactly modelable now, A16); books: btc-15m first
  (lab scope).
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
- **RESOLVED (measurements/actives-decomposition.md): STRATIFIED.**
  3 of 7 actives have real trading alpha; 3 are deliberate taker-rebate
  farmers (trading negative by design); bonereaper is a hybrid (A12).
  **Fee-inclusive correction (A16)**: the gross margins shrink but the
  btc-15m edge SURVIVES on-chain-audited fees — b55f +2.31%, 0xce25
  +0.31%; all btc-5m cells fee-negative (farming). Real edge persists
  in July 2026 AND the ecosystem's largest income stream is the
  taker-rebate pool (~$20k/day across these 7, incl. occasional BULK
  payouts — bonereaper got a single $62.6k one, A12). Consequences:
  (a) the lab's target is the edge-wallet profile (small clips $6–11,
  multi-book, moderate parity, maker-biased completion) — NOT the
  farmer profile; (b) program risk (venue repricing rebates) is the
  systemic risk of everything built here; (c) headline P&L of any
  wallet is meaningless without decomposition AND fee reconstruction.
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

## H5 — 15m is again the best lab book because 5m concentrates the bots — RESOLVED SUPPORTED

- **Mechanism**: post-fee flow migrated; the pro bots crowd 5m for
  rebate weight, leaving 15m relatively more un-arbitraged.
- **RESOLVED (A11 + A16)**: btc-15m is fee-inclusive POSITIVE for the
  wallets audited (b55f +2.31%, 0xce25 +0.31%; bonereaper's 15m sleeve
  +1.12% gross) while btc-5m is fee-inclusive negative for every
  audited wallet (−2.0 to −2.9%) and exists as rebate manufacturing.
  The lab's frozen btc-15m scope is the RIGHT hunting ground; 5m is a
  subsidy game the lab cannot model (G4/G8).

## H6 — Completion aggressiveness is the margin knob (NEW, rank 2.5)

- **Mechanism**: same operator, same books, same era: b55f (+2.31%
  fee-inclusive btc-15m, taker fills pay 1.43% avg) vs 0xce25 (+0.31%,
  taker fills pay 2.64% — crossing nearer mid). The ~2% margin gap
  tracks WHERE the taker completion happens on the fee curve. If true,
  the single highest-leverage policy in a build is: complete the
  lagging leg only when the crossing price keeps pair cost + fee under
  a hard cap (e.g., ≤0.99), else wait or abandon parity.
- **Test path**: sim can model this exactly (fees known, A16); the
  maker side stays worst-queue-bounded but the RELATIVE ranking of
  completion policies survives a pessimistic maker model (same maker
  fills under both arms).
- **Kill**: completion-policy sweep shows <0.3% margin spread on
  identical maker fills → the gap was book-mix or timing, not policy.
- **SRP family**: parameter axis inside `pair-accumulator` (H1), not a
  separate family.

## Discarded (do not re-raise without new evidence)

- Instantaneous sum-of-asks dutch book (Game A): impossible at
  top-of-book in recorded data (mirror-book fact, P38) and measured ~0
  live-era (FL E9). Time-separated pair building is the only version.
- Zero-fee-era replication: regime is gone (VENUE-MECHANICS timeline).
- Post-first-fill unwind cleverness: measured ±$0.01 sideshow (P42).
