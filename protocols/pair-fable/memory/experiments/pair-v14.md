# pair-v14 — unconditional book-vs-outcome calibration (E-028)

Status: PRE-REGISTERED (session 15). Design committed BEFORE
`tools/calib.ts` existed (design-ts = the commit adding this file; the
M2/design-ts discipline applied to scans, as in E-022/E-027).

## Hypothesis

The btc-15m book is miscalibrated somewhere in (price, time): there
exists a region where a side's fee-inclusive ask price differs from its
realized win probability by more than noise. Directionally we expect
favorite-longshot bias (cheap sides overpriced): it would unify the
entire negative record (every killed family bought cheap sides by
construction — E-019/E-021 ceilings, E-011 gate-invariant per-dollar
loss, E-016/E-017 fill-conditioned residue readouts). The mirror region
(expensive/leading side underpriced) is the only in-rules place a
buy-and-hold-to-redeem edge could live, and is the measurement behind
the human's "operators finish deliberately tilted" context
(market-context.md).

This is the LAST identity term measurable on data already on disk
(memory/replan-2026-07-31.md §Identity coverage map): all prior residue
measurements were fill-conditioned and inherit the family's
self-selection; this scan is policy-independent.

## Design (frozen)

- Tool: `tools/calib.ts`, read-only (DB market rows + local delta
  parquet). Machinery copied from bookscan.ts: `--checkpoint <jsonl>`
  per-market resume + `--time-budget-s` foreground chunking (standing
  session guard), `listEligibleTelonexMarkets`, `getMarketResolution`,
  `replayTelonexDeltaParquetForMarket`.
- Universe: the pinned latest-800 (`--latest 800 --to-ms 1784762100000`)
  — identical to every prior scan (E-015..E-024); slugs
  btc-updown-15m-1784043000 → 1784762100. Markets with unknown outcome
  are excluded and counted.
- Sampling: fixed clock times t_k = market_start + k·15s, k = 0..59
  (unconditional — no fill selection). At each t_k, for each side
  s ∈ {UP, DOWN}: best ask price p and displayed size, as-of semantics
  (last book state with ts ≤ t_k; pending queue resolved on the first
  event with ts > t_k; end-of-stream flush uses the final book — the
  book persists to settlement). Sample skipped if the side has no ask.
- Executable companion: ask at t_k + 140 ms (same pending mechanics).
  A marketable limit at p fills iff ask(t_k+140) ≤ p, at price
  ask(t_k+140).
- Cost is FEE-INCLUSIVE (RULES rubric 4, tier-0 taker):
  cost = p + 0.07·p·(1−p).
- Cells: minute m = floor(k/4) ∈ 0..14 × price band of width 0.05
  (index min(19, floor(p/0.05))).
- Per-observation edge = 1{side wins} − cost. Inference: cluster-robust
  SE with cluster = slug (all samples of one market share outcomes;
  UP/DOWN of one market are complementary — clustering by slug covers
  both dependence sources).

## Views (frozen)

1. **View 1 — calibration (rules the verdict)**: per cell (m, band):
   n, n_markets, mean cost, win rate, edge, clustered SE.
2. **View 2 — executable**: same cells, fill-surviving samples only
   (ask(t+140) ≤ ask(t)), cost from the arrival ask + fee; report fill
   fraction and conditional edge (measures the selection effect of the
   140 ms survival filter — do not assume it away).
3. **View 3 — favorite-longshot curve**: edge vs band pooled over all
   minutes (both views) — the unifying-explanation readout, reported
   regardless of verdict.
4. **Split halves**: universe sorted by market_start_ms, first 400 vs
   last 400 (E-022/E-027 methodology); View 1 recomputed per half.
5. **Region search**: all contiguous rectangles [m1..m2] × [b1..b2]
   with pooled n_markets ≥ 100 per half; report the top regions by
   pooled edge/SE (full sample) with their per-half stats.

## Verdict bars (frozen)

- **POSITIVE-SIGNAL** iff some contiguous region has, in View 1:
  pooled edge ≥ 2 × clustered SE on the full sample, AND n_markets ≥ 100
  and edge ≥ 2 × clustered SE separately in BOTH split halves, AND that
  region's View-2 (executable) edge > 0 on the full sample.
- **KILL this axis** iff no such region. (Same reproduction standard as
  E-022/E-027; no additional multiplicity correction beyond the
  split-half requirement.)
- Either way, record View 3 (the calibration curve) in this file — it is
  a market fact other work will reuse.

## Follow-ups (pre-declared, to prevent post-hoc scope creep)

- If POSITIVE-SIGNAL in a cheap-side region: contradicts the
  favorite-longshot prior; feed directly into pair-family entry pricing
  (no scope question — it is where the family already buys).
- If POSITIVE-SIGNAL in an expensive/leading-side region: the exploiting
  variant is one-sided buy-and-redeem (no pairing). Buy-only, btc-15m,
  redeem-exit — consistent with every RULES rubric — but the RULES
  §Strategy description defines the PAIR strategy, so a one-sided
  variant needs an explicit human scope ruling BEFORE any strategy code
  (goes to PROPOSALS with the measured region attached). In-family uses
  (completion timing when the completing side is underpriced;
  start-side selection at entry) need NO ruling and proceed.
- If KILL: assemble the class-level ASSESSMENT for the human per
  memory/replan-2026-07-31.md §Decision item 3 (not a class kill — an
  identity-coverage statement with residual holes named).

## Cost estimate

Same replay volume as bookscan (199.5M events over 800 markets, measured
E-015..E-018). Run in foreground time-budget chunks with checkpoint;
if the session budget ends first, STATUS records the exact resume
command (standing guard dad421a6).

## E-028b amendment — first-touch policy readout (pre-registered)

Written AFTER E-028's scan completed and BEFORE any first-touch code
exists (design-ts = the commit adding this section). Motivation, honestly
stated: E-028 returned POSITIVE-SIGNAL per the frozen bars (12 passing
rectangles, all one blob around minutes 0–9 × ask ≥ 0.90), but a
post-hoc diagnostic showed the frozen estimand (obs-weighted pooled
edge) is DWELL-TIME weighted: markets that sit long at 0.90+ (mostly
winners) contribute up to 40 samples, while brief touches (more often
losers) contribute few. Market-equal-weighted edge on the headline
region is −0.007 ± 0.012 — consistent with zero. A real policy decides
roughly once per market, so exploitability must be measured with a
one-decision-per-market estimand. The frozen POSITIVE-SIGNAL stands as
a bar outcome; whether it is exploitable is THIS amendment's question.

Frozen policy ("first-touch"), per region, per market:
- Watch the same samples t_k (15s grid), k = 0..39 only (minutes 0–9).
- Trigger: a side's best ask ∈ [X1, X2) at t_k. Attempt a marketable
  limit at that ask; it FILLS iff ask(t_k+140ms) ≤ ask(t_k), at cost
  ask(t_k+140) + fee. If it does not fill, keep watching; the market's
  readout uses the FIRST FILL only (at most one, one side, per region).
- Regions frozen from E-028's passing blob (no further tuning):
  R1 = [0.90, 1.00), R2 = [0.90, 0.95), R3 = [0.95, 1.00).
- Same pinned 800, same universe pin, same fee formula.

Frozen readouts per region: fills (markets), first-fill edge =
1{win} − cost, mean ± SE over FILLED markets (one obs per market — no
clustering needed), split halves (same sort), daily table (9 days),
mean displayed ask size at fill, and EV/mkt over ALL 800 (mission
unit) at 1 share and at min(askSize, 100) shares.

Frozen bars:
- **POSITIVE (policy-grade)** iff full-sample first-fill edge ≥ 2×SE
  AND edge > 0 in BOTH halves AND daily edge > 0 in ≥ 6 of 9 days.
- **KILL the one-shot policy** otherwise. The View-3 calibration curve
  (a market fact) is recorded either way; a policy KILL here does NOT
  kill the calibration finding, only its naive exploitation.

## Result

(pending — E-028 core scan complete, POSITIVE-SIGNAL per frozen bars;
E-028b first-touch readout pending)
