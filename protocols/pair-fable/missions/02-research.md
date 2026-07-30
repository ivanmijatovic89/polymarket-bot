# Mission 02: Autonomous Strategy Research Loop

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
   timeframe ($3 ≈ $288). The first target is a variant with EV ≥ $2 per
   market — modest capital, simple to take live. Optimization and scaling
   come after.
2. **Capital-aware results, always.** EV without capital context is
   meaningless: $2 EV on $50 invested per market is excellent, on $5,000 it
   is poor — and the simulator has no cash limit, so stake can grow
   unnoticed. Report every result with the units designed in mission 01
   (invested per market, profit per $100 invested, EV at several capital
   levels), and measure small-capital and large-capital behavior in
   parallel: live starts small and scales up, and backtest-vs-live parity
   will be checked on the small configuration first.
3. **A portfolio of independent variants, not a single champion.** The pair
   strategy can be built dozens of ways. "B is weaker than A" is not a
   reason to discard B: if A and B are independent and both profitable, they
   can run in parallel and both earn. Define how independence is measured,
   how variants are compared fairly, and when holding several beats holding
   one.
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
  milestone: when a variant meets goal 1 with evidence across the protocol
  universe, write `state/LIVE-CANDIDATE.md` (variant, results in the
  capital-aware units, risks, proposed live configuration) and return `wait`
  with summary "Live candidate ready for review". After the human's
  decision arrives in the inbox, research continues.

The session limit is a budget guard, not a plan — the human extends it as
long as the loop earns its keep.
