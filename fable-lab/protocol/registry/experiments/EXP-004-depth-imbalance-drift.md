# EXP-004 — depth-imbalance drift

## Spec

- **Registered:** 2026-07-09 (commit: the first commit touching this file — the
  validator checks it against run creation times)
- **Idea:** IDEAS.md entry 5 "Depth-imbalance drift"  **Parent lineage:** none
- **lineage_cells:** 1
- **Mechanism class:** `flow-momentum`
- **Hypothesis (who loses and why):** Quoters who ignore one-sided
  resting-depth pressure keep offering the pressured direction at a price
  that does not yet reflect the pressure — the book tips before the price
  moves. If persistent top-of-book depth imbalance is informative about the
  window outcome, buying the pressured direction wins more often than its
  ask implies. If depth imbalance is noise (or already priced), the same
  trade wins no more often than its ask — the probe decides.
- **Falsifiable prediction:** Conditional on UP-book depth imbalance
  (top 10 levels, (Σbid − Σask)/(Σbid + Σask)) staying ≥ 0.6 in absolute
  value with a constant sign for ≥ 5 consecutive seconds (entry ask in
  [0.15, 0.85], uncrossed book — LESSONS E6 guard), the pressured
  direction's realized win rate exceeds the mean entry ask (win rate >
  mean(entryAsk) from intent_meta, gross EV/share > 0 pre-fee). If win rate
  <= mean ask, the signal is not informative at this horizon and the
  mechanism is contradicted regardless of net PnL. Secondary diagnostic:
  entered fraction must be substantial; a near-zero entry count is a design
  failure (threshold too strict), not evidence.
- **Strategy:** `fable-lab/strategies/flow-momentum/EXP-004.ts`, id `fable-exp-004`
- **Primary parameter cell:** `--param levels=10 --param minImb=0.6 --param persistSec=5 --param minAsk=0.15 --param maxAsk=0.85 --param minElapsedSec=60 --param maxElapsedSec=840 --param shares=100`
- **Robustness neighborhood:** minImb ∈ {0.5, 0.6, 0.7} × persistSec ∈
  {3, 5, 10}; other params fixed; judged on sign-smoothness only.
- **Simulator-bias exposure (CAPABILITIES §4):** Taker-only FOK entry clamped
  to visible depth at bestAsk — pessimistic side (156 bps taker fee at
  mid-range prices is the HIGHEST fee zone, E3; no maker assumptions; no
  market impact assumed but size clamped to quoted depth). Optimistic
  dependencies: costless settlement; and recorded-book trust — an imbalance
  that exists only in the recording (WS gap) would manufacture signal; the
  E6 crossed-book guard plus entry-price distribution diagnostics address
  this. One mechanism-specific caution: the signal uses resting DEPTH, the
  same quantity the simulator uses for fills — a strategy that eats the thin
  side of its own signal buys exactly the liquidity the imbalance says is
  scarce; size stays clamped to quoted depth, so this is bounded.
- **Windows (computed by tools/universe.ts at registration):**
  - Exploration: `market_start_ms` < 1777237200000 (2026-04-26T21:00:00Z)
  - Holdout: `market_start_ms` >= 1777237200000 and <= 1781429400000, one-shot
    (upper bound = last eligible market at registration; markets accruing
    later belong to no window)
- **Sample rules:** probe = `--random --limit 500 --to-ms 1777237200000`;
  main = extend to full exploration window; holdout = full holdout window.
- **Decision rules (copied from EPISTEMOLOGY at registration):**
  - probe kill: q̂ ≤ 0 with t ≤ −1, or prediction contradicted
  - main advance: t ≥ 2 on primary cell (lineage_cells=1, p-bar 0.023) +
    battery pass + bias classification not simulator-favored
  - holdout confirm: t ≥ 2 on holdout alone
- **Latency curve points:** delay ∈ {0, 150, 300}, jitter 0

## Runs (append-only)

- 2026-07-09 — smoke (EXP-004-smoke, 10 markets): green plumbing, 0 entered.
  Pre-registration entry-rate diagnostics (batchUid EXP-000-debug, never
  evidence): loose cell (minImb=0.3, persistSec=2) entered 10/10 — signal
  path works; primary cell (0.6, 5s) entered 8/30 (~27%) on a 30-market
  sample — the smoke's 0/10 was small-sample luck, primary cell kept as
  registered (probe of 500 → ~130 expected entries, ample killing power).

- 2026-07-09 — run 311, batchUid `EXP-004-probe`, N=500, latency pinned
  DELAY=0/JITTER=0 (D8). Decisive readout, verbatim:

  ```
  === results: run 311  batch EXP-004-probe ===
  strategy fable-exp-004  params {"levels":10,"maxAsk":0.85,"minAsk":0.15,"minImb":0.6,"shares":100,"persistSec":5,"maxElapsedSec":840,"minElapsedSec":60}
  status completed  mode telonex-delta/delta-typed/local-or-download-from-r2-to-local
  N=500  played=85  skipped=415  failures=0
  pnlTotal=-109.17  EV/market=-0.2183  CI95=[-1.316, 0.8793]
  std=12.5226  q=-0.0174  t=-0.3899
  winRate(played)=0.2824 (24/61)
  fees=19.27  fee/grossWins=0.0228  maker/taker=0/85 (makerShare=0)
  days=141  positiveDayFrac=0.1135  best=2026-04-18:112.19  worst=2026-02-15:-97.57
  ```

  Prediction check (`tools/entry-check.ts --exp EXP-004 --run 311`): entered
  85 (17% — substantial, design-failure clause does not apply), mean entry
  ask 0.3193, win rate 0.2824, margin −0.0369, gross EV/share −0.03694 —
  PREDICTION CONTRADICTED.


## Verdicts (append-only)

- 2026-07-09 — stage probe, fresh-context Judge (JUDGE.md), verbatim:

  - stage: probe
  - decision: kill
  - read: N=500 q=-0.0174 t=-0.3899 EV/market=-0.2183 CI95=[-1.316, 0.8793]
  - prediction check: CONTRADICTED. The spec's falsifiable prediction
    requires realized win rate > mean entry ask (gross EV/share > 0
    pre-fee). Measured: win rate 0.2824 vs mean entry ask 0.3193 → win rate
    − mean ask = -0.0369, gross EV/share = -0.03694 (pre-fee). The spec
    states explicitly that win rate <= mean ask contradicts the mechanism
    "regardless of net PnL". The secondary design-failure clause does not
    apply: 85/500 = 17% entered is substantial against the pre-registered
    ~27% calibration.
  - battery: n/a at probe (spec runs the robustness battery at Stage 2 only)
  - simulator-bias classification: clean — taker-only FOK entries
    (maker/taker = 0/85, makerShare=0), size clamped to visible depth at
    bestAsk, full 156 bps taker fees paid in the highest-fee price zone; no
    maker-fill or settlement optimism is contributing to the (negative)
    result. The one optimistic dependency the spec flags (recorded-book
    trust manufacturing signal) could only inflate the edge, and the edge
    is negative anyway.
  - lineage-adjusted bar: lineage_cells=1, so no Bonferroni adjustment; the
    decisive bar remains one-sided p ≤ 0.023 (t ≥ 2). Not met and not
    relevant: t = -0.39, and the probe-stage kill clause (prediction
    contradicted) fires independently of any t bar.
  - required next step: append this verdict to EXP-004's Verdicts section
    and park the depth-imbalance-drift mechanism; no main-stage extension,
    no neighborhood grid; resurrection requires a new registration with a
    new falsifiable insight.
  - reasoning: The spec's probe kill rule has two disjunctive triggers —
    "q̂ ≤ 0 with t ≤ −1, or prediction contradicted" — and the second fires
    cleanly. The mechanism's entire causal claim is that persistent
    top-of-book depth imbalance predicts the window outcome better than the
    entry ask already does; on 85 entries the pressured direction won
    28.24% against a mean entry ask of 31.93%, i.e. the signal-conditioned
    trade wins slightly *less* often than an uninformed buy at the same
    prices would break even, with negative gross EV before a single basis
    point of fees. This is not a fee-leak or execution-leak story that
    "iterate" is designed for — the pre-fee edge itself is absent, so no
    implementation change within this mechanism can recover it. The point
    estimates (q = -0.0174, t = -0.39, EV/market = -0.2183, positive-day
    fraction 0.11) are all on the wrong side of zero, the CI straddles zero
    only in the way pure noise would, and the simulator setup is
    pessimistic-side (taker-only, depth-clamped), so nothing about the sim
    flatters the null. Where evidence is ambiguous the tie goes against
    advancement; here it is not even ambiguous — the registered
    falsification condition was met exactly as written. Kill.
