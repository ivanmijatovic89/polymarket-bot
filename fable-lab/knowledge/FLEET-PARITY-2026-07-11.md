# Fleet/local numeric parity — verified 2026-07-11 (U62, D36)

## Question

Every published number in the lab's evidence chain (E9–E23) was produced on
the LOCAL execution path (wrapper `run-backtest.ts --sequential`). Since U58,
all future evidence runs go through the WORKER FLEET (bare engine CLI +
`--detach`, executed on remote worker machines). U58 verified plumbing
(completion, 0 failures) and D8 latency pinning (job payloads carry
`delayMs:0, jitterMs:0`), but nobody had checked that the two paths persist
**identical per-market numbers** for the same spec. If they differed, future
fleet evidence would not be comparable to the local-path conclusions, and
determinism itself (charter scope: "non-deterministic strategy behavior
across replay runs" is forbidden) would be in doubt on the path that now
carries all evidence.

## Method

- Fleet reference runs: 421 (`FLEET-SMOKE-D8`) and 422 (`FLEET-SMOKE-D8B`) —
  fable-exp-006 (killed mechanism, E16/E19; plumbing-only smokes from U58),
  10 random pre-boundary markets each, executed by fleet workers on commit
  `cab72171`, latency pinned 0/0 in the job payloads (verified U58).
- Precondition verified: `git diff --stat cab72171..HEAD -- src/ drizzle/
  package.json package-lock.json` is EMPTY — the local engine at HEAD
  (1a96a8c) is byte-identical to what the workers executed, so any row
  difference would be attributable to the execution path, not code drift.
- Local candidate run: 424 (`FLEET-PARITY-LOCAL`) — the exact 20 slugs from
  runs 421+422, same strategy + params (`offset=0.01, quietRangeMax=0.08`,
  all other params at the same defaults, verified identical in
  `backtest_runs.params`), wrapper `--sequential`, env pinned
  `BACKTEST_LATENCY_DELAY=0 BACKTEST_LATENCY_JITTER=0` (E7 trap; the run log
  carries the U41 `[fable] latency env: ...=0 ...=0` line). Completed 20/20,
  0 failures.
- Comparator: new `tools/parity.ts` — matches rows by slug and compares 18
  deterministic columns: marketStartMs, finalOutcome, skipReason, pnl,
  tradeCount, tradeAsMaker, tradeAsTaker, feesPaid, avgEntryPriceUp/Down,
  upShares, downShares, mergableShares, cost, splitCost, eventsProcessed,
  eventsByType, intentMeta. Decimal columns are compared numerically (scale
  differences are not false mismatches). Excluded by design: machineId,
  workerChildId, wall-clock timestamps/durations, commitSha (provenance,
  checked separately above), idx (submission-order dependent under
  `--random`).

## Result — PARITY HOLDS

```
parity 421 vs 424 (fable-exp-006): shared=10 onlyIn421=0 onlyIn424=10 fields=18 mismatches=0
PARITY (intersection): 10 rows identical across 18 fields
parity 422 vs 424 (fable-exp-006): shared=10 onlyIn422=0 onlyIn424=10 fields=18 mismatches=0
PARITY (intersection): 10 rows identical across 18 fields
```

All 20 fleet-persisted rows are identical to the locally reproduced rows in
every compared field — including `intentMeta` (full strategy decision
metadata) and `eventsProcessed`/`eventsByType` (replay stream identity).
Exit code 0 both comparisons.

## Comparator verification (D28 discipline — every branch exercised)

A comparator whose MISMATCH branch never fired is observationally identical
to a broken one. Exercised this session, real exit codes captured pipe-free:

- Field mismatches REAL: runs 352 vs 353 (the U35 worst_queue-vs-touch debug
  pair, same strategy+params, fill mode differs) → MISMATCH lines on
  pnl/tradeCount/tradeAsMaker/entry prices/shares/cost/intentMeta/skipReason,
  exit 2. (Outcome-exposure disclosure: this printed PnL values for the
  EXP-000-debug pair whose PnL had never been read. Both ends of that
  mechanism are dead and published — E16/E19 — so no open hypothesis is
  touched; recorded here for lineage completeness.)
- Disjoint slug sets, strict mode → coverage counts + slug lists, exit 2.
- Disjoint slug sets, `--intersection` with shared=0 → still exit 2
  (non-empty intersection required).
- Incomparable specs (different strategy, run 415) → refusal, exit 1.
- Usage error (one arg) → exit 1.
- Full parity (421 vs 424) → exit 0.
- `tsc --noEmit` clean over src (tool compiles under the repo tsconfig).

## Scope and caveats

- This proves path-equivalence for ONE strategy (fable-exp-006: GTC maker
  quoting — exercises place/cancel/requote/maker-fill/settlement code) on 20
  markets with engine code identical between the paths. It is evidence of
  engine determinism across execution environments, not a guarantee under
  code drift: any future parity question must first re-check
  `git diff <workerSha>..<localSha> -- src/` emptiness (the tool's spec
  comparability check does NOT check commit shas; rows carry `commit_sha`
  for that).
- Taker fills, splits/merges, and the batch intent path are not exercised by
  this strategy; parity for those code paths rests on the same determinism
  argument but is not separately measured here.
- Outcome safety of the tool: on full parity it prints only counts; values
  appear ONLY on mismatch. Parity checks on a live mechanism are safe when
  they pass; a mismatch printout on a live mechanism would be outcome
  exposure and must be disclosed as lineage in the experiment file.
- Additional disclosure: the run-421/422 inspection step of this unit
  printed per-market pnl for the two fleet smokes (killed strategy,
  plumbing-only runs) — immaterial for the same reason as above.

## Standing use (D36)

After any future fleet evidence run where per-market numbers will be cited,
a 10–20 market local parity spot-check (same slugs, wrapper `--sequential`,
D8 pins, `parity.ts --intersection`) is the cheap way to detect execution-
environment drift (node version, dependency drift on workers, data-file
divergence). It is NOT mandatory per-run — it becomes mandatory when (a) a
worker machine changes node/OS/dependency versions, (b) the first evidence
run after an operator merge touching src/, or (c) any anomaly in a fleet run
log suggests environment differences. Post-run holdout sweep re-run after
run 424: no new post-boundary rows (67 pre-existing classified rows, run 424
CLEAN).

## Post-verification addendum (U62b — D31 verifier findings, all applied)

The D31 fresh-context verifier (verdict: sound-with-findings) independently
reproduced every load-bearing claim — DB state, code-identity diff, both
parity runs, all negative branches pipe-free — and additionally re-compared
all 20 row pairs on RAW driver strings without the canon() normalization:
0 diffs. The parity is therefore byte-level on the real data, stronger than
the canon-normalized identity the tool itself establishes. Findings applied:

1. **"byte-identical" wording** (D36/journal) overclaimed what the TOOL
   proves — it proves canon-normalized identity; byte identity is true here
   only because the verifier checked raw strings independently. Wording now
   scoped in D36; treat future PARITY exits as numeric identity unless a raw
   sweep is repeated.
2. **`marketId` was silently excluded** — now compared (FIELDS is 19
   columns; deterministic per slug, a divergence would mean slug→market
   resolution or catalog drift). Re-run after the change: parity 421/422 vs
   424 holds across all 19 fields, exit 0; the 352-vs-353 mismatch branch
   still fires (66 lines, exit 2).
3. **Cross-machine scope was narrower than the caveats stated**: 6 of the
   20 fleet rows (3 per run) were executed by a worker on THIS machine
   (machineId 8955f8d87c59 = local node-machine-id), and only 2 of the
   fleet's 3 machines contributed rows. Genuine cross-environment evidence
   is 14 rows from one remote machine (527674ef4858); the third machine's
   environment is untested. The path-equivalence claim (wrapper vs worker
   code path) still rests on all 20 rows.
4. **The Result block above is trimmed tool output** (slug-list lines and
   the "(no outcome values printed)" suffix elided; field count read 18 at
   the time) — figures unchanged, elision now declared. The tool now prints
   fields=19.

Verifier count correction (ours, not its): the report cited "67 real
MISMATCH lines" for 352 vs 353; both the committed and the amended tool
print 66 (re-verified). Immaterial — the branch fires either way.
