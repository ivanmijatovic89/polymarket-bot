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
goes through; consequently ALL runs are local `--sequential`. Your 2026-07
charter updates direct evidence runs through the worker fleet (workers now
track `origin/fable-protocol`), but that path is blocked by the engine, not
by the lab: the strategy registry only auto-discovers `src/strategies/**`,
so fleet workers cannot resolve any `fable-exp-*` id — see the control
point in §5 and `knowledge/FLEET-GAP.md` (DECISIONS D7, D33). Sessions
launch evidence runs in the background and keep working.

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
open idea in `protocol/IDEAS.md`, register the next experiment, write the
strategy, smoke it, run the probe locally in the background, and judge it
with a fresh-context subagent. The session prompts are goal-shaped on
purpose — don't add step-by-step instructions on top
(`docs/reference/prompting-claude-fable-5.md`).

**Status as of U49 (2026-07-10):** nine experiments (EXP-001..009) and
three calibration-plane scans (CAL-001/002/003) are resolved — all kills
or confirmed nulls (`registry/INDEX.md`, `knowledge/EDGE-SPACE.md` §1).
All ten ideas are dead or parked (IDEAS #10 is parked with a mechanical
unlock condition needing ~15,000 markets in a pre-registrable fresh
window, reserve included). New registrations are
gated by the EDGE-SPACE §4 bar (D15, tightened by E20/E21/E22). Expect
sessions to run the wake-up checks (STATE.md "Next"), then do
verification depth and maintenance — until an idea clears the bar or one
of your unblocking actions (next section) lands.

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
- **Growing the dataset (Telonex sync)**: the eligible universe is frozen
  at 18,635 markets (last: 2026-06-14) until you run the operator-side
  Telonex pipeline (`sync-markets` → `download-raw-files` → `convert`).
  The lab never runs it (convention since U42/D20: it spends operator
  API credits and writes shared DB state). What new data buys,
  mechanically: **~1 month** of new markets → the VENUE-DRIFT refresh
  runs on the new month(s), and a D27-confirmed band fire can reopen the
  specific mechanism-linked question (VENUE-DRIFT consequence mapping)
  under EDGE-SPACE §4; **~15,000 markets in a fresh window** — the
  pristine 5,460-market reserve counts, so ~9,500 NEW markets
  (~3.3 months at ~96/day) → IDEAS #10's parked reversal-mirror test
  (the one open positive lead, ≈ +2.4c net at z = +2.40) becomes
  adequately powered; its unlock further requires venue-drift-quiet
  bands and full pre-registration per the IDEAS entry. Until a sync
  happens, sessions will keep reporting "both wake-up gates closed".
- **Unblocking the worker fleet** (`knowledge/FLEET-GAP.md`, D33): your
  fleet unlock cannot take effect until the engine's strategy registry can
  see `fable-lab/strategies/**`. The fix is authored and verified for you:
  run `git apply fable-lab/knowledge/fleet-gap-registry.patch` from the
  repo root, then commit with `git commit --no-verify` (the pre-commit
  hook YOU installed blocks any commit touching `src/` — bypassing it is
  correct here and only here; do not disable the hook permanently), and
  push (workers self-update). Coupling caveat in
  the memo: after the patch, a malformed lab strategy file would crash
  every engine process on that clone, live bots included. The lab cannot
  apply it itself (the pre-commit hook you installed blocks writes outside
  `fable-lab/`). Until it lands, sessions keep running evidence locally
  `--sequential` and probe the gap every wake-up; once the probe prints
  `RESOLVED`, they will reconcile `tools/submit.ts` to `--detach` fleet
  submissions and build the capacity tool before the next evidence run.
- **Instrumentation unlocks** (`knowledge/EDGE-SPACE.md` §3): the
  `touch_or_better` fill mode turned out to be reachable in-lab (U35/D18,
  no src change needed) and its bracket is already measured and CLOSED
  (E19: both frozen cells lose more at touch than at worst-queue) —
  nothing left for you there. The remaining high-value option is
  **trade-print ingestion** (§3.2): extend the sync/download to the
  Telonex `trades` channel and add a trades-aware converter (operator-side
  `src/` work). Coverage is already measured at 95.9% of the eligible
  universe (U42) — pure historical backfill, no live activity. That one
  change replaces both fill-model bracket ends with a single
  queue-realistic measurement and reopens maker registrations under full
  pre-registration. Live paper at the touch (§3.3) remains the direct
  alternative and needs your authorization.

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
