# LIFECYCLE — an experiment from idea to verdict

Operational companion to `EPISTEMOLOGY.md` (which owns the thresholds).
This file owns the mechanics: files, names, freezing, and who does what.

## 0. Actors

- **Scientist** — the operating Claude Fable session
  (`protocol/sessions/SCIENTIST.md`). Generates ideas, registers experiments,
  writes strategies, submits runs, runs diagnostics.
- **Judge** — a fresh-context subagent spawned per decisive readout
  (`protocol/sessions/JUDGE.md`). Sees ONLY: the frozen spec, the tool-read
  results, EPISTEMOLOGY.md. Never sees the Scientist's working notes for the
  experiment. Issues the verdict.
- **Operator** — the human. Sets scope, approves anything touching live
  trading, reads `RUNBOOK.md`.

## 1. Idea → ledger

Ideas live in `protocol/IDEAS.md` (one table row + short entry each).
Required fields per DECISIONS D5: mechanism class, who-loses story,
falsifiable prediction about recorded data, cheapest killing experiment,
duplicate check against existing entries *by mechanism*, priority score.
An idea is promotable when its prediction is testable with the engine's
recorded inputs only (CAPABILITIES §1 — notably: no price-to-beat, no trade
stream; the books are the only market signal).

## 2. Registration (bias lock)

Registering experiment `EXP-NNN-<slug>`:

1. Copy `protocol/templates/EXPERIMENT.md` →
   `protocol/registry/experiments/EXP-NNN-<slug>.md`.
2. Fill EVERY spec field: hypothesis, mechanism, strategy file path +
   version, primary parameter cell, sample rules for each stage, holdout
   boundary (`market_start_ms`, computed by `tools/universe.ts` at
   registration time), decision rules (copied numbers from EPISTEMOLOGY at
   time of registration), `lineage_cells` (multiplicity count inherited from
   parent experiments), simulator-bias exposure statement.
3. Write the strategy under `fable-lab/strategies/<mechanism>/EXP-NNN.ts`
   (id = `fable-exp-NNN`; injected into the registry by
   `tools/run-backtest.ts` — NOT auto-discovered, so every run goes through
   that wrapper; DECISIONS D7). The strategy must obey replay-safety rules
   (CAPABILITIES §3).
4. Commit spec + strategy together, push. **The spec commit must predate the
   first non-smoke run** — `tools/validate-experiment.ts` checks the commit
   timestamp against `backtest_runs.created_at`.

After the first decisive run exists, the spec section of the file is FROZEN:
edits land only in the append-only "Runs" and "Verdicts" sections. A frozen
spec that turns out to be wrong is answered with a new experiment, not an
edit.

## 3. Running

Naming: every NEW run's `--batchUid` is `EXP-NNN-<stage>` (`EXP-014-smoke`,
`EXP-014-probe`, `EXP-014-holdout`, `EXP-014-lat150`, `EXP-014-grid-<cell>`).
**The main stage creates no new label**: it extends the probe run in place,
and extension keeps the parent's `batch_uid` (CAPABILITIES §6) — the grown
run stays `EXP-NNN-probe` and is addressed by run id. The launch command
(recorded permanently in `backtest_runs.cmd`) plus these labels makes every
DB row traceable to its spec with no extra bookkeeping.

Fixed flags (operator scope, CHARTER): `--input-mode telonex-delta
--read-from local-or-download-from-r2-to-local --symbol btc
--timeframe 15m` (the delta-typed converter is derived from the input mode;
there is no `--converter` CLI flag). Additionally `--sequential`, always,
via `tools/run-backtest.ts` (DECISIONS D7: charter forbids fleet
submissions, and fable strategies exist only in this process's registry),
and `BACKTEST_LATENCY_DELAY=0 BACKTEST_LATENCY_JITTER=0` pinned explicitly
on every stage except `lat`, which sets its own delay (DECISIONS D8 — the
ambient `.env` sets 140ms and would silently change run semantics).
`tools/submit.ts` builds the full command from the spec file so params
cannot drift from what was registered.

Stage mechanics (all local `--sequential`; every non-smoke run is launched
in the BACKGROUND and the session keeps working while it replays):
- **Smoke**: `--limit 10` locally. Never labeled with an EXP
  batchUid stage other than `-smoke`; results never quoted.
- **Probe**: `--random --limit 500` bounded to the exploration
  window (`--to-ms <holdout boundary>`).
- **Main**: `--extend <probe runId>` growing to the full exploration window
  (extension recomputes segments over the union — CAPABILITIES §6; batchUid
  stays `EXP-NNN-probe`). Robustness runs (latency curve via
  `submit.ts --stage lat --delay <ms>`, neighborhood via
  `--stage grid --cell "..."`) are separate runs labeled `EXP-NNN-lat<ms>`,
  `EXP-NNN-grid-<cell>`; the Judge reads them through `tools/battery.ts`.
- **Holdout**: a NEW run (not an extension) covering exactly the frozen
  holdout window `[boundary, regLast]`, submitted only after the Judge's
  advance verdict is appended. `submit.ts --stage holdout --execute`
  mechanically refuses to run unless `validate-experiment.ts` passes.

Run preconditions: strategy + spec committed and pushed on `fable-protocol`,
clean tree (evidence runs on committed code only — never
`BACKTEST_ALLOW_DIRTY`). No fleet submissions ever: workers run
`origin/main` and never see fable-lab strategies (CHARTER §Hard
constraints 3, DECISIONS D7).

## 4. Reading results

All decisive readouts go through `tools/results.ts` (never the dashboard by
eye, never ad-hoc SQL): it pulls the run's per-market rows and segments and
prints N, q, t, EV/market ± CI, win rate, maker/taker/fee composition, skip
and failure counts, daily-stability summary. The tool exists so that every
readout is computed the same way and is copy-pastable into the experiment
file verbatim.

## 5. Judging

At each decision point the Scientist spawns the Judge with: the experiment
file (spec + appended run records), the `tools/results.ts` output, and
EPISTEMOLOGY.md. The Judge applies the decision rules *as written in the
spec* (not as the Scientist retells them), fills the verdict template —
including the simulator-bias classification (DECISIONS D6) — and the
Scientist appends the verdict verbatim, then acts on it. The Scientist may
disagree in a note but may not override: kill means kill, advance means
advance. Disagreement + new insight = new registered experiment.

## 6. After the verdict

- **kill/park**: one-line cause in the experiment file; mechanism-level
  learning (if any) distilled into `knowledge/LESSONS.md` with the EXP id.
- **confirmed**: strategy file is frozen (code freeze note appended;
  subsequent edits = new EXP). The verdict names the required next step
  (live paper validation) and its owner (Operator decision).
- Always: `tools/index-registry.ts` regenerates `registry/INDEX.md`;
  STATE.md updated; everything committed and pushed in one unit.

## 7. Resumability

A fresh session resumes by reading, in order: `CHARTER.md` (scope),
`protocol/README.md` (map), `registry/INDEX.md` (portfolio state),
`knowledge/LESSONS.md`, then the specific experiment files it will touch.
Everything decisive lives in those files or in the DB under `EXP-*` batch
uids; nothing decisive lives only in a session transcript.
