# EXP-001 — expiry certainty discount

## Spec

- **Registered:** 2026-07-09 (commit: the first commit touching this file — the
  validator checks it against run creation times)
- **Idea:** IDEAS.md entry 1 "Expiry certainty discount"  **Parent lineage:** none
- **lineage_cells:** 1
- **Mechanism class:** `tail-overpricing`
- **Hypothesis (who loses and why):** Holders of the near-certain winning side
  sell out at 0.90-0.99 in the final minutes to avoid redeem friction (gas,
  capital lockup, workflow), and late hedgers must cross the spread. Their
  urgency is structural, so the near-certain side trades below its true
  probability of winning. If false, the realized win rate of the >= 0.9-ask
  side bought late will not exceed its price.
- **Falsifiable prediction:** Among entered markets in the probe, the realized
  win rate exceeds the mean entry ask (win rate > mean(entryAsk) from
  intent_meta), and gross EV per entered market is positive before fees. If
  win rate <= mean entry price, the mechanism is contradicted regardless of
  net PnL. Secondary diagnostic: the entry should fire in a substantial
  fraction of markets (a >= 0.9 ask in the last 3 minutes is common); a tiny
  entered-count makes the probe unable to kill and must be treated as a
  design failure, not evidence.
- **Strategy:** `fable-lab/strategies/tail-overpricing/EXP-001.ts`, id `fable-exp-001`
- **Primary parameter cell:** `--param entryAfterSec=720 --param minAsk=0.9
  --param maxAsk=0.99 --param shares=100`
- **Robustness neighborhood:** entryAfterSec ∈ {600, 720, 840} × minAsk ∈
  {0.85, 0.9, 0.95}, other params fixed (shares is scale-invariant in q;
  maxAsk fixed at 0.99). Judged on sign-smoothness only.
- **Simulator-bias exposure (CAPABILITIES §4):** Taker-only FOK entries at
  visible depth, no maker fills, no split/merge — the edge, if measured,
  sits on the PESSIMISTIC side of the simulator (156 bps taker fee charged,
  worst-queue irrelevant, no market impact assumed but size is clamped to
  quoted depth). One optimistic dependency is intrinsic to the mechanism:
  settlement credits the full $1 with zero redeem cost/timing, i.e. the
  simulator pays us exactly the friction the counterparty is paying to
  avoid. A confirmed verdict therefore still requires live paper validation
  with real redeem costs measured.
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

- 2026-07-09 — VOID (no DB row): first probe launch executed under ambient
  `.env` `BACKTEST_LATENCY_DELAY=140` (discovered mid-run via EXP-002 smoke
  diagnostics; DECISIONS D8, LESSONS E7). Killed at ~365/500 before the
  sequential run persisted anything. No results were read. Relaunched with
  pinned `BACKTEST_LATENCY_DELAY=0 BACKTEST_LATENCY_JITTER=0`.

- 2026-07-10 — robustness neighborhood COMPLETE (8 cells, each N=2000
  `--random` within the exploration window per DECISIONS D11; latency
  pinned 0/0). Two 0.95-column cells were lost twice to the E13/D12
  quality-column overflow (runs 315, 318, 320 voided — nothing persisted)
  and re-ran on the fixed clamp (U23). `battery.ts --exp EXP-001` grid
  rows, verbatim (EV/mkt, q, t at N=2000):

  ```
  313  e600-a085  EV=+0.9757  q=+0.0411  t=+1.837
  314  e600-a090  EV=-0.8343  q=-0.0342  t=-1.530
  325  e600-a095  EV=-0.8279  q=-0.0404  t=-1.808
  317  e720-a085  EV=-0.3239  q=-0.0155  t=-0.6916
  324  e720-a095  EV=-0.7457  q=-0.0413  t=-1.845
  319  e840-a085  EV=+0.2141  q=+0.0164  t=+0.7312
  322  e840-a090  EV=-0.1360  q=-0.0099  t=-0.4419
  321  e840-a095  EV=-0.4575  q=-0.0343  t=-1.5331
  ```

  Shape note (Scientist, pre-verdict): 6 of 8 neighbors negative; the
  minAsk=0.95 column — where the redeem-friction mechanism should be
  STRONGEST — is uniformly negative (t −1.5..−1.8). Smoothness is
  fail-leaning; the decisive primary read is the pending full-window main
  extension of run 301.

- 2026-07-10 — MAIN: run 301 extended to the full exploration window
  (`--extend 301 --to-ms 1777237200000`, latency pinned 0/0). Decisive
  readout, verbatim:

  ```
  === results: run 301  batch EXP-001-probe ===
  strategy fable-exp-001  params {"maxAsk":0.99,"minAsk":0.9,"shares":100,"entryAfterSec":720}
  status completed  mode telonex-delta/delta-typed/local-or-download-from-r2-to-local
  N=13977  played=11121  skipped=2856  failures=0
  pnlTotal=-2713.44  EV/market=-0.1941  CI95=[-0.5245, 0.1362]
  std=19.9277  q=-0.0097  t=-1.1517
  winRate(played)=0.9315 (10359/761)
  fees=1001.2  fee/grossWins=0.0178  maker/taker=0/11157 (makerShare=0)
  days=148  positiveDayFrac=0.4662  best=2026-02-16:457.39  worst=2026-02-13:-965.48
  ```

  Prediction check (`entry-check.ts --exp EXP-001 --run 301`): entered
  11121, mean entry ask 0.9323, win rate 0.9316, margin −0.0007, gross
  EV/share −0.00070 — PREDICTION CONTRADICTED. Buckets: 0.90-0.92 →
  0.900 (n=5877); 0.92-0.94 → 0.937 (1092); 0.94-0.96 → 0.929 (438);
  0.96-0.98 → 0.965 (1022); 0.98-1.00 → 0.985 (2692) — every bucket on
  the diagonal.

- 2026-07-10 — latency curve, full window (N=13977 each), verbatim rows:

  ```
  main/lat0: EV=-0.1941  q=-0.0097  t=-1.1517  (played 11121)
  326  EXP-001-lat150  EV=-0.1572  q=-0.0086  t=-1.0214  (played 8794)
  327  EXP-001-lat300  EV=-0.1359  q=-0.0077  t=-0.9064  (played 8275)
  ```


## Verdicts (append-only)

- 2026-07-09 — run 301, batchUid `EXP-001-probe`, N=379 (of the registered
  500: the launcher process received a session-level SIGTERM at ~379/500;
  truncation is exogenous and content-blind — a random sample truncated at a
  random position is a random sample of size 379; judged as-is per DECISIONS
  D9). Latency pinned DELAY=0/JITTER=0 (D8). Decisive readout, verbatim:

  ```
  === results: run 301  batch EXP-001-probe ===
  strategy fable-exp-001  params {"maxAsk":0.99,"minAsk":0.9,"shares":100,"entryAfterSec":720}
  status completed  mode telonex-delta/delta-typed/local-or-download-from-r2-to-local
  N=379  played=231  skipped=148  failures=0
  pnlTotal=735.24  EV/market=1.9399  CI95=[0.7054, 3.1745]
  std=12.2624  q=0.1582  t=3.0799
  winRate(played)=0.9697 (224/7)
  fees=22.24  fee/grossWins=0.0173  maker/taker=0/267 (makerShare=0)
  days=136  positiveDayFrac=0.7794  best=2026-01-20:47.78  worst=2026-02-24:-169.89
  worst5: btc-updown-15m-1771960500:-90  btc-updown-15m-1769004900:-90  btc-updown-15m-1771954200:-89.72  btc-updown-15m-1770012900:-88.62  btc-updown-15m-1776734100:-88.62
  best5:  btc-updown-15m-1771796700:10.83  btc-updown-15m-1774835100:10.81  btc-updown-15m-1773681300:10.81  btc-updown-15m-1769231700:10.78  btc-updown-15m-1772978400:10.53
  ```

  Prediction check (`tools/entry-check.ts --exp EXP-001 --run 301`), verbatim:

  ```
  entered markets: 231
  mean entry ask:  0.9343
  win rate:        0.9697  (224/231)
  win rate − mean ask: 0.0354
  gross EV/share (pre-fee): 0.03540
  PREDICTION HOLDS: win rate > mean entry ask AND gross EV > 0

  ask bucket -> win rate (n):
    0.90-0.92: 0.955 (112)
    0.92-0.94: 0.964 (28)
    0.94-0.96: 1.000 (15)
    0.96-0.98: 1.000 (16)
    0.98-1.00: 0.983 (60)
  ```

- 2026-07-09 — stage probe, fresh-context Judge (JUDGE.md), verbatim:

  - stage: probe
  - decision: advance
  - read: N=379 q=0.1582 t=3.0799 EV/market=1.9399 CI95=[0.7054, 3.1745]
  - prediction check: HELD — realized win rate 0.9697 (224/231) > mean entry
    ask 0.9343 (margin +0.0354), gross EV/share pre-fee 0.03540 > 0;
    secondary diagnostic also satisfied: entry fired in 231/379 = 61% of
    markets, a substantial fraction, so the probe had killing power.
  - battery: n/a at probe (spec runs the robustness battery, latency curve,
    and smoothness neighborhood at Stage 2 main).
  - simulator-bias classification: clean — makerShare=0 (0/267 maker/taker),
    all fills are taker FOK at visible depth with the 156 bps taker fee
    charged (fees=22.24, fee/grossWins=0.0173), which per CAPABILITIES §4 /
    D6 sits on the pessimistic side of the simulator; the one intrinsic
    optimistic dependency (zero-cost, instant settlement credit) is
    pre-declared in the spec and deferred to live paper validation at
    confirmation, not a probe-stage disqualifier.
  - lineage-adjusted bar: lineage_cells=1 → no Bonferroni inflation; the
    decisive bar stays p ≤ 0.023 (t ≥ 2) for Stage 2/3. The probe itself
    only requires q̂ > 0 with no kill trigger; observed t=3.08 would clear
    even the Stage-2 bar, though a probe cannot confirm.
  - required next step: Stage 2 main — `--extend` run 301 to the full
    exploration window (market_start_ms < 1777237200000) with pinned latency
    env, then run the robustness battery (±1-step neighborhood, latency
    curve {0,150,300}, time stability, composition).
  - reasoning: Neither kill condition fires: q̂=0.1582 is positive with
    t=3.08 (nowhere near t ≤ −1), and the spec's falsifiable prediction
    holds mechanically — buyers of the ≥0.90-ask side late in the window won
    96.97% of entered markets against a mean entry ask of 0.9343, positive
    gross EV before fees, with every ask bucket at or above ~0.955. The
    iterate branch does not apply because there is no diagnosable PnL leak:
    fees are 1.7% of gross wins, fills are symmetric taker entries, and the
    entered fraction (61%) is healthy. The N=379-vs-500 truncation is
    exogenous and content-blind, so it degrades power slightly without
    biasing the sample, and no number required by the probe rules is missing
    from the readout. The one caution is exactly what §3 warns about — a
    probe cannot confirm, the tail-heavy loss profile (worst5 near −90 per
    market vs best5 near +10.8) means the estimate leans on the win-rate
    margin holding up over thousands of markets, and skipped-as-zero is
    already baked into q — so the correct spend is more data at Stage 2, not
    belief now. Evidence is unambiguous on the probe's own rules: advance.

- 2026-07-10 — stage main, fresh-context Judge (JUDGE.md), verbatim:

  - stage: main
  - decision: kill
  - read: N=13977 q=-0.0097 t=-1.1517 EV/market=-0.1941 CI95=[-0.5245, 0.1362]
  - prediction check: CONTRADICTED — realized win rate 0.9316 (10360/11121)
    vs mean entry ask 0.9323, margin −0.0007; gross EV/share pre-fee
    −0.00070 ≤ 0. The tool itself prints "PREDICTION CONTRADICTED". The
    bucket that should carry the mechanism, 0.90–0.92 (n=5877, the bulk of
    entries), pays exactly its price: win rate 0.900 at asks 0.90–0.92 —
    the certainty discount does not exist where most of the volume is.
  - battery: smoothness — FAIL (6 of 8 neighbors negative; the minAsk=0.95
    column, where redeem-friction should be strongest, is uniformly
    negative at t −1.5..−1.8; the only positive cells, e600-a085 t=+1.837
    and e840-a085 t=+0.731, are non-adjacent islands below the primary's
    minAsk — sign flips erratically, which per EPISTEMOLOGY §5.1 is noise
    regardless of t). Latency curve — pass in the narrow sense (no cliff
    between 0 and 150ms: EV −0.1941 → −0.1572 → −0.1359; it improves with
    latency only because latency suppresses entries into a negative-EV
    trade). Day stability — FAIL (positiveDayFrac 0.4662 over 148 days:
    losing more days than winning; worst day −965.48 vs best +457.39).
    Composition — pass (maker/taker 0/11157, makerShare=0, fee/grossWins
    0.0178, failures=0; loss is not a fee or fill artifact).
  - simulator-bias classification: clean — 100% taker FOK fills at visible
    depth with the 156 bps taker fee charged; per the spec's own exposure
    statement this sits on the pessimistic side of the simulator, so the
    negative read cannot be blamed on simulator generosity. The one
    optimistic dependency (free instant settlement) would only make live
    results worse than this.
  - lineage-adjusted bar: lineage_cells=1 → no Bonferroni inflation; the
    bar stays t ≥ 2 (p ≤ 0.023). Observed t=−1.1517 — not met; it is on the
    wrong side of zero and additionally satisfies the kill trigger (q̂ ≤ 0
    with t ≤ −1).
  - required next step: append this kill to the spec's Verdicts and distill
    the mechanism-level lesson (late ≥0.90 asks are efficiently priced net
    of fees) into LESSONS.md; any interest in the a085 corner requires a
    new registration carrying the lineage's 9 inspected cells as
    `lineage_cells`.
  - reasoning: The main stage triple-fails: t=−1.15 is nowhere near the +2
    advance bar; the kill condition fires outright (q̂=−0.0097 ≤ 0 with
    t=−1.15 ≤ −1, active evidence of negative edge); and the mechanism's
    own falsifiable prediction is mechanically contradicted at 29× the
    probe's entered sample — win rate 0.9316 against mean ask 0.9323 means
    the market prices the near-certain side almost exactly at its realized
    probability, leaving the 156 bps taker fee as pure loss (fees=1001.20
    against pnlTotal=−2713.44, with the rest being the win-rate shortfall
    in the dominant 0.90–0.92 bucket). The probe's earlier +1.94 EV,
    t=3.08 read on N=379 should be concluded to be sampling noise
    concentrated in a lucky slice — its 0.94–0.98 buckets showed impossible
    1.000 win rates on n=15–16, and the full window regresses every bucket
    toward its ask; this is precisely the failure mode §3 warns a probe
    cannot rule out, and the two-stage design caught it exactly as
    intended. The iterate branch does not apply: there is no diagnosable
    implementation leak (fees are 1.8% of gross wins, entries are symmetric
    taker FOKs, failures=0) — the mechanism itself is absent, and the
    neighborhood grid confirms it is absent most strongly where the
    hypothesis predicts it should be strongest (minAsk=0.95). Nothing here
    is ambiguous, but were it ambiguous, the tie would go against
    advancement anyway. Kill.

## Erratum (2026-07-10, U50 — appended post-verdict; verdicts above are unmodified)

The global holdout-lock audit (`knowledge/HOLDOUT-LOCK-AUDIT-2026-07-10.md`,
tool `tools/holdout-lock-audit.ts`) found that every full-window run in this
lineage deterministically included the boundary market
`btc-updown-15m-1777237200` (the FIRST holdout market), because the sample
rule's `--to-ms 1777237200000` is an inclusive bound (LESSONS E18 — this
erratum extends E18's scope from the EXP-006..009 random pools to this
lineage, where inclusion was certain, not a ~3.5% draw chance):

- run 301 (main, N=13,977 = 13,976 exploration + this market): the boundary
  market ENTERED with 1 taker fill — its outcome is inside the published
  main readout (EV=−0.19, t=−1.15, win rate 0.9316).
- runs 326/327 (lat150/lat300): replayed it with zero fills (zero-PnL
  contribution to the battery aggregates).
- probe snapshot (N=379): indeterminate — run 301 was extended in place
  (known-unverifiable per the U32 audit); moot, as the probe's advance was
  superseded by the main kill.

Materiality, bounded WITHOUT reading the market's outcome (reading its PnL
would itself be a holdout-outcome read): shares=100 at ask ≤ 0.99 bounds
|PnL| ≤ 100, so removing it shifts EV/market by ≤ 100/13,977 ≈ 0.007
(CI half-width ≈ 0.33) and win rate by ≤ 1/13,977. No branch of the decision
rule changes under either sign of its outcome. **The kill stands.**
