# EXP-002 — UP+DOWN dutch-book scan

## Spec

- **Registered:** 2026-07-09 (commit: the first commit touching this file — the
  validator checks it against run creation times)
- **Idea:** IDEAS.md entry 2 "UP+DOWN dutch-book scan"  **Parent lineage:** none
- **lineage_cells:** 1
- **Mechanism class:** `sum-mispricing`
- **Hypothesis (who loses and why):** When one book reprices fast, the maker
  quoting the complementary book lags; for brief moments
  bestAsk(UP)+bestAsk(DOWN) < 1 by more than round-trip taker fees. Whoever
  leaves the lazy complement quote loses to anyone buying both sides and
  holding the riskless $1 settlement. If such moments never exist at
  top-of-book beyond fees, the market is internally consistent and the
  mechanism is dead.
- **Falsifiable prediction:** Across 500 probe markets, net-of-fee dutch-book
  moments (gap = 1 − askUP − askDOWN − modeled fees ≥ 0.002/share at
  top-of-book, with NEITHER book self-crossed — bestBid < bestAsk on both
  assets, the LESSONS E6 artifact guard) occur in at least a handful of
  markets, and every filled pair's settlement PnL is non-negative by
  construction (gross profit = recorded gap). If entered-market count is ~0,
  the mechanism is dead — that is itself the lesson. If pairs enter but PnL
  is NEGATIVE, the recorded books were inconsistent with reality
  (data-quality lesson, CAPABILITIES §5 "eligible ≠ verified"), not a
  trading edge either way. Pre-registration note: the un-guarded prototype's
  smoke showed apparent gaps that were self-crossed single books (EXP-002
  smoke + EXP-000-debug replay, 2026-07-09) — the guard is part of the
  registered design, added BEFORE any decisive run.
- **Strategy:** `fable-lab/strategies/sum-mispricing/EXP-002.ts`, id `fable-exp-002`
- **Primary parameter cell:** `--param minEdge=0.002 --param shares=100 --param maxEntries=5 --param feeBps=156`
- **Robustness neighborhood:** minEdge ∈ {0.001, 0.002, 0.005} × maxEntries ∈
  {1, 5, 9}; shares scale-invariant; feeBps fixed to the engine's fee model.
- **Simulator-bias exposure (CAPABILITIES §4):** Taker-only FOK entries
  clamped to visible top-of-book depth — pessimistic side for execution
  (156 bps taker fee modeled on both legs, no maker assumptions).
  Optimistic dependencies: costless instant settlement of the $1 pair (no
  redeem cost/timing), and — decisive for THIS mechanism — trust in the
  recorded books: a stale/wrong level on one side manufactures a fake gap
  the simulator will happily fill with no market impact. Composition
  diagnostics must check that measured gaps are not concentrated in a few
  suspect markets.
- **Windows (computed by tools/universe.ts at registration):**
  - Exploration: `market_start_ms` < 1777237200000 (2026-04-26T21:00:00Z)
  - Holdout: `market_start_ms` >= 1777237200000 and <= 1781429400000, one-shot
    (upper bound = last eligible market at registration; markets accruing
    later belong to no window)
- **Sample rules:** probe = `--random --limit 500 --to-ms 1777237200000`;
  main = extend to full exploration window; holdout = full holdout window.
- **Decision rules (copied from EPISTEMOLOGY at registration):**
  - probe kill: q̂ ≤ 0 with t ≤ −1, or prediction contradicted (including
    the ~0-entries outcome: dead mechanism, distill the lesson)
  - main advance: t ≥ 2 on primary cell (lineage_cells=1, p-bar 0.023) +
    battery pass + bias classification not simulator-favored
  - holdout confirm: t ≥ 2 on holdout alone
- **Latency curve points:** delay ∈ {0, 150, 300}, jitter 0

## Runs (append-only)

## Verdicts (append-only)
