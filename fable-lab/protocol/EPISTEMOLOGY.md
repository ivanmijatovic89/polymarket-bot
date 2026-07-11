# EPISTEMOLOGY — how much data buys how much belief

This file is the decision core of the Fable protocol. Every threshold below
is derived, not asserted; when an input to a derivation changes (measured
cost structure, universe size), recompute the threshold, don't defend it.

Grounding: all statistics named here are the engine's own persisted numbers
(`fable-lab/engine/CAPABILITIES.md` §6). No invented cost constants — costs
enter only through the simulator's measured output and sensitivity curves.

## 1. The unit of evidence

The unit of evidence is **one resolved market's PnL** (`backtest_run_markets.pnl`).
A BTC 15m episode is a natural experimental unit: fixed length, fresh
orderbook engine, fresh portfolio, outcome independent of our actions (no
market impact in sim). Episodes overlap in *regime* (adjacent windows share
the day's volatility), which is why holdout is chronological (DECISIONS D3),
but for variance arithmetic across thousands of windows the iid
approximation is serviceable — and it is the approximation under which the
engine's own `qualitySystem` is meaningful.

Primary statistic: **q = qualitySystem = mean(pnl) / std(pnl)** over ALL
markets in the sample, skipped markets counted as 0 (engine definition,
`src/backtest/stats/batchStats.ts:162-175`). Skipped-as-zero is the
deployment-honest choice: capital sits in the market whether the strategy
trades or not. `qualityTrade` (decisive markets only) is diagnostic, never
decisive.

Belief statistic: **t = q · √N** — the t-statistic of "mean per-market PnL
is positive". With N in the thousands, one-sided p ≈ Φ(−t):
t=2 → p≈0.023, t=3 → p≈0.0013.

(Implementation note: the engine's persisted `qualitySystem` divides by the
population std, while `tools/results.ts` — the decisive readout — uses the
sample std (n−1), the proper t-estimator. The gap is √(N/(N−1)), <0.1% at
N=500; decisions use the results.ts number.)

## 2. What effect size is worth resolving

q is scale-invariant in stake (doubling stake doubles mean and std). The
economically meaningful pair is (q, EV/market = q·std): q measures
statistical reliability, EV measures dollars. The protocol requires both:

- **Reliability floor**: t ≥ 2 at each decisive stage (justified in §4).
- **Economic floor**: the 95% CI of EV/market must exclude 0 *after* the
  stress battery (§5). No fixed dollar floor is set — that would be an
  invented constant; the floor is "positive with confidence, under
  pessimistic execution".

Detectable-effect table (q resolvable at t=2 for a given N):

| N markets | minimum detectable q |
|---|---|
| 500 | 0.089 |
| 1,000 | 0.063 |
| 3,000 | 0.037 |
| 6,000 | 0.026 |
| 12,000 | 0.018 |

(formula: q_min = 2/√N.) Read this table backwards to size a run: decide the
smallest q you would still care about, then buy that many markets. A
strategy whose plausible edge is q ≈ 0.03 cannot be judged on 1,000 markets;
running 1,000 anyway is theater.

## 3. The stages and what each decides

Compute is cheap relative to holdout data (local sequential replay measured
~1.1s/market for a no-op strategy on already-local data — EXP-000-wrapper
smoke, 2 markets / 2.2s; first-touch R2 downloads add to that; the *most
recent* markets are finite and burn on first read). Stages exist
to spend compute before belief and belief before holdout.

**Stage S (smoke)** — ≤10 markets, `--sequential`, on the developer's
machine. Decides: "does the code run, place intents, and produce per-market
rows". NEVER evidence; no PnL from a smoke may be quoted anywhere.

**Stage 1 (probe)** — ~500 markets, random sample within the exploration
window (rule-based selection recorded in the spec). Decides one of:
- **kill** — q̂ ≤ 0 with t ≤ −1 (active evidence of negative edge), or the
  mechanism's falsifiable prediction (spec field) is contradicted by the
  diagnostics. Killing on noise is cheap; resurrecting a good idea costs one
  re-registration, so the kill bar is deliberately loose.
- **iterate** — mechanism prediction holds but implementation leaks PnL in a
  diagnosable way (fees dominate, one-sided fills, dwell too long). New
  version, new probe. Max 3 iterations per mechanism without a *new*
  falsifiable insight → park (ledger rule, DECISIONS D5).
- **advance** — q̂ > 0 and the probe cannot rule the idea out at its plausible
  effect size.
A probe cannot *confirm* anything: at N=500 only q ≥ 0.089 is resolvable,
which per §2's table is a large edge. The probe's job is killing and
diagnostics, not belief.

**Skewed-payoff precision rule (added 2026-07-10, motivated by LESSONS
E14 / DECISIONS D13):** when a strategy's per-market payoff is strongly
asymmetric (win rate above ~0.9 or below ~0.1 — e.g. small wins vs
near-total losses), the probe's t is built almost entirely on the
minority-outcome events, not on N. EXP-001's probe read t=+3.08 on 231
entries but only 7 losses; the full window (761 losses) reversed the sign.
Rule: the probe verdict block must state the minority-outcome count; if it
is < 30, an "advance" is provisional by construction and the Judge must say
so — the advance is a decision to buy data, not a belief, and no language
implying measured edge ("strong probe", "edge confirmed at probe scale")
may enter the experiment file or STATE.

**Stage 2 (main)** — the full exploration window (every eligible market
older than the holdout boundary; thousands). Extends the probe run
(`--extend`, same run row, segments recomputed over the union). Decides:
- **advance to holdout** — requires ALL of: t ≥ 2 on the exploration window;
  robustness battery passed (§5); simulator-bias classification (DECISIONS
  D6) not `simulator-favored`, or explicitly escalated.
- **kill / iterate** otherwise, same rules as probe.

**Stage 3 (holdout)** — one-shot run on the pre-registered holdout window
(the most recent ~25% of the eligible universe at registration time,
boundary frozen as a `market_start_ms` in the spec). Decides:
- **confirmed** — t ≥ 2 on holdout alone. The strategy version is frozen
  forever (code freeze; any change = new experiment).
- **refuted** — anything else. The holdout is burned for this lineage:
  descendants of this strategy get a NEW holdout boundary (more recent
  markets that have accrued since), and the old holdout window joins their
  exploration window. No re-runs, no "adjusted" re-reads.

**Beyond backtest** — a `confirmed` verdict means "replayable edge under the
simulator's stated biases", not "deploy". The required next step is recorded
in the verdict: live paper validation (dry-run bot), sized by the same t
arithmetic on live fills. Out of scope for the backtest protocol but the
verdict field forces the handoff to be explicit.

## 4. Why t ≥ 2 twice, not t ≥ 3 once

Two independent chronological samples at t ≥ 2 give a joint false-positive
rate ≈ 0.023² ≈ 5×10⁻⁴ per candidate lineage — stricter than a single t ≥ 3
(p ≈ 1.3×10⁻³) and, unlike the single test, it specifically punishes
regime-fit: noise that survived exploration must independently recur in
later data. At ~50 advanced lineages a year, expected false confirmations
≈ 0.03/year. Raising bars further would mostly reject true small edges
(power at q=0.03 on a 5,000-market holdout is already only ~55% at t≥2 —
see table §2); the protocol prefers catching a false positive at live-paper
stage over never finding modest edges.

## 5. Multiplicity, grids, and the robustness battery

**Primary cell rule.** A spec registers exactly ONE primary parameter cell.
Advancement is decided on the primary cell only. Grids around it are allowed
for *robustness*, judged on shape, not for picking a winner.

**Promotion tax.** If the primary fails but a neighbor looks alive, that
neighbor may be re-registered as a new experiment, but the effective number
of cells k inspected in the current lineage travels with it (spec field
`lineage_cells`). Its future decisive tests require one-sided
p ≤ 0.023 / k (Bonferroni over the cells that had a chance to be picked) —
i.e. the t bar rises with every look. This makes silent grid-mining
mechanically expensive instead of forbidden-and-unenforced.

**Robustness battery (Stage 2, all from real runs, no invented constants):**
1. **Parameter smoothness** — the ±1-step neighborhood of the primary cell
   must not flip sign erratically; an edge that exists in one cell and
   vanishes in all neighbors is treated as noise regardless of its t.
2. **Latency sensitivity curve** — paired runs at
   `BACKTEST_LATENCY_DELAY ∈ {0, 150, 300}`, `JITTER=0` (determinism,
   CAPABILITIES §4). No single "true" latency is asserted; the verdict
   records the curve. An edge that dies between 0 and 150ms is flagged
   `latency-fragile` and cannot confirm without live measurement.
3. **Time stability** — from persisted daily segments: fraction of positive
   days, and worst weekly drawdown proxy (`streakMaxLosePnl`). No hard
   threshold; a cliff (all PnL from one week) blocks confirmation because it
   contradicts "durable".
4. **Composition diagnostics** — maker/taker split, fee share of gross PnL,
   skip rate, per-market PnL histogram shape (a few huge winners vs many
   small ones). Feeds the simulator-bias classification (DECISIONS D6):
   maker-fill-dominated PnL in thin books = `simulator-favored`.

## 6. Sample-selection rules

- Market samples are defined by RULE (window bounds + limit + random flag),
  recorded in the spec, executed via `listEligibleTelonexMarkets` semantics.
  Hand-picked slugs are allowed only in diagnostics and never in decisive
  statistics.
- Only resolved markets count (engine-enforced eligibility;
  CAPABILITIES §5). Skip/failure counts are part of every readout: a
  strategy whose eligible sample silently shrank is a red flag, not a detail.
- The exploration/holdout boundary is computed from the universe at
  registration time and written into the spec as an absolute
  `market_start_ms`. Markets that accrue after registration belong to no
  window until a later experiment registers them.

## 7. What gets remembered

Every decisive readout writes back to the experiment file (append-only):
run id, batch uid, N, q, t, EV/market with CI, robustness battery outputs,
verdict, and the judge's one-paragraph reasoning. Cross-experiment,
transferable knowledge (mechanism-level, not parameter-level) is distilled
into `fable-lab/knowledge/LESSONS.md` — one lesson per entry, each citing
the experiment ids that ground it. A lesson without an experiment citation
is an opinion and gets deleted.
