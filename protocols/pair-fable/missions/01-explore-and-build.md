# Mission 01: Explore and Build

## Why

polymarket-bot is a complete trading infrastructure: backtesting, live
trading, strategy development, analysis, a distributed backtest fleet. On top
of it we are building **pair** — an autonomous strategy-research protocol
dedicated to one strategy (defined in `protocols/pair-fable/RULES.md`). It
must run 24/7 for weeks and months: not find one working strategy and stop,
but keep improving as the market changes. Scope now is Bitcoin 15 min only;
other symbols and timeframes come only after a strategy is live and earning.

You design the how. This mission states outcomes; the protocol's internal
organization — notes, tools, memory, workflow — is yours to design, because
you will design a better operating system for yourself than a human would.
Notes meant for AI consumption do not need to be human-readable.

This mission is preparation: when it ends you must be READY to run the
research loop (mission 02) end-to-end without unknowns.

## Ground rules

- `RULES.md` is the constitution. It wins over anything here. Never edit it.
- The Global Runtime session contract governs status/journal/inbox and the
  session result. The journal is the human's progress feed — write milestone
  entries a human can follow.
- Mission Control already exists (the dashboard). Do not build one.

## On session start

1. Read `protocols/pair-fable/RULES.md`.
2. If `protocols/pair-fable/state/PLAN.json` does not exist, you are the
   **initializer** (below).
3. Otherwise read `PLAN.json` and your memory index, then take the first
   item with `"passes": false`.

## Initializer (first session only)

Survey the repository broadly, then decompose the Goals below into
`state/PLAN.json`: an array of items, each
`{ "id", "description", "steps": [verification steps], "passes": false }`.
Aim for units a single session can finish and verify. Create the `memory/`
and `tools/` skeletons however you designed them, initialize the status
file, commit and push per RULES, return `continue`. You own `PLAN.json` and
may restructure it as understanding improves (it is listed among the run's
Mission-Control display files; that affects display only, not ownership).

## Unit of work

One `PLAN.json` item per session: do it, verify it against its `steps`, set
`"passes": true` only with evidence, record what you learned in memory,
update the plan if the work revealed new items, commit and push, return
`continue`. Before reporting progress, audit each claim against a tool
result from this session; only report work you can point to evidence for —
if tests fail or something is unverified, say so explicitly.

## Goals

1. **Capabilities.** Research the complete polymarket-bot. Do not trust the
   documentation — verify in code; do not trust the code blindly — verify by
   running: start backtests, submit to the fleet, read what lands in the
   database. The point: know exactly which strategies can be built such that
   they execute **100% identically in backtest and live**, so a strategy
   proven in backtest is trusted live. Find which metrics exist, which are
   missing for this strategy, and what matters for evaluating it.
2. **Capability self-upgrade.** The engine keeps evolving (example: a large
   trades+activities dataset is coming — do not build for it now). Design a
   repeatable procedure the human can trigger that discovers engine changes
   and folds them into your capability notes.
3. **Tools.** Build the tools research will need: launching backtests
   (single and batch), reading results, comparing runs, checking fleet/queue
   status — plus whatever else you judge useful. Smoke-test new strategy code
   locally with `--sequential` before any fleet submission.
4. **Memory.** Stateless, file-based, written after every step; a fresh
   session continues from files alone. Design it yourself, for durability
   over months. Entries must meet a high bar of correctness: a wrong
   "does not work" note can bury a profitable idea forever — record the
   evidence with the conclusion, and remember the market changes, so "did
   not work in April" is not "never works". Later, parallel agent loops
   (other models) will share this work: they cooperate, complement, and
   verify each other when paths cross naturally — they do not compete and do
   not deliberately re-test what another agent verified.
5. **Evaluators.** Design the evaluation system for backtest results:
   stages, holdout/walk-forward if warranted, how champions are selected,
   which metrics matter for this strategy — including capital-aware units
   that make results comparable (invested per market, profit per $100
   invested, EV at several capital levels).
6. **Proposals.** Record engine bugs, improvement suggestions, and rubric
   questions in `state/PROPOSALS.md` as they arise (per RULES). Nothing you
   discover may be silently forgotten.

## Self-check

Every fifth session, before taking an item: audit the last sessions against
this mission and `PLAN.json`. If work drifted into trivia, write the
correction into the plan. If you are stuck in place, write down what blocks
you and propose a solution instead of continuing to circle.

## Completion

READY means: you can run the whole research loop end-to-end with no
unknowns — design a variant → run it through the fleet → read and compare
results → record in memory — and the tools, memory system, and your proposed
team workflow exist. When you judge yourself READY, write `state/READY.md`:
what was delivered, what remains unknown or risky, and why research is ready
to start. Then return `wait` with summary "READY for review".

The human reviews and responds through the inbox: on feedback, address it
and repeat; on "READY accepted", return `complete`. Never return `complete`
without an accepted READY.

## Motivation

The entire infrastructure — engine, datasets, fleet — was built so that you
have every tool needed for this. Comparable bots run this strategy
profitably today; with strictly more tooling than they have, the missing
piece is the right combination, and finding it is your job. This is a
long-term project: when the strategy earns live, the fleet grows. Take it,
lead it, win.
