# Family: pair-v11 (liquidity-structure market selection) — E-022 Phase 0

Ruling axis 6 (inbox 8758567d): select MARKETS by liquidity structure
(spread, depth, oscillation so far) rather than spot-vs-priceToBeat.
Distinct from E-012 (pair-v3), which tested per-START doom prediction
from price state at fill time and found doom unpredictable — this asks
whether whole MARKETS differ in v1-profitability in ways visible in the
book's early-window character, before any entry.

## E-022 Phase-0 pre-registration (session 10, BEFORE any analysis)

**Claim to test**: per-market v1 pnl (run 872, pinned 800) is
predictable from book features measured in the market's FIRST 3 minutes
(= v1's start region; features computable at decision time, no
lookahead: every v1 first-entry happens at/after the first crossing, and
a selection gate would act before entering).

**Method** (reanalysis, no new strategy code, no fleet runs):

1. Tool: extend bookscan.ts or a new `tools/mktselect.ts` — replay each
   of the 800 pinned parquet files; over minutes 0–3 compute the frozen
   feature set:
   - F1 mean two-sided spread (avg of both assets' bestAsk−bestBid)
   - F2 mean top-of-book depth (bestBid size + bestAsk size, both sides)
   - F3 book-sum level (mean bestAsk_up + bestAsk_down — richness)
   - F4 oscillation count (number of direction changes of up-side
     bestBid over 0–3 min)
   - F5 quote intensity (book+price_change events per second)
2. Join per-market F1–F5 to run 872's per-market pnl + doom flag
   (residue≠0) via `backtest_run_markets` (872 played 704 of these 800).
3. **Split-half guard (frozen now)**: markets sorted by slug epoch;
   ODD-indexed half = exploration (buckets, trends), EVEN-indexed half =
   confirmation. A feature only counts if its exploration-half bucket
   trend (quintile ev, monotone or single-peak) REPRODUCES in sign on
   the confirmation half.
4. Economics bar (same spirit as E-012): a selection rule must yield a
   subset with ev ≥ 0 on BOTH halves at ≥ 25% retention (≥ ~180 mkts of
   704 — below that, goal 1's $/day cannot be carried and thin subsets
   are noise), measured against per-subset SE.

**Pre-registered verdicts**:
- PROCEED to strategy code (a `minDepth`/`maxSpread`-style gate on v1)
  only if some frozen feature passes the split-half + economics bar.
- KILL axis-6-Phase-0 if no feature reproduces across halves — scope:
  these 5 features, this universe; a different feature family (e.g.
  cross-market or time-of-day) would need its own pre-registration.
- Confounders pre-committed: (a) features are window-start measurements
  — regime drift within the 9-day window is folded in, per-day breakdown
  reported; (b) run 872's pnl includes latency/fill-model effects (guard
  6) — a selection gate inherits them symmetrically, safe for a kill,
  optimistic-neutral for proceed; (c) 5 features × 2 halves is small
  enough to bound fishing, but ANY post-hoc feature added after seeing
  data invalidates this pre-registration (write E-022b instead).

design-ts (E-022): this commit, session 10 — before any feature is computed.
