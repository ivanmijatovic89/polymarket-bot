# Mission 02: Autonomous Strategy Research Loop

> Amended per Mission 01's READY review (A1–A7, all accepted by the human on
> 2026-07-30). Evidence and definitions referenced below live in
> `memory/process/evaluator.md` and `memory/capabilities/parity.md`.

## Why

This is the autonomous research lab for the pair strategy: it researches,
proposes variants, runs experiments, reads results from the database, writes
to memory, and improves the strategy and its own process — 24/7. It starts
only after mission 01's READY report was accepted, in the same workspace,
with the tools, memory, and evaluators built there. `RULES.md` remains the
constitution; the Global Runtime contract remains the interface.

## Goals

1. **A profitable strategy, as soon as possible.** BTC 15 min has ~96
   markets/day. Average EV of $2 per market ≈ $192/day from this one
   timeframe ($3 ≈ $288). The first target, precisely (A1): a variant with
   `evPerMarketTotal ≥ 2` — `SUM(pnl) / COUNT(*)` over ALL universe markets,
   flat markets included in the denominator (the engine counts pnl==0
   markets as "skipped", and a played-only denominator flatters selective
   variants) — at a stated `capPerMarket` level, on the FULL protocol
   universe AND on the S4 out-of-sample window. A screen-only $2 is not the
   target. Optimization and scaling come after.
2. **Capital-aware results, always.** EV without capital context is
   meaningless: $2 EV on $50 invested per market is excellent, on $5,000 it
   is poor — and the simulator has no cash model (`INITIAL_CAPITAL` is
   reporting-only), so capital behavior cannot be derived retroactively
   (A2). Therefore: every variant exposes a per-market capital-cap parameter
   (binding strategy convention), and capital behavior is measured by the
   `capPerMarket` sweep grid (25/50/100/200), one run per level. Report
   every result in the mission-01 units (invested per market, profit per
   $100 invested, EV per capital level). Live starts small and scales up,
   and backtest-vs-live parity is checked on the small configuration first.
3. **A portfolio of independent variants, not a single champion.** The pair
   strategy can be built dozens of ways. "B is weaker than A" is not a
   reason to discard B: if A and B are independent and both profitable, they
   can run in parallel and both earn. Independence is already defined and
   verified (A3): daily-pnl Pearson `r < 0.6` over ≥14 common days — see
   `memory/process/evaluator.md` §Variant independence. Use it; do not
   re-derive it.
4. **Improve forever; adapt to the market.** A found strategy is a
   checkpoint, not an end: keep searching for improvements (without
   overfitting) and keep building the knowledge base that lets strategies
   survive regime changes — bull, bear, quiet, frantic. Regime adaptivity is
   a long-term goal, not a v1 gate: the near-term bar is goal 1.

## Unit of work

One session = one coherent research increment: design the next experiments
from memory and prior results, smoke-test new strategy code locally with
`--sequential`, push, submit to the fleet, read and evaluate finished runs,
record conclusions with evidence in memory, update the research plan, commit
and push, return `continue`. Batch what you can: launching several
well-chosen experiments per session costs almost the same context as one —
decide the batch size yourself, and use fleet wait time to analyze earlier
results.

Two hard rules from mission 01's evidence (A4, A6): never end a session
blocked on an in-flight fleet run — record the batch/run id in the status
file and return `continue`; the next session reads the finished run
(headless task notifications cannot re-invoke you, and `wait` parks the loop
for a human). And never use `--extend` to accumulate results: extensions
silently drop the parent run's simulated latency (P-001), poisoning
latency-pinned evidence — out-of-sample coverage grows through periodic
fresh FULL runs instead (~15 fleet minutes, cheap).

When the engine may have moved (a human announcement, or a rebase pulling
engine commits), run `tools/refresh-capabilities.ts` before relying on
capability notes (A7).

**Review gate (binding):** the independent Mission 01 review
(`state/MISSION01-REVIEW.md`, verdict APPROVE WITH NOTES) found the
promotion machinery honest by convention, not by code. Before the FIRST
champion promotion or LIVE-CANDIDATE, findings M1–M5 must be implemented and
verified: cross-run params+latency identity in `evaluate.ts` (M1), a
machine-checkable `design-ts` rule covering `--param` variants (M2), a
noise-aware champion-eligibility and dethroning threshold (M3), engine-SHA
awareness in cross-run comparison and team-workflow rule 4 (M4), and a bound
on `incrementSize` (M5). Fold the minor corrections (m6–m11) into the next
touch of each affected file.

Progress claims follow the same rule as mission 01: every claim audited
against a tool result from this session; unverified things are labeled as
such; failed runs reported as failed.

## Self-check

Every fifth session: audit recent work against the goals — is this still
driving toward a live-ready profitable variant, or drifting into trivia?
Correct the plan if so. If blocked, write what blocks you and a proposed
solution, and if it needs the human, put it in `state/PROPOSALS.md` or
return `wait` per the rules below.

## Ending states

This mission has no natural `complete` — research continues until the human
stops or repoints it. Use:

- `continue` — default; the next increment is known.
- `wait` — only for genuine blockers the human must resolve, and for one
  milestone: when a variant meets goal 1 AND the 8-point live-trust evidence
  bar (`memory/capabilities/parity.md` §6), including the S4 out-of-sample
  verdict on ≥400 markets created AFTER the variant's param-freeze commit
  (A5 — structurally ~4–5 calendar days of new markets; the human should
  expect that latency, it is not stalling), write `state/LIVE-CANDIDATE.md`
  (variant, results in the capital-aware units, risks, proposed live
  configuration) and return `wait` with summary "Live candidate ready for
  review". The DRY_RUN=true live windows are the post-review step. After the
  human's decision arrives in the inbox, research continues.

The session limit is a budget guard, not a plan — the human extends it as
long as the loop earns its keep.
