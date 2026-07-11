# RUNBOOK — morning operator guide

How to start driving research with the Fable protocol, step by step.
Assumes: repo cloned, `.env` with DB/Redis credentials. Evidence runs go
through the distributed worker fleet (`--detach`, committed+pushed code);
smokes/debug stay local `--sequential`. Nothing here trades live.

## 0. Five-minute orientation (once)

Read in this order — ~15 pages total:
1. `fable-lab/protocol/README.md` — the map and the loop.
2. `fable-lab/protocol/EPISTEMOLOGY.md` — what a verdict means.
3. `fable-lab/DECISIONS.md` — why it is built this way.

## 1. Where strategies live and how runs execute

Strategies live in `fable-lab/strategies/<mechanism>/EXP-NNN.ts` (the
pre-commit hook restricts commits to `fable-lab/`). Since 2026-07-11 the
engine registry ALSO discovers that directory (you applied
`knowledge/fleet-gap-registry.patch` as commit a10b59d — D33/U58), so
fleet workers resolve `fable-exp-*` ids and evidence runs go through the
fleet: `tools/submit.ts` emits bare-CLI `--detach` commands for
probe/main/lat/grid/holdout (with D8 latency pins shipped in job data
from the submitter's env, verified empirically in U58 on runs 421/422),
and REFUSES to submit from a dirty or unpushed tree — workers execute
`origin/fable-protocol`, not your working copy. Smokes, debug, and parity checks stay
local `--sequential` through the injection wrapper
`fable-lab/tools/run-backtest.ts` (charter). Check live capacity before
sizing a batch: `npx tsx fable-lab/tools/capacity.ts --markets <N>`
(fleet size CHANGES; never assume). Sessions submit detached and keep
working.

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
- **Growing the dataset (Telonex ingestion) — ACTION PENDING (U64/D38,
  2026-07-11)**: the eligible universe is frozen at 18,635 markets (last:
  2026-06-14) until `download-raw-files` + `convert` run for the pending
  window. The CATALOG SYNC half is now lab-self-serve (D38: verified
  additive-only; the lab ran it 2026-07-11 and keeps the catalog current) —
  **2,570 synced markets (2026-06-14 → 2026-07-11) are waiting on you**:
  `npm run telonex:download` then `npm run telonex:convert` (~25 GB raw to
  R2 + ~3.9 GB converted; costed hand-off with per-market figures in
  `knowledge/DATASET-GROWTH.md`). The lab does not run download/convert
  itself (D38: it spends your metered Telonex key and R2 storage). What
  ingestion buys, mechanically: **this pending window alone** → the
  VENUE-DRIFT refresh runs on 2026-06/07, and a D27-confirmed band fire
  can reopen the specific mechanism-linked question (VENUE-DRIFT
  consequence mapping) under EDGE-SPACE §4; **~15,000 markets in a fresh
  window** — the pristine 5,460-market reserve counts, so ~9,500 NEW
  markets (~3.3 months at ~96/day; ~7,000 beyond the pending window,
  ≈ late September 2026 with continuous ingestion) → IDEAS #10's parked
  reversal-mirror test (the one open positive lead, ≈ +2.4c net at
  z = +2.40) becomes adequately powered; its unlock further requires
  venue-drift-quiet bands and full pre-registration per the IDEAS entry.
  `tools/universe.ts` prints the CATALOG AWAITING INGESTION count.
- **Worker fleet: UNBLOCKED (2026-07-11, D33/U58).** You applied
  `knowledge/fleet-gap-registry.patch` (commit a10b59d); the lab executed
  its pre-committed reconciliation the same day: submit.ts fleet routing
  with a committed+pushed refusal gate, `tools/capacity.ts`, and an
  empirical D8 re-verify (runs 421/422: 10/10 markets each, 0 failures,
  job payloads carry `latency {0,0}` from the submitter env; holdout
  sweep re-run: no new rows vs the classified baseline — exit 2 comes
  from the 67 pre-existing classified rows). Standing caveat from the memo
  still applies: a malformed/duplicate-id lab strategy file now crashes
  every engine process at import on clones with the patch, live bots
  included — the wrapper's same-id-different-object guard throws locally
  before such a file can be pushed, but treat new strategy files with
  care.
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
