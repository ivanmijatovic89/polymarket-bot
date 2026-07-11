# SIGNAL-FILLS — SIGNAL-003, the per-fill toxicity scan (IDEAS #22)

_Registered session 64 (U99), 2026-07-11. Motivating evidence (governor):
E29 — run 472's ungated DOWN at-touch cell breaks exactly even (q̂=+0.0033,
t=+0.07, N=500, 479 played), so the fill population averages ~zero; if ANY
tick-observable pre-fill state predicts fill toxicity, its complement is
positive-EV by arithmetic. Run-472's DB grain is exhausted (U97: 1 trade
per market, bands/seasonality noise) — the instrument must log state AT
each simulated fill. This is the only maker direction that satisfies the
E29-raised EDGE-SPACE §4 bar, and it is falsifiable: a null closes the
maker family for good._

## 0. Epistemic grade

**Map-grade** (SIGNAL-MAP §0 conventions apply verbatim): outputs are
hypothesis-generating, gross-of-costs, uncitable. A candidate licenses a
mechanically derived complement gate that must then survive a **fresh D49
screen on a NEW sample** (E26c winner's-curse discount in sizing — the
measured dilution precedent is ~8×). This scan is outcome-USING (per-fill
PnL is the target), so the CAL discipline binds: method + cells + bars
frozen in this commit BEFORE any real log line or outcome is read;
discovery window only; ONE-SHOT read after all shards complete and the
coverage accounting is clean.

## 1. Instrument

`strategies/_fixtures/diag-fill.ts` (`fable-diag-fill`): replays the EXACT
run-472 SCR-008 cell — ungated DOWN-side at-touch bid, hardcoded frozen
params (30-870s window, requote at 1c drift, price bounds [0.02, 0.98],
inventory cap 100, size 100) — and emits one `[diag-fill]` line per own
fill. Outcome-free: no PnL read or logged; `tools/signal3-scan.ts` joins
`telonex_markets.result_id` ONCE at the one-shot read.

**Causality (the load-bearing property):** `StrategyRunner.onMarketTick`
drains execution fill events BEFORE the strategy sees the fill-triggering
tick (StrategyRunner.ts:174-180 vs :296), so the state block logged at
fill time is the last tick a live strategy could have ACTED on (canceled
the quote). Known optimism, disclosed: acting on it live costs one cancel
latency; runs are pinned DELAY=0/JITTER=0 (D8/D51), so a candidate gate's
fresh screen must consider latency sensitivity before any escalation.
Fill-triggering-tick state is deliberately NOT logged — nothing in this
scan may depend on information that arrives simultaneously with the fill.

**Fill model:** touch_or_better (D18) — the same optimistic bound as run
472. D18 rules bind downstream: gates found here feed screens whose
outcome set is {kill, escalate}, never advance/live-EV.

## 2. Sample (frozen)

- Universe: ALL 8,516 discovery-window markets
  (`market_start_ms < 1772323200000` = 2026-03-01T00:00Z), the same window
  as SIGNAL-001. Reserve and holdout untouched. Boundary market moot
  (all markets predate it).
- Runs: 6 disjoint local shards, batchUids `SIGNAL-003-touch-s[0-5]`
  (`touch` label per D18 guard), `--sequential --fill-mode
  touch_or_better`, latency pinned 0/0 (D51 enforces). Shard disjointness
  verified at launch via loaded-market counts summing to 8,516.
- **Primary sample:** FIRST fill per market (`fillSeq=0`), `fLiq=MAKER`,
  `fPrice ∈ [0.02, 0.98]`, resolved market (`result_id ∈ {0,1}`). One
  observation per market → independence across observations is clean.
  Later fills and non-maker first fills are counted and excluded
  (run 468 measured 0 taker fills at pinned latency; the count is a
  cross-check). Rows with `qAgeSec=-1` (requote-race attribution
  sentinel) stay in the primary sample but are excluded from the
  `qAgeSec`/`qMidDrift` tests only.
- **Target:** residual r = wonDown − fPrice per fill (DOWN buy held to
  settlement; maker fee 0 in the engine model — same convention as the
  run-472 economics).

## 3. Features (21, all causal at the last pre-fill tick)

Book state: `spread` (dnAsk−dnBid), `l1Imb`, `l5Imb`, `l10Imb` (UP-book
depth imbalance; DOWN is an exact mirror, CAL-001 am. #12), `dTot5`,
`dTot10`. Quote-derived: `qAgeSec` (fill time − quote placement),
`qMidDrift` (pre-fill UP mid − mid at quote placement — the drift INTO the
fill). Activity/path (diag-signal conventions): `nTicks`, `rate60`, `vol`,
`nz`, `flips`, `range`, `posR`, `move60`, `move10` (new: 10s mid move —
sweep precursor at fill horizon), `firstMid`, `firstTs`, `crossedN`.
Timing: `fElapsed` (fill time in window).

## 4. Frozen statistics

1. **Monotone screen (primary):** per feature — Spearman rank-correlation
   of feature vs residual within fill-price strata LO [0.02,0.35) /
   MID [0.35,0.65] / HI (0.65,0.98] (strata with n ≥ 200 only), z_p =
   ρ·√(n−1), Stouffer-combined with w = √n. k = 21. **CANDIDATE
   |z| ≥ 3.50** (Bonferroni α ≈ 0.01: 0.01/21 two-sided → z=3.49), WARM
   |z| ≥ 3 (recorded, not candidate).
2. **Cell grid (shape readout):** feature quintiles (rank-based) within
   (stratum, feature); d = mean residual, z under the scan-se convention
   (empirical sd). k ≈ 315 evaluated cells (n ≥ 30). **CANDIDATE
   |z| ≥ 4.20** (0.01/354 incl. seasonality → z=4.19). Non-monotone
   shapes can appear here without a monotone flag; both bars stand
   independently.
3. **Fill seasonality:** hour-of-day (six 4h UTC bins) and day-of-week
   cells per stratum; same cell bar 4.20.

**Gates (abort before any table):** G1 join-direction (fills with
fPrice ≥ 0.90, n ≥ 30, must win > 75%; vacuous-if-underpowered is
disclosed, not fatal). G2 global zero anchor (|z| of overall mean residual
< 6 — E29 measured ≈ 0; a large global deviation is a parse/join bug, not
a discovery).

**Multiplicity honesty:** three families at family-wise Bonferroni ~0.01
each (joint ~0.03). Features are mutually correlated (vol/nz/flips/range;
depth levels) — Bonferroni is conservative under that dependence. A
monotone candidate lighting its extreme quintile cells is ONE finding.

**Tool:** `tools/signal3-scan.ts`; selftest `tools/signal3-selftest.ts`
(17 assertions green pre-freeze: hand-counted filter accounting incl. the
sentinel row, planted zero-mean monotone toxicity detected as CANDIDATE
with correct sign, noise feature quiet, G1 flip abort, G2 shifted-join
abort, --outcomes refusal). The selftest's planted world IS the E29
hypothesis: global mean ~0 while one feature separates good from bad
fills — the instrument provably detects exactly what it hunts.

## 5. Power (stated up front)

Expected primary n ≈ 8,100 (95.8% of markets played in run 472 × 8,516;
one fill per market). Monotone screen at n ≈ 8,000 resolves |ρ| ≳ 3.5/√n
≈ 0.039 — on a residual sd of ≈ 0.5 that is roughly a 4c PnL spread
across the feature's range, comfortably below the ~1.2c/fill gross that
would already be economically interesting at the E29 zero anchor. A
MID-stratum quintile cell (n ≈ 500 if MID holds ~30% of fills) resolves
|d| ≳ 4.2·0.5/√500 ≈ 9.4c — single cells are coarse; the pooled monotone
screen is the sensitive instrument. Dead zones below these resolutions
remain formally open.

## 6. Pre-committed interpretation

- **Zero candidates in all three families** → fill toxicity in the
  run-472 cell is unpredictable from causal tick state at stated power →
  **the maker family closes for good** (IDEAS #22 → dead; EDGE-SPACE
  maker bar becomes a closure statement; the E29 equilibrium reading
  stands as the family's tombstone). No further maker screens without an
  operator-side instrument change (queue-realistic fill model) or a
  D27-confirmed venue-drift fire.
- **Candidate(s) whose adverse side is tick-avoidable** → the complement
  gate is derived MECHANICALLY (frozen rule: gate = exclude the adverse
  sign side / adverse extreme quintiles of the candidate feature — no
  post-hoc cell shopping; the gate cell is the candidate's complement,
  nothing else), then registered as a D49 screen on a NEW sample
  (post-discovery markets or a fresh random draw from the reserve-free
  region), sized with the E26c winner's-curse discount. D18 outcome set
  applies (kill/escalate).
- **Candidates in a non-gateable direction** (e.g. seasonality-only, or
  a feature whose complement empties the fill population) → recorded as
  dead zones with sign; aiming value "avoid".
- The E29 zero is the arithmetic anchor: if a candidate's adverse cell
  averages −x on fraction p of fills, the complement averages
  +px/(1−p) BEFORE the winner's-curse discount — that number goes in the
  screen's prediction line.

## 7. Results (append-only, written after the one-shot read)

_(empty until all shards complete + coverage accounting clean)_
