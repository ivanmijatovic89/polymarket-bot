# RUNBOOK — morning operator guide

How to start driving research with the Fable protocol, step by step.
Assumes: repo cloned, `.env` with DB/Redis credentials. No worker fleet is
used (all runs are local `--sequential`). Nothing here trades live.

## 0. Five-minute orientation (once)

Read in this order — ~15 pages total:
1. `fable-lab/protocol/README.md` — the map and the loop.
2. `fable-lab/protocol/EPISTEMOLOGY.md` — what a verdict means.
3. `fable-lab/DECISIONS.md` — why it is built this way.

## 1. Where strategies live and how runs execute

Strategies live in `fable-lab/strategies/<mechanism>/EXP-NNN.ts` (the
pre-commit hook restricts commits to `fable-lab/`). They are injected into
the engine's registry by `fable-lab/tools/run-backtest.ts`, which every run
goes through; consequently ALL runs are local `--sequential` — there are no
fleet submissions from this protocol (charter rule; workers run
`origin/main` and would never see these strategies). See DECISIONS D7 and
`fable-lab/strategies/README.md`. Sessions launch evidence runs in the
background and keep working.

## 2. Sanity-check the plumbing (5 minutes)

From the repo root:

```bash
npx tsx fable-lab/tools/universe.ts          # eligible universe + holdout boundary
npx tsx fable-lab/tools/runs.ts --limit 5    # DB read works
npx tsx fable-lab/tools/results.ts --batch EXP-000-smoke   # readout of tonight's plumbing smoke
```

All three ran green on 2026-07-09 (see STATE.md). `EXP-000-smoke` is a
plumbing fixture (template strategy, no trades) — not evidence of anything.

## 3. Launch the first Scientist session

Start a Claude Fable session (tmux + caffeinate as for the night shift)
with a prompt of roughly:

> Read `fable-lab/protocol/sessions/SCIENTIST.md` and act as that role.
> Work autonomously; commit and push after every unit; stop only when
> blocked on operator input.

That contract makes the session: boot from the memory files, take the top
idea in `protocol/IDEAS.md` (six are seeded, ranked), register the next
experiment, write the strategy, smoke it, run the probe locally in the
background, and judge it with a fresh-context subagent. The session prompts are goal-shaped on purpose —
don't add step-by-step instructions on top
(`docs/reference/prompting-claude-fable-5.md`).

## 4. What you will see, and where

- **Specs and verdicts**: `fable-lab/protocol/registry/experiments/EXP-*.md`
  (the whole scientific record, append-only), summarized in
  `registry/INDEX.md`.
- **Runs**: dashboard as usual (`npm run dashboard`, port 3051) — new runs
  are labeled `EXP-NNN-<stage>` (smoke/probe/holdout/lat*/grid-*); the main
  stage grows the probe run in place, so it keeps the `EXP-NNN-probe` label
  and is addressed by run id. Or `npx tsx fable-lab/tools/runs.ts --exp EXP-NNN`.
- **Decisive numbers**: in the experiment files, pasted verbatim from
  `tools/results.ts`. If a number in a verdict is not in a results.ts
  block, that is a protocol violation — call it out.
- **Transferable findings**: `fable-lab/knowledge/LESSONS.md`.

## 5. Your control points

The protocol runs without you except at these points:

- **Scope changes** (other symbols, timeframes, inputs): edit CHARTER scope
  — sessions will not.
- **`confirmed` verdicts**: the verdict names "live paper validation" as the
  required next step. That step is yours to authorize; nothing in this
  protocol places live orders.
- **Simulator-favored strategies**: maker-heavy edges cannot confirm on
  backtest evidence alone (DECISIONS D6). Expect sessions to park them and
  tell you; deciding whether to spend live-paper time on them is yours.
- **Holdout burns**: if a session reports a burned holdout (validator
  counts >1 holdout run), treat it as an incident — the affected lineage's
  confirmation is void.

## 6. If a session died mid-work

Nothing to reconstruct: start a new session with the same prompt (§3). The
boot sequence (STATE.md + INDEX.md + experiment files) is designed to
resume within minutes. If `extending_at` is stuck on a run after a crash:
`UPDATE backtest_runs SET extending_at = NULL WHERE id = <runId>;`

## 7. Known limits to keep in mind (from the engine study)

- Backtest maker fills are optimistic (full size on touch-through, no
  market impact); taker-only results are the trustworthy kind.
- No price-to-beat exists in replay; any idea needing the strike is
  reformulated in market-implied terms or dead.
- Stats have no drawdown/equity curve; day-bucket stability is the proxy.
- Latency default is 0ms; every main-stage verdict includes the
  {0,150,300}ms sensitivity curve — look at it before getting excited.
