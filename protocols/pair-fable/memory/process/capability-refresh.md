# Process: capability refresh (engine-change self-upgrade)

verified: 2026-07-30 (tool run-verified this date: clean pass, simulated drift
77e4682/9952004, uncovered sweep, ERROR path, --json — see PLAN
`capability-refresh-procedure` evidence)

The engine keeps evolving under us (human-authored `src/` changes land on
origin/main; models never edit `src/`). Capability notes in
`memory/capabilities/` are only trustworthy at the commit they were verified
at. This procedure detects when notes go stale and defines how findings fold
back in.

## The one-command human trigger

```
npx tsx protocols/pair-fable/tools/refresh-capabilities.ts
```

Read-only, ~5 s, fetches origin/main first. Exit 0 = `CLEAN` (all notes
current), exit 1 = `DRIFT` (stale notes, header errors, or uncovered files),
exit 2 = git/usage error. `--json` for automation, `--no-fetch` offline,
`--target <ref>` / `--assume-note-sha <sha>` for testing (see tool header).

## When to run

1. **Human-triggered** — whenever the human announces engine changes (this is
   the mission's "capability self-upgrade" trigger). The human runs the one
   command, or just tells the loop "engine changed, refresh capabilities";
   the session runs it and folds back.
2. **Session-start guard** — any session that is about to design or evaluate
   experiments should run it once at start. If DRIFT, fold back BEFORE
   trusting the notes; a stale simulator/parity note can mis-classify a
   variant.
3. **After every `git pull --rebase` that brings in non-protocol commits** —
   commits not prefixed `pair-fable:`/other-protocol prefixes are engine or
   ops changes; refresh.

## The note header contract (binding for every capabilities/*.md)

```
verified: <YYYY-MM-DD> @ <short-sha> (free-text provenance)
watches: <path>[, <path> ...]
```

- `verified` — the engine commit the note's claims were checked against. The
  parenthetical records HOW (code-survey vs RUN-VERIFIED + run ids).
- `watches` — the engine paths the note's claims depend on. Paths are
  validated against the target tree every run, so a typo or a moved file
  becomes an ERROR instead of silently hiding drift.
- A capabilities note missing either line is reported as ERROR (drift) — the
  tool enforces the contract.

## Fold-back procedure

### STALE note (watched files changed since its SHA)

1. `git diff <noteSha> origin/main -- <changed files>` and read the actual
   change (do not trust the commit message).
2. Update every affected claim; retag with `[code <path>:<lines> @ <newSha>]`.
   If a behavioral claim changed (fill model, fee math, storage columns, CLI
   flags), re-verify by running — a smoke-sized run via `tools/smoke.ts` or a
   targeted probe — before writing the new claim.
3. Only after ALL claims are re-checked, bump the note's `verified:` line to
   the new date + origin/main short SHA.
4. **Re-baseline after semantic engine drift** (MISSION01-REVIEW M4): if the
   drift changed run SEMANTICS (fill model, fee math, latency handling, tick
   semantics — anything that would change a run's numbers, not just tooling),
   existing runs stop being valid comparison baselines/S2 evidence: re-run
   affected screen baselines and treat pre-drift FULL runs as historical
   only. evaluate.ts/compare.ts warn on cross-run engine-SHA mismatch;
   team-workflow rule 4 forbids reusing runs across such drift.
4. Re-run the tool: must report CLEAN.
5. Anything that looks like an engine bug or regression → `state/PROPOSALS.md`
   (never fix src/ yourself). Anything that changes how RESEARCH should run
   (new flags, new metrics) → also update tools/README.md and, if evaluation
   is affected, memory/process/evaluator.md.

### UNCOVERED file (changed in the surveyed area, watched by no note)

Either (a) it belongs to an existing note's subject → add the path to that
note's `watches:` and document what the file does; or (b) it is a new engine
capability → create a new capabilities note with both header lines; or (c) it
is genuinely irrelevant to this protocol (e.g. a symbol we do not trade) →
record it in the "Reviewed and ignored" list below with the SHA and reason, so
the next session does not re-investigate. Never resolve UNCOVERED silently.

### ERROR (bad header, missing SHA in clone, dead watched path)

Fix the header / update the watches line to the moved path, re-run. If a SHA
is missing from the clone, `git fetch --unshallow` or re-verify the note
against origin/main outright.

## Scope and limitations (honest)

- Detection is **path-granular diffing**, not semantic: a changed watched file
  flags the whole note; the fold-back read decides which claims actually
  moved. False positives (e.g. a comment-only change) cost one read; false
  negatives only happen if a claim depends on a path nobody watches — that is
  what the GLOBAL_WATCH uncovered sweep is for.
- GLOBAL_WATCH (in the tool) is the surveyed engine area: src/cli,
  src/backtest, src/trading, src/strategy, src/market, src/db, src/polymarket,
  src/parquet, src/config, package.json, scripts/run-worker.sh, ops. A NEW
  top-level subsystem outside it (example the mission warns about: the coming
  trades+activities dataset) is invisible until GLOBAL_WATCH is extended —
  extending it is part of folding back the first note about that subsystem.
- The uncovered sweep baselines at the OLDEST note SHA; after a fold-back
  bumps all notes, the baseline advances automatically.
- Notes in memory/process/ and memory/experiments/ are not SHA-tracked by the
  tool; experiments are time-scoped by convention (INDEX.md rule 2) and the
  evaluator doc is re-checked when evaluate.ts or its inputs change (its
  claims carry run-id evidence, not code SHAs).

## Reviewed and ignored

(UNCOVERED findings deliberately not folded into notes — SHA, path, reason.)

- none yet
