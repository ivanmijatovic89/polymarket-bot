# Mission 02: Autonomous Strategy Research Loop

> Amended per Mission 01's READY review (A1–A7, all accepted by the human on
> 2026-07-30). Evidence and definitions referenced below live in
> `memory/process/evaluator.md` and `memory/capabilities/parity.md`.
> Amended again by the human on 2026-07-31 (inbox rulings `90d94c56` and
> `93482fcb`) to make continuous two-sided inventory accumulation the current
> primary research program.

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
   current-program `capPerMarket` sweep grid
   (`$100`/`$500`/`$1,000`/`$2,000`), one run per level. Report
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

## Current primary program: continuous two-sided accumulation

Until the human repoints the lab, the main research program is a stateful
controller that operates through most of each BTC 15-minute market and keeps
buying both UP and DOWN. It is not primarily a search for one isolated pair
opportunity or a one-sided favorite trade. The controller must:

- maximize matched inventory, `min(UP shares, DOWN shares)`;
- use cumulative inventory and later price oscillation to improve earlier
  purchases;
- keep imbalance controlled and explicitly survive one-way markets;
- target a final aggregate pair VWAP below `$0.98`, while also reporting the
  fractions below `$0.95` and `$0.90`; and
- measure absolute profit, profit per `$100`, capital actually used, matched
  shares, final and maximum imbalance, and tail loss.

The `$0.98` target is not a hard invariant after every action. Temporary pair
VWAP above `$0.98`, including controlled completion above `$1`, is allowed
when it reduces dangerous residue or when later accumulation can repay the
temporary recovery debt. The controller must bound that debt using remaining
time, capital, imbalance, observed opportunity, and maximum-loss constraints,
and tighten risk near the end of the window. Unlimited loss chasing is never
allowed.

Maker and taker orders are both valid. Choose between them from expected net
outcome, including the real fee, latency, fill, OrderManager, and portfolio
semantics. Do not optimize for a maker/taker percentage. The neutral
controller comes first; after it is understood, the directional version is
the same controller with a measured and controlled non-zero inventory target.

Implement and evaluate this program through the real shared strategy and
backtest path; do not replace it with a separate approximate simulator. Work
in stages: a small smoke/integrity sample, roughly 100–200 diagnostic markets,
the pinned 800-market screen, then fresh FULL/OOS evidence only for survivors.
For scale, test at least `$100`, `$500`, `$1,000`, and `$2,000` per market,
with order size adapted sensibly to capital and displayed depth. The
500–1,000 matched-share level is an aspiration to investigate, not an assumed
result.

### Binding research priority

The order of work is explicit and may not be silently reordered:

1. Develop the **neutral continuous controller** that accumulates both sides
   through most of the market.
2. Once the neutral controller's mechanics are understood, develop the
   **directional version of that same controller** using a measured,
   risk-bounded non-zero inventory target.
3. Market selection, entry gating, favorite-region trades, and isolated
   one-shot opportunities are supporting diagnostics only. They may explain
   losses or provide a signal to the controller, but they must not replace the
   all-market controller as the primary program without a new human ruling.

Analysis of WHICH markets lose is allowed when it directly informs controller
math or the directional tilt. It is not permission to turn the program into a
strategy that waits for a small set of special markets. If a diagnostic points
to selection rather than a controller improvement, record the finding and
return to priorities 1–2.

Staged screens may use less capital and smaller orders, but the scale question
must not be declared answered, converged, or dead until the program has tested
the `$2,000` level and has either (a) meaningfully approached the 500–1,000
matched-share range, or (b) produced direct mechanical evidence explaining why
that range cannot be reached safely or profitably. Linear-looking results at
smaller scale are evidence, not a substitute for the required scale check.

Maintain and test a backlog of genuinely different controller mechanisms
derived from the accounting identity, price paths, inventory state, remaining
time, liquidity, and failed experiments. Previous family failures are design
constraints, not dismissal grounds, unless exact equivalence to the new
controller is demonstrated. The parked E-029 favorite-side replication is
secondary to this program.

## Unit of work

One session = one coherent research increment: design the next experiments
from memory and prior results, smoke-test new strategy code locally with
`--sequential`, push, submit to the fleet, read and evaluate finished runs,
record conclusions with evidence in memory, update the research plan, commit
and push, return `continue`. Batch what you can: launching several
well-chosen experiments per session costs almost the same context as one —
decide the batch size yourself, and use fleet wait time to analyze earlier
results. Five 800-market runs in a long session are not a target or ceiling:
pre-register informative grids, submit the whole independent grid up front,
keep available workers useful, and use completed results to launch the next
justified batch. More throughput must remain hypothesis-driven, with frozen
metrics and verdict bars; never substitute blind parameter brute force or
p-hacking for mechanism research.

**Time to evidence is binding.** A fresh session recovers state; it does not
re-derive the whole program. Within the first 10 minutes, it should normally do
at least one substantive execution action: launch a smoke/backtest, resume or
launch a data scan, or run a concrete implementation test. Reading, extended
historical recap, and long design prose alone do not satisfy this rule. If code
must be implemented before evidence can run, keep the pre-registration to the
minimum hypothesis/config/metric/verdict contract, implement immediately, and
record the concrete reason when the 10-minute target cannot be met.

Use concurrency deliberately. Submit independent backtest grids together
rather than one configuration at a time. Any local analysis that replays more
than 100 markets must be deterministically sharded across safe parallel
processes when practical. If it must remain single-process because of database,
checkpoint, I/O, or determinism constraints, write that reason before launch;
an idle fleet plus an unexplained long serial scan is not acceptable. A local
analysis is real evidence and need not create a fleet backtest row, but STATUS
must say clearly that it is analysis-only, its progress, and why no backtests
are expected.

Before closing a session, prepare the next experiment's concise hypothesis and
execution commands when the next step is already known, so the following fresh
session can execute promptly. Documentation supports experiments; it must not
become the session's main product.

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
