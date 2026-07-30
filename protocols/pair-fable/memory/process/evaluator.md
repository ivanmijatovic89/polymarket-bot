# Evaluator — the pair-fable evaluation system

Status: COMPLETE — units by PLAN `metrics-and-capital-units`, stage pipeline /
promotion criteria / guards by PLAN `evaluator-design` (2026-07-30, dry-run on
the pair-v0 family, runs 863–870). Everything here is evidence-tagged. A fresh
session evaluates a variant by following §Stages verbatim; `tools/evaluate.ts`
computes the verdicts.

## Scope guard (when these formulas are valid)

The unit formulas below rely on `backtest_run_markets.cost` being the total
invested capital. That equality holds **only** for strategies that:

1. never SELL (RULES rubric 1 — realized proceeds reduce stored basis),
2. never emit `split_positions` (`split_cost` must be 0),
3. never emit `merge_positions` in backtests (RULES backtest ban — a merge
   consumes shares and reduces basis mid-market).

Every pair-fable strategy satisfies all three by constitution. If a row shows
`split_cost != 0`, or a strategy variant sells, these formulas are WRONG for
it — recompute from `intent_meta` or reject the variant.

## Why cost == invested (verified, not assumed)

`Portfolio.applyFillToPosition` accumulates BUY cost basis as
`price*size + takerFeeUsdc` per fill (round2 per update) and nothing else
touches it for a no-sell strategy; backtest settlement is a pure valuation in
`computeMarketStats` — final positions are never mutated, so the stored
`cost` (= remaining cost basis at market end) is exactly the fee-inclusive
buy notional. [code src/trading/Portfolio.ts:672-692; src/backtest/stats/marketStats.ts:161-167,195 @ 1415c2b]

Empirical confirmation, multi-buy on BOTH sides incl. the WINNING side
(the case run 852 left open) — run 856 (pair-fable-probe-capital-v0,
3 markets, 22 taker fills, all outcomes UP, UP-heavy positions):

| slug (…-15m-) | avgUp×upSh + avgDn×dnSh | + fees_paid | stored cost | pnl check: merge+redeem−cost |
|---|---|---|---|---|
| 1775088000 | 0.4098×51 + 0.59×15 = 29.7498 | +1.11 = 30.8598 | 30.86 ✓ | 15+36−30.86 = 20.14 ✓ |
| 1775088900 | 0.4237×63 + 0.5533×15 = 34.9926 | +1.33 = 36.3226 | 36.32 ✓ | 15+48−36.32 = 26.68 ✓ |
| 1775089800 | 0.5775×71 + 0.51×15 = 48.6525 | +1.46 = 50.1125 | 50.11 ✓ | 15+56−50.11 = 20.89 ✓ |

Settlement of winning shares does NOT reduce cost. Losing-side case verified
earlier by run 852 (full basis retained, pnl −cost). [db run 856 | 2026-07-30]
Taker fee formula verified exactly: fee = (feeRateBps/10000)·p·(1−p)·size —
observed 0.07×0.60×0.40×56 = 0.9408 on a printed fill. [run 856 | 2026-07-30]

## The units (exact formulas over DB columns)

All from `backtest_run_markets` (m) joined on `run_id`; pnl is already net of
taker fees (never subtract fees_paid again — double count).

1. **invested(market)** = `m.cost`
   Fee-inclusive dollars actually deployed in that market.
2. **profitPer100(market)** = `100 * m.pnl / m.cost` (only where `m.cost > 0`)
   Return per $100 invested in that market.
3. **investedTotal(run)** = `SUM(m.cost)`
   **profitPer100(run)** = `100 * SUM(m.pnl) / SUM(m.cost)` (capital-weighted;
   report alongside the per-market distribution — median, p10/p90 — because a
   few big-notional markets can dominate the weighted number)
4. **evPerMarketTotal(run)** = `SUM(m.pnl) / COUNT(*)`
   The headline EV unit for this strategy. Matches
   `backtest_run_segments(kind='all').ev_per_market_total`. Use the TOTAL
   denominator, not Played: batchStats classifies pnl==0 markets as skipped,
   and a pair strategy that idles out a market produces exactly pnl==0 — the
   Played denominator would flatter selective variants.
5. **invested distribution** = `MAX(m.cost)`, `AVG(m.cost)` over `cost>0` rows
   — proxy for per-market capital requirement. NOTE live capital needs exceed
   this: capital stays locked from fill until merge/redeem settles on-chain,
   which can span market boundaries; treat max(cost) as a lower bound.
6. **EV at capital level C**: NOT derivable retroactively. There is no cash
   model — `INITIAL_CAPITAL` is pure reporting and never constrains fills
   [code + backtest-cli.md]. Capital levels must be encoded as strategy
   params (per-market stake cap in $ / max pairs), one run per level, then
   compared via units 3–4. Every pair-fable strategy MUST expose a per-market
   capital-cap param so the standard sweep is possible (binding convention;
   also listed in parity.md conventions).

SQL skeleton (single run):

```sql
SELECT COUNT(*) AS markets,
       SUM(pnl) AS pnl_total,
       SUM(pnl)/COUNT(*) AS ev_per_market_total,
       SUM(cost) AS invested_total,
       100*SUM(pnl)/NULLIF(SUM(cost),0) AS profit_per_100,
       MAX(cost) AS invested_max,
       AVG(NULLIF(cost,0)) AS invested_avg_played
FROM backtest_run_markets WHERE run_id = ?;
```

## intent_meta stamping convention (binding for pair-fable strategies)

Channel mechanics (verified run 856 + code): `Intent.meta` on each
`place_limit` / batch order is copied onto every fill of that order and
deduped to ONE entry per clientOrderId in `backtest_run_markets.intent_meta`
[code src/backtest/stats/marketStats.ts:169-178; src/backtest/runSingleMarket.ts:261-269 @ 1415c2b].
Run 856 market btc-updown-15m-1775088900: 8 fills from 7 orders (the crossing
GTC filled across 2 book levels) → exactly 7 meta entries, order-level data
intact. [db run 856 | 2026-07-30]

Rules:

1. Every order-placing intent carries `meta` with at least:
   `{ t: '<strategyShortTag>', i: <orderSeq>, side: 'UP'|'DOWN', ot: <orderType>, p: <limitPrice>, s: <intendedSize>, ts: <tick timestamp ms> }`
   (probe omitted `ts`; stamp it — timing analytics need it.)
2. One intent per order with a UNIQUE clientOrderId. Reusing a clientOrderId
   collapses meta entries (dedup is by clientOrderId).
3. `meta` records INTENT, not execution: run 856 market 1775089800's GTC had
   meta p=0.62 s=56 but filled at 0.60 (price improvement; fills execute at
   book level prices). Never compute invested from meta — use `cost`.
   Meta is for behavioral analytics: which increments fired, sides, order
   types, timing.
4. Partial fills at market end: meta `s` is intended size; actual acquired
   shares come from `up_shares`/`down_shares`. Meta sums are upper bounds.
5. Keep meta small (flat keys, short names): it is stored as JSON per market
   row and `export:trade-features` consumes it downstream.

## Universes (what a run covers)

- **FULL** = every eligible market from the protocol floor (2026-04-02).
  10,747 markets @ 2026-07-30, growing ~96/day. Launcher: no `--limit`
  (post-d8b8cc9 the launcher injects an explicit huge limit — the engine's
  eligibility query otherwise silently caps at 1000 oldest,
  src/db/telonexMarkets.ts:117,276; run 864 was bitten). Cost: ~13–15 min
  fleet. [run 870 | 2026-07-30]
- **SCREEN** = `--latest --limit 800` — the ~800 most recently settled
  markets (≈8.3 days; eligibility lags ~3 days behind now). Cheap (~1 min
  fleet). The screen universe drifts daily; comparisons are only valid via
  compare.ts's slug-intersection, against a baseline run launched ≤7 days
  earlier (re-run the baseline when older — it is one cheap run).
- **SWEEP** = the screen universe re-run at several latencies (§Stage 3).
- A run is RULES-grade evidence only if latency was flag-pinned (cmd shows
  `--latency-delay-ms`); results.ts flags `ENV-SOURCED` otherwise.

## Noise floor (when is a delta real?)

Two identical-config runs differing only in jitter RNG (865 vs 868, N=300,
140/20ms): Δpnl_total 0.26, Δev/mkt **0.0008**, one market moved (−0.20),
daily corr 1.0000. The passive-maker family is nearly deterministic under
jitter. [runs 865/868 | 2026-07-30]

Rules:
- Family noise floor = measured Δev from ONE duplicate screen-size run pair,
  recorded in the family file. Until measured for a new family (especially
  taker-heavy ones — fill-timing sensitivity differs), use the conservative
  default **0.05 ev/mkt**.
- A screen delta counts as real only if |Δev| > max(2×familyNoise, 0.05).
  Anything smaller is "indistinguishable — do not iterate on it".

## Stages (the pipeline)

Every variant walks these in order. Record every stage result in the family
file + one LEDGER line per run. Verdicts: **KILL** (recorded, time-scoped) /
**ITERATE** (stay at stage, change params per pre-registered grid) /
**CANDIDATE** (passed S0–S3, accumulating OOS) / **CHAMPION-ELIGIBLE**
(passed S4).

### S0 — SMOKE (mechanical gate, new/changed code only)

`tools/smoke.ts --strategy <id> --limit 5`. PASS = runs, persists sane rows,
0 failures. Mandatory before any fleet submission (RULES). Says nothing about
quality.

### S1 — SCREEN (cheap kill)

Launch: `run-backtest.ts --strategy <id> [--param …] --latest --limit 800
--label <family>-screen`. Evaluate vs the family/champion baseline screen run
(intersection via compare.ts):

- KILL if ev(variant) < ev(baseline) − max(2×noise, 0.05) — strictly worse.
- ADVANCE to S2 if ev(variant) > ev(baseline) + max(2×noise, 0.05), or
  ev(variant) > 0.
- Otherwise ITERATE (indistinguishable ⇒ the param did nothing — prefer the
  simpler variant, see §Guards).

Mechanical checks (results.ts output): unitsValid, failures=0, taker share
consistent with the design (a "maker-only" variant showing >2% taker fills is
mis-implemented, not unlucky — see run 862's 1/291 finding).

### S2 — FULL + TEMPORAL (distributional evidence)

Launch: `run-backtest.ts --strategy <id> [--param …] --label <family>-full`
(no --limit ⇒ all 10.7k+). Evaluate with evaluate.ts:

- **Headline**: evPerMarketTotal (the headline unit — TOTAL denominator),
  profitPer100 (capital-weighted + median/p10/p90), invested distribution.
- **Walk-forward (weekly)**: engine `computeWalkForwardForRun`
  (src/backtest/stats/walkForwardRank.ts:87) over weekly segments with
  **marketsTotal ≥ 300** (drops partial edge weeks — segment keys are ISO
  weeks, e.g. run 864's W14=384/W15=616 are both edge-partial). Gate =
  stabilityPass (segments ≥ 4, all of the last 4 weekly EVs ≥ 0,
  min weekly EV ≥ −0.3) AND wfMeanEv > 0.
- **Monthly table**: report per-month EV; no gate, but a variant whose entire
  edge sits in one month is flagged in the family file (regime-specific).
- ADVANCE requires: full-run ev > 0 AND walk-forward gate PASS.

### S3 — LATENCY SWEEP (RULES: not latency-dependent)

Launch: `run-backtest.ts --strategy <id> [--param …] --latest --limit 800
--sweep-latency 140,300,600,1000 --label <family>-sweep`. Jitter stays 20
throughout; the four runs share one label and are auto-detected by compare.ts
as a sweep (rows latency-ordered). Comparison on the slug intersection.

- PASS iff ev(λ) > 0 for every λ AND ev(λ) ≥ 0.5 × ev(140) for every λ.
- Also report taker-share per λ: taker share RISING with latency means the
  variant is quietly crossing the spread when late — latency-dependence in
  disguise, investigate before promoting.
- Dry-run evidence the mechanism works: v0 swept 140/300/600/1000 →
  ev −2.35/−2.34/−2.31/−2.25 (flat; passive maker is latency-insensitive as
  expected — the sweep gate itself was NA on a negative base).
  [runs 865/866/867/869 | 2026-07-30]

### S4 — OOS (the un-cheatable holdout) and champion selection

There is no frozen historical holdout: the screen universe is recent data, so
any recent window we "held out" would leak through iteration. Instead the
holdout is the **future**:

- **design-ts** = commit timestamp of the param-freeze commit (recorded in
  the family file + LEDGER when the variant first passes S1). Markets with
  `market_start_ms > design-ts` did not exist during design — they are true
  out-of-sample, and no amount of iteration can peek at them.
- OOS evaluation = evaluate.ts `--design-ts` split over the latest FULL run
  (per-market rows carry market_start_ms; re-running FULL periodically
  extends OOS coverage automatically at ~96 markets/day — ~4–5 days to the
  400-market minimum).
- **CHAMPION-ELIGIBLE** iff OOS n ≥ 400 AND OOS ev > 0 AND OOS
  profitPer100 > 0 (plus S1–S3 already passed).
- **Champion** = highest OOS ev among champion-eligible variants. Dethroning
  requires beating the sitting champion on the slug INTERSECTION of their OOS
  windows (≥400 common markets, compare.ts), not on raw numbers from
  different windows.
- A candidate's stages S1–S3 are re-checked (fresh screen + sweep) if >30
  days pass before it reaches OOS eligibility — the market moves.

### Capital sweep (candidates only)

Capital levels cannot be derived retroactively (no cash model — unit 6).
For each CANDIDATE run the screen universe at the standard grid:
`--param capPerMarket=25|50|100|200` (4 runs, ~4 min). Report ev and
profitPer100 per level. Live capital recommendation = the highest level whose
profitPer100 ≥ 80% of the best level's (capacity knee). Champion gets the
grid confirmed on FULL before any live proposal.

## Variant independence (portfolio building)

Measure: Pearson correlation of DAILY pnl on the common universe —
compare.ts computes it (needs ≥3 common days; buckets are UTC days of
market_start_ms). Verified end-to-end: 868 vs 863 (same family, one param
apart, 300 common markets / 4 days) → r = 0.9989, hand-recomputed from the
daily sums = 0.9989 exactly. Same-family param variants are the same bet —
as designed, the measure catches it. [runs 863/868 | 2026-07-30]

Rules:
- Portfolio admission: pairwise daily-pnl r < 0.6 over ≥14 common days
  against every variant already in the portfolio; otherwise keep only the
  better OOS performer.
- Correlation on losing pairs is still informative (863/868 correlate at
  0.999 while both lose) — independence is about WHEN pnl moves, not sign.
- 4 common days (one screen run) is enough to REJECT near-duplicates
  (r≈1.0) but not to admit: admission needs the ≥14-day overlap from FULL
  runs.

## Overfitting guards

1. **Pre-registration**: before launching a param sweep, write the grid and
   the hypothesis ("deeper bids improve reward:risk per fill") in the family
   file. Every launched config gets a LEDGER row — no silently dropped runs.
2. **Param budget**: ≤6 exposed tunables per variant (v0 has 6). A new param
   must beat the param-less version on screen beyond noise to earn its slot;
   an indistinguishable param is REMOVED (prefer simpler).
3. **Multiplicity**: the screen winner of a k-config sweep is not promoted on
   screen numbers — S2 FULL is the confirmation, S4 OOS the arbiter. OOS
   cannot be p-hacked (the data did not exist).
4. **Stopping rule**: ≥20 configs in a family without a real screen
   improvement ⇒ stop, write the negative result up in the family file, move
   to a different idea axis.
5. **Time-scoped verdicts** (memory convention): every KILL records
   date + universe + runs. A KILL older than 60 days may be re-tested once if
   the idea plausibly interacts with a changed regime — "did not work in
   April" is not "never works".
6. **Safe-bias reminder** (RULES): the worst-queue maker model UNDERSTATES
   maker fill rates. A passive variant that is marginally negative in
   backtest may be viable live; note it in the family file rather than
   hard-killing at −0.1 > ev > 0 … but never promote on hoped-for bias
   either. The bias never justifies promoting a variant that fails S3/S4.

## tools/evaluate.ts (the executable form of this file)

`tsx protocols/pair-fable/tools/evaluate.ts --full-run <id>
[--design-ts <ms|ISO>] [--sweep-runs a,b,c,d] [--screen-run <id>
--screen-baseline <id>] [--noise-ev <f>] [--json]`

Computes: mechanical checks, headline+units, weekly walk-forward via the
engine's computeWalkForwardForRun (partial-week filter ≥300), monthly table,
OOS split, sweep verdict (intersection EVs by latency + taker-share trend),
screen verdict vs noise floor, and the overall stage verdict with reasons.
Exit 0 always when readable (verdicts are data, not errors); exit 2 on bad
flags/missing runs. Dry-run evidence: pair-v0 family evaluation
[runs 863–870 | 2026-07-30], recorded in memory/experiments/pair-v0.md.

## Standing decisions / open questions

- Weekly gate thresholds (tail-4 ≥ 0, minEv ≥ −0.3) are the ENGINE's
  calibration (walkForwardRank.ts) — adopted as-is until real candidates
  show they are too loose/tight. Revisit with evidence, in this file.
- Screen size 800 / OOS minimum 400 / r<0.6 / capacity-knee 80% are initial
  calibrations chosen for sample size vs cost — same revisit rule.
- INITIAL_CAPITAL stays pure reporting; capital realism lives in
  capPerMarket params (binding convention, parity.md).
