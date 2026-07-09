# EXP-003 — post-jump stale ladder

## Spec

- **Registered:** 2026-07-09 (commit: the first commit touching this file — the
  validator checks it against run creation times)
- **Idea:** IDEAS.md entry 3 "Post-jump stale ladder"  **Parent lineage:** none
- **lineage_cells:** 1
- **Mechanism class:** `stale-quote`
- **Hypothesis (who loses and why):** After a fast implied-probability jump,
  makers whose resting quotes lag the move sell the jump direction at prices
  that still reflect pre-jump probability. Their staleness is structural
  (repricing latency, inattention). If the jump is informative, the buyer of
  the jump direction wins more often than the post-jump ask implies. If
  jumps are noise (overreaction), the same trade loses — the two mechanisms
  make opposite predictions, so the probe decides between them cleanly.
- **Falsifiable prediction:** Conditional on a first UP-mid move of >= 0.15
  within <= 10s (with entry ask in [0.15, 0.85] and an uncrossed book —
  LESSONS E6 guard), the jump direction's realized win rate exceeds the mean
  entry ask (win rate > mean(entryAsk) from intent_meta, gross EV/share > 0
  pre-fee). Contradiction (win rate <= mean ask) is evidence for
  overreaction/noise — which would flip into fuel for IDEAS entry 6, not a
  re-parameterization of this experiment.
- **Strategy:** `fable-lab/strategies/stale-quote/EXP-003.ts`, id `fable-exp-003`
- **Primary parameter cell:** `--param jumpSize=0.15 --param jumpWindowSec=10 --param minAsk=0.15 --param maxAsk=0.85 --param minElapsedSec=30 --param maxElapsedSec=840 --param shares=100`
- **Robustness neighborhood:** jumpSize ∈ {0.10, 0.15, 0.20} × jumpWindowSec ∈
  {5, 10, 20}; other params fixed; judged on sign-smoothness only.
- **Simulator-bias exposure (CAPABILITIES §4):** Taker-only FOK entry clamped
  to visible depth at bestAsk — pessimistic side (156 bps taker fee at
  mid-range prices is the HIGHEST fee zone, E3: ~4-9× the tail zone; no
  maker assumptions; no market impact assumed but size clamped to quoted
  depth). Optimistic dependencies: costless settlement; and recorded-book
  trust — a stale ladder that exists only in the recording (WS gap) would
  manufacture fills; the E6 crossed-book guard plus the probe's entry-price
  distribution diagnostic address this.
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

## Verdicts (append-only)
