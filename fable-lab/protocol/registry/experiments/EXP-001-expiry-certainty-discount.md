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
