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

## Result E-022 (session 11, 2026-07-31): KILL axis-6 Phase-0

Tool: `tools/mktselect.ts` (new; replays minutes 0–3 only via `shouldStop`,
time-weighted feature means — weighting chosen in code BEFORE any data was
seen, since the pre-registration did not freeze it). Universe: the pinned
800 (`--to-ms 1784762100000`, slugs 1784043000→1784762100), all 800 scanned,
799/800 with full 3-min coverage (1 market's recording missed the window —
its features are null and excluded). Join to run 872: 800/800 joined,
`evAllJoined = −1.5019` — exactly run 872's recorded headline ev, join
integrity confirmed. Archives:
`data/mktselect-2026-07-31-latest800.json` (analysis) + `.jsonl`
(per-market raw features). [run 872 reanalysis | 2026-07-31]

**Verdict per the frozen criteria: KILL.**

- **No feature reproduces**: every `trendReproduces = false`. Exploration
  trends were single-peak (F1/F3) or non-monotone (F2/F4/F5); none
  reproduced in shape or sign on the confirmation half.
- **Zero rules pass even exploration**: no contiguous quintile range on any
  feature reached ev ≥ 0 at ≥ 25% retention on the exploration half — the
  best single bucket anywhere is ev −1.02 (F5 Q3 exploration), ~4 SE below
  zero. The economics bar is unreachable on this universe: v1-a loses
  −1.42/−1.58 per market on the two halves and no early-book stratum
  escapes it.
- **Doom rate is flat across all book character**: 43–56% of played in
  every bucket of every feature, both halves — the market-level replication
  of E-012's start-level finding: doom is not predictable from observable
  liquidity state, early-window edition.
- **Feature degeneracy finding (transferable)**: F1 (spread) and F3
  (book-sum) are nearly constant across markets — quintile edges span
  0.0100–0.0102 / 1.0100–1.0102. The btc-15m book sits at 1-tick spread
  and ask-sum ≈ 1.01 essentially always in minutes 0–3, so spread/richness
  carry ~no cross-market information on this universe; F2 (depth,
  510–1375+ shares) and F5 (intensity, 178–277+ ev/s) DO vary and still
  showed nothing. Any future selection idea should not spend features on
  spread/book-sum at window start.

Scope of the kill (as pre-registered): these 5 features, this universe
(pinned 800, 2026-07-14→22), v1-family pnl as the target. A different
feature family (cross-market, time-of-day, spot-side features) would need
its own pre-registration (E-022b+). Confounders as pre-committed: per-day
ev reported in the archive (all 9 days negative, −0.09..−2.05, no day
carried by regime); guard-6 fill-model effects inherited symmetrically.

Consequence for the identity (`EV = completions·g − stranded·L_s`): axis 6
joins axes 1/2/3 as answered-negative on the v1 family — neither exit
policy (E-020b), nor price ceiling (E-019/E-021), nor market selection
(E-022) moves the doom term. Remaining in-rules levers: axis 4 (size
laddering), axis 5 (time-varying policy), and the unexplored HF regime
(market-context.md).
