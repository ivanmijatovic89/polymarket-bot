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

## Verdicts (append-only)
