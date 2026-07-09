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

- 2026-07-09 — run 308, batchUid `EXP-002-probe`, N=500, latency pinned
  DELAY=0/JITTER=0 (D8). Decisive readout, verbatim:

  ```
  === results: run 308  batch EXP-002-probe ===
  strategy fable-exp-002  params {"feeBps":156,"shares":100,"minEdge":0.002,"maxEntries":5}
  status completed  mode telonex-delta/delta-typed/local-or-download-from-r2-to-local
  N=500  played=0  skipped=500  failures=0
  pnlTotal=0  EV/market=0  CI95=[0, 0]
  std=0  q=null  t=null
  winRate(played)=null (0/0)
  fees=0  fee/grossWins=null  maker/taker=0/0 (makerShare=null)
  days=143  positiveDayFrac=0  best=2025-11-30:0  worst=2025-11-30:0
  ```

  Zero entries: the guarded condition (ask-sum < 1 − fees − minEdge, both
  books uncrossed) never fired across 500 random exploration-window markets.


## Verdicts (append-only)

- 2026-07-09 — stage probe, fresh-context Judge (JUDGE.md), verbatim:

  - stage: probe
  - decision: kill
  - read: N=500 q=null (std=0, played=0/500) t=null EV/market=0 CI95=[0, 0]
  - prediction check: CONTRADICTED. The spec's falsifiable prediction was
    that guarded net-of-fee dutch-book moments (gap ≥ 0.002/share at
    top-of-book, both books uncrossed) "occur in at least a handful of
    markets" across 500 probe markets. Observed: played=0, skipped=500,
    failures=0 — zero entries. The spec pre-registered this exact outcome as
    decisive: "If entered-market count is ~0, the mechanism is dead — that
    is itself the lesson."
  - battery: n/a at probe (spec runs the robustness battery at Stage 2
    only; no Stage 2 will occur)
  - simulator-bias classification: clean — there are no fills to be
    flattered by any simulator bias; the design was already on the
    pessimistic side (taker-only FOK clamped to visible top-of-book depth,
    156 bps modeled on both legs), and the one optimistic dependency the
    spec flagged (trusting recorded books to manufacture fake gaps) never
    activated because the E6 crossed-book guard plus the fee+minEdge
    threshold eliminated every candidate.
  - lineage-adjusted bar: lineage_cells=1 → unadjusted bar t ≥ 2
    (p ≤ 0.023). Not met and not evaluable: t is null because std=0 with
    zero trades; irrelevant to the decision, since kill fires on prediction
    contradiction, not on the t branch.
  - required next step: Distill the mechanism-death lesson into
    fable-lab/knowledge/LESSONS.md (citing EXP-002 run 308) — "top-of-book
    UP+DOWN never sums below 1 − 156bps − 0.002 in uncrossed books across
    500 random exploration-window BTC 15m markets" — and do not re-register
    this mechanism without a new falsifiable insight (e.g., depth beyond
    top-of-book, or a materially different fee regime).
  - reasoning: The spec's kill rule reads "prediction contradicted
    (including the ~0-entries outcome: dead mechanism, distill the
    lesson)", and 0/500 is not ~0, it is exactly 0 — the cleanest
    contradiction the design admits. This is not an ambiguous or
    missing-number situation triggering iterate: the entry count is the
    pre-registered decisive diagnostic, and it is present and unambiguous.
    Nor is it an implementation leak inviting iteration — the guard and
    threshold were part of the registered design (added before any decisive
    run, per the pre-registration note about self-crossed smoke artifacts),
    and the run completed with zero failures over 143 days of markets, so
    the machinery demonstrably scanned the condition and found nothing.
    Under skipped-as-zero accounting the strategy is exactly a no-op (EV=0,
    CI degenerate at [0,0]), which can never clear any t bar at any N;
    buying more data (Stage 2 extend) would spend the finite exploration
    universe measuring a condition already shown to fire 0 times in 500
    independent draws (95% upper bound on per-market firing rate ≈ 0.6%,
    and even those hypothetical rare firings would carry ~0.002/share
    edges — economically nil at N-scale). The market is internally
    consistent at top-of-book beyond fees, exactly the null the spec named;
    the honest output of this experiment is the lesson, not another run.
