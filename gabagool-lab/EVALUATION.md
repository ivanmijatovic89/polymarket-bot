# EVALUATION — the frozen scoring rule

Version 1, frozen 2026-07-17 (session 1), BEFORE any experiment ran.
One planned amendment is pre-declared in §7 (tail/capital thresholds
calibrated from the L1 baseline, frozen before the first CANDIDATE
experiment). Any other change requires a DECISIONS.md entry and bumps
the version; verdicts always cite the version they were judged under.

## 1. Universe and windows (frozen)

- Universe: telonex btc-15m, `delta-typed` converter, eligibility via
  `listEligibleTelonexMarkets` (never inline SQL), explicit
  `--from-ms/--to-ms` on every evidence run (never `--latest`).
- **SEARCH window: 2026-04-01T00:00Z → 2026-05-31T24:00Z** (fee curve
  0.07·p(1−p) certain; ~5,800 markets). All screening, axis curves, and
  refinement live here.
- **HOLDOUT: 2026-06-01T00:00Z → 2026-06-14T09:30Z** (~1,270 markets;
  the only replayable slice of the post-2026-05-28 taker-rebate meta).
  One-shot per champion lineage. Never browsed, never screened.
- **TRANSITION band: 2026-03-06 → 2026-04-01** (fee curve changing):
  labeled robustness readout only.
- Pre-fee data (≤2026-01-06): mechanism sanity checks only, never
  verdicts. Never pool across fee eras (KB METRICS discipline).

## 2. Execution profile (frozen)

- Latency battery: **0 / 140 / 500 / 1000 ms**, `BACKTEST_LATENCY_JITTER=0`
  (determinism). 140 ms is the realism anchor (measured feed offset
  ~110 ms + margin); 500/1000 are the operator-mandated stress arms.
  Every run pins both env vars explicitly (ambient .env trap).
- Sim taker fee left at native `BACKTEST_TAKER_FEE_BPS=156` (so the
  engine's own accounting stays comparable across runs); VERDICT
  numbers use the corrected fee (§3).
- Sizing: clips sized so a typical played market carries ≥ $150 buy
  notional (rebate threshold realism) while staying far from risk caps
  (≤10 rungs/side, position ≤ 500 shares/asset). Capacity claims from
  sim size are banned regardless of sizing (all-or-nothing fills).

## 3. The measured lines (per run)

All from MySQL, computed by `tools/results.ts`; segment = `all` row of
`backtest_run_segments` unless sliced; per-market data from
`backtest_run_markets`.

- **TRADE_sim** = `ev_per_market_total` — the engine's own net EV/market
  (fee-inclusive at sim's 156bps·min(p,1−p) model).
- **Fee reconstruction** (from `intent_meta`, which every lab strategy
  populates per order with `{px, sz, side, leg, k}`): maker fills are
  exact (all-or-nothing at own price); taker fills use the intended
  cross price recorded at placement. Validation: recompute the sim's
  fee formula over reconstructed taker fills; require
  |Σreconstructed − Σ`fees_paid`| ≤ max($0.02·markets, 2% of Σ|fees|).
  Fail → the run's corrected numbers are quarantined until explained.
- **TRADE_corr** = TRADE_sim + (fees_sim − fees_era)/markets_total,
  where fees_era = Σ_taker 0.07·p(1−p)·size (per-fill, reconstructed).
  A cold-start entrant pays the full curve — no tier refunds assumed.
  For maker-only variants TRADE_corr ≡ TRADE_sim (both fee terms 0).
- **REB** = per-market rebate line = Σ_markets max applied per market:
  rebate_m = 0.20 × Σ_maker-fills 0.07·p(1−p)·size, set to 0 where
  rebate_m < $1 (venue threshold at sim scale) — divided by
  markets_total. Reported ALWAYS as its own line.
- **EL (economic line)** = TRADE_corr + REB. The headline number.
  Any EL where REB > 70% of EL is labeled **subsidy-carry** and the
  dossier must carry program-risk warnings (A21: discretion evidenced).
- **Slices**: EL and components per `weekly` segment rows (fee
  reconstruction subsetted by market_start_ms).
- **PAIR metrics** (from up/down_shares, mergable_shares, cost):
  pairRate = 2·Σmin / Σ(up+down); residual exposure share = Σ|up−down|·p̄
  vs Σcost; per-market imbalance distribution.
- **TAIL metrics** (per-market pnl distribution): pnl_p5, CVaR5 (mean
  of worst 5%), pnl_max_lose, profit factor PF = Σwins/|Σlosses|,
  worst-week EL.
- **CAPITAL**: avg and p90 per-market peak outlay (`cost` at settlement
  + realized outlay reconstruction where available); EL per $100 peak
  outlay.
- **Sample**: markets_total, played share, per-market t-stat of the EL
  components (with max-of-N label), minority-outcome count for any
  win-rate claim (≥30 required; E14).

## 4. Latency robustness (candidate requirement)

Computed across the battery on identical coverage:
- **L-ratio-500** = EL(500)/EL(140), **L-ratio-1000** = EL(1000)/EL(140)
  (defined when EL(140) > 0).
- **Structure check**: maker-fill count ratio fills(500)/fills(140).

## 5. Hard gates (candidate experiments; any FAIL = not championable)

Stage S1 — screen (two disjoint 400-market samples inside the search
window, 140 ms):
- G1: EL > 0 on BOTH halves (sign agreement; E31).
- G2: played share ≥ 20% of markets (a maker that never trades is
  unmeasurable, not promising).
- G3: minority-outcome ≥ 30 for any quoted win rate > 0.9.

Stage S2 — confirm (full search window ~5,800 markets + full latency
battery):
- G4: EL > 0 at 140 ms; t(EL) ≥ 2 (labeled with selection width).
- G5: **stability** — EL > 0 in ≥ 60% of weekly slices AND no single
  week's PnL > 60% of the sum of positive weekly PnLs.
- G6: **latency** — L-ratio-500 ≥ 0.6 AND EL(1000) > 0 AND
  fills(500)/fills(140) ≥ 0.5.
- G7: **tails** — PF ≥ 1.3 AND CVaR5 ≥ −(TAIL_K × EL) with TAIL_K
  frozen per §7; pnl_max_lose reported alongside.
- G8: **pairing** — pairRate ≥ 0.5 OR the variant's spec explicitly
  declares a loose-parity design with its residual-exposure budget
  (b55f runs 40% imbalance profitably — loose parity is a design, not
  a defect; undeclared looseness is).
- G9: fee-reconstruction validation passed (§3).

Stage S3 — holdout one-shot (Jun 1–14, champion lineage only):
- G10: EL > 0 at 140 ms AND EL(500) > 0. No re-selection; fail kills
  the lineage's claim. Transition-band readout attached as context.

Axis experiments face only G2/G3/G9 (measurement validity), not the
championship gates — their output is the curve.

## 6. SCORE (leaderboard ordering among gate-passers)

SCORE = EL(140) × f_stab × f_lat × f_tail, where
- f_stab = fraction of weekly slices with EL > 0 (0..1),
- f_lat = clip(L-ratio-500, 0, 1),
- f_tail = clip(PF − 1, 0, 1) (PF ≥ 2 saturates at 1).

SCORE orders the leaderboard; it never overrides a hard gate. Verdicts
quote the full vector, not just SCORE. Ties (within 10%) break toward
higher EL(1000), then higher capital efficiency.

## 7. Pre-declared amendment: tail + capital thresholds

TAIL_K (G7's CVaR multiple) and the capital-efficiency floor cannot be
honestly set before seeing ANY pair-strategy distribution on this book.
Procedure, pre-committed:
1. Run the L1 baseline (an archetype-faithful reference variant, not a
   champion candidate).
2. From its S2 readout, set TAIL_K and the capital floor with written
   rationale (DECISIONS.md), targeting "reject blow-up shapes, admit
   b55f-like right-tail shapes".
3. Freeze both BEFORE the first candidate experiment is proposed.
   Version bumps to 1.1. The baseline itself is exempt from G7 (it is
   the calibration source and cannot be selected by it).

## 8. Verdict vocabulary (what the lab may claim)

- **CHAMPION-VALIDATED**: passed S1→S3 including holdout, dossier with
  full vector + latency curve + subsidy split + transfer risks.
- **SIM-POSITIVE (extraordinary)**: TRADE_corr alone > 0 at S2+S3 under
  worst_queue — flag prominently; this exceeds what the live winners'
  own economics require (they need the benign half + subsidy).
- **SUBSIDY-CARRY**: EL > 0 but REB-dominated; live-ready only with
  program-risk caveats and scale plan (threshold arithmetic).
- **AXIS-CLOSED**: curve measured, region dead/alive with numbers.
- **CEILING**: the §4-kill numeric proof (EPISTEMOLOGY §4) with
  retryOnlyIf conditions.
Every claim states: window, latency arm, selection width, and which
fill-model assumption it leans on. "Positive in sim" without those
qualifiers is not a sentence this lab writes.
