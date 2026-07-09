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

- 2026-07-09 — run 309, batchUid `EXP-003-probe`, N=500, latency pinned
  DELAY=0/JITTER=0 (D8). Decisive readout, verbatim:

  ```
  === results: run 309  batch EXP-003-probe ===
  strategy fable-exp-003  params {"maxAsk":0.85,"minAsk":0.15,"shares":100,"jumpSize":0.15,"jumpWindowSec":10,"maxElapsedSec":840,"minElapsedSec":30}
  status completed  mode telonex-delta/delta-typed/local-or-download-from-r2-to-local
  N=500  played=368  skipped=132  failures=0
  pnlTotal=-736.04  EV/market=-1.4721  CI95=[-4.1886, 1.2445]
  std=30.9919  q=-0.0475  t=-1.0621
  winRate(played)=0.5679 (209/159)
  fees=144.38  fee/grossWins=0.0278  maker/taker=0/368 (makerShare=0)
  days=146  positiveDayFrac=0.4589  best=2026-03-03:146.51  worst=2026-01-01:-156.41
  worst5: btc-updown-15m-1765462500:-79  btc-updown-15m-1768572000:-77  btc-updown-15m-1766085300:-77  btc-updown-15m-1769187600:-76  btc-updown-15m-1767526200:-75
  best5:  btc-updown-15m-1768428900:76.44  btc-updown-15m-1772093700:72.44  btc-updown-15m-1770523200:67.97  btc-updown-15m-1775186100:67.44  btc-updown-15m-1772512200:64.44
  ```

  Prediction check (`tools/entry-check.ts --exp EXP-003 --run 309`): entered
  368, mean entry ask 0.5679, win rate 0.5679 (209/368), margin +0.0001,
  gross EV/share +0.00005 — technically "holds" but degenerately (exactly on
  the diagonal); per-bucket win rates are noisy around fair pricing.


## Verdicts (append-only)

- 2026-07-09 — stage probe, fresh-context Judge (JUDGE.md), verbatim:

  - stage: probe
  - decision: kill
  - read: N=500 q=-0.0475 t=-1.0621 EV/market=-1.4721 CI95=[-4.1886, 1.2445]
  - prediction check: Held, but only degenerately — win rate 0.5679 vs mean
    entry ask 0.5679 (win rate − mean ask = +0.0001; gross EV/share =
    +0.00005 pre-fee). The spec's prediction ("win rate exceeds the mean
    entry ask, gross EV/share > 0") is technically satisfied, not
    contradicted; but the margin is indistinguishable from zero, meaning
    post-jump asks price the jump direction almost exactly fairly.
  - battery: n/a at probe (spec runs the battery at Stage 2 only)
  - simulator-bias classification: clean — maker/taker = 0/368
    (makerShare=0), taker-only FOK entries clamped to visible depth at the
    highest fee zone (156 bps mid-range), no maker-fill or settlement
    optimism doing the work; if anything the sim is on the pessimistic side
    here.
  - lineage-adjusted bar: lineage_cells=1, so no Bonferroni adjustment —
    advance bar stays t ≥ 2 and kill bar stays t ≤ −1. The kill bar was met
    (t = −1.0621 ≤ −1 with q̂ = −0.0475 ≤ 0).
  - required next step: Append this verdict to EXP-003's Verdicts section
    and park the lineage; any successor needs a new falsifiable insight
    (the finding "jump direction is priced fairly at the post-jump ask" is
    the transferable lesson), and note that the prediction was NOT
    contradicted, so this result does not fund the IDEAS entry 6
    overreaction flip either.
  - reasoning: The spec's probe kill rule is disjunctive — "q̂ ≤ 0 with
    t ≤ −1, OR prediction contradicted" — and the first branch fires
    cleanly: q̂ = −0.0475 with t = −1.0621 is active evidence of negative
    edge on the deployment-honest statistic (skipped-as-zero, 132 of 500).
    The prediction check points the other way on its face, but resolving
    per the spec's own text, holding the mechanical prediction does not
    veto the kill branch; and substantively the prediction "held" by
    +0.0001 in win rate and +0.005 cents/share gross, which is the boundary
    case the hypothesis framed as decisive between "stale makers lose" and
    "jumps are noise" — the data lands exactly on the diagonal, supporting
    neither. That is the worst outcome for the mechanism: there is no gross
    edge for fees to leak from (368 taker fills at 156 bps mid-range fees
    turn a zero-gross trade into −1.47/market with only 45.9% positive
    days), so "iterate" — which requires a mechanism prediction that holds
    AND a diagnosable implementation leak — is not available; the leak is
    the absence of edge, not the implementation. Killing on a t of −1.06
    might be noise, but the kill bar is deliberately loose because
    resurrection is cheap, and the tie goes against advancement.
