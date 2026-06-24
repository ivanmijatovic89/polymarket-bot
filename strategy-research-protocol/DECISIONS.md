# Protocol design decisions

Running log of locked decisions. Append-only; if a decision changes, add a new
entry that supersedes the old one (don't silently edit history).

## Architecture

- **Blackboard, not agents-talking-to-agents.** Workers are pure functions:
  read artifacts → do one job → write artifacts + flip one status. They never
  call each other. The orchestrator is a dumb router on status.
- **Files are the memory.** Each worker step is a fresh Claude Code invocation;
  continuity lives in the files, not in any session. Design bar: _a cold agent,
  given only these files, can do the next step correctly._
- **Split by data shape:** numbers → MySQL (`backtest_runs`, referenced by
  `result.ref`); reasoning/state/prose → JSON+MD files (versioned in git).

## Files

- **A family lives in ONE folder: `src/strategies/research/<family>/`** —
  `FAMILY.md` + `FAMILY.json` + `Strategy.ts` co-located. The `.ts` must be under
  `src/` for the registry to import it; artifacts sit beside it. Never split them
  (not under `strategy-research-protocol/`, which holds only specs/schemas).
  Workers create files with `Write` (auto-creates the folder), never `mkdir`.
- `FAMILY.json` = source of truth for one family (status + experiment queue).
- `INDEX.json` = **generated** rollup of all `*/FAMILY.json` (never hand-edited).
- `FAMILY.md` = reasoning: core idea + ranked "Experiments to try" + experiment log
  (the lessons). The lessons are the fuel for the next proposal.
- All artifact filenames are CAPS: `INDEX.json`, `FAMILY.json`, `FAMILY.md`.
- `artifactType` literals are unique per file (for content-based validation):
  `strategy-global-index` / `strategy-family-index` / `strategy-family`.

## Lifecycle

- Stages: **PROPOSE → (RUN → JUDGE → ROUTE)\***, where ROUTE may loop back into
  **NEXT-EXPERIMENT** (→ RUN → JUDGE → ROUTE). `iterate` is not a stage — it's
  ROUTE choosing "commit the next experiment."
- **No separate "implement" worker.** Whoever commits an experiment writes its
  code, at peak context for the idea: propose-family writes the baseline
  `Strategy.ts`; propose-next-experiment writes a variation's `.ts` if it needs
  new code. There is no cold code-handoff from FAMILY.md.
- Experiment carries two separate axes: `status` (pipeline position) and
  `decision` (verdict). They never overlap.
- `kind` (param-search | variation) and `requiresCode` record what an experiment
  is. They are independent: a new family's experiment #1 is `param-search` +
  `requiresCode: true` (its base Strategy.ts is written by propose-family before
  the knobs can be swept). A later param-search reusing existing code is
  `requiresCode: false`. `requiresCode` is now just info (which propose-step
  writes code), not a dispatch to a separate implement worker.

## Experiments to try (was "hypothesis menu")

- propose-family writes a ranked **plain-prose** list of ≥3 ideas in FAMILY.md's
  "Experiments to try" section (captures the research at peak context), but seeds
  **only experiment #1** (baseline sweep) as a concrete row in FAMILY.json.
- No H-ids, no `fromHypothesis` link. The list is reasoning notes, not a machine
  queue. propose-next-experiment picks the next one by _reading_ that list + the
  experiment log and reasoning — there is no structured link to follow.
- Other ideas stay prose-only until results promote them into concrete
  FAMILY.json rows, lazily and result-aware. (Not pre-seeded.)
- Kill gate: family is killed when the "Experiments to try" list is exhausted —
  that is the "did I try enough" guarantee.

## Workers

- **propose-family** and **propose-next-experiment** are two separate workers
  (different inputs/outputs/judgment, focused cold-start prompts). Shared rules
  (NAMING, experiment-row shape, duplicateKeys) live in one shared reference
  both read — not copy-pasted.
- **propose-family input: autonomous, with optional seed.** Default: read the
  research memory (INDEX + lessons) and invent a new non-duplicate family. If a
  one-line seed idea is given, develop the family around that instead. Same
  output either way. Autonomous family generation is the goal of the system.
- **Domain context is a tiny shared `CONTEXT.md`** read by every worker — "the
  game" only (venue, instrument, data in replay, costs, invariant), ~15 lines,
  with pointers to `docs/key-concepts.md` / `docs/how-it-works.md` / `CLAUDE.md`
  for depth. Deliberately minimal — do not over-feed irrelevant code/infra
  context. Shared (not inlined) because 3+ workers need the same game facts.
- **Terminology: never "candidate" — always "experiment."**
- **propose-family input file: `INDEX.json` only** (the map). The agent
  self-directs: it opens any family's `FAMILY.md` (via `path`) to read lessons
  when it judges them relevant. No pre-loaded batch.
- **propose-family output: the new family folder only** (`FAMILY.md` +
  `FAMILY.json`). It does NOT touch `INDEX.json`. The orchestrator runs
  `build-index` afterward to regenerate the rollup — so the worker can never
  corrupt INDEX.
- **propose-family idea source: memory-grounded reasoning, no web in v1.**
  Ideas come from reasoning over the research memory (INDEX + drilled FAMILY.md
  lessons → find the gaps/implications) + the model's microstructure knowledge.
  No internet search in v1 (noisy, non-deterministic, not venue-specific). Web
  may be added later as low-trust inspiration only.
- **propose-family dedup: read code, don't string-match.** `duplicateKeys` /
  `tags` / `coreIdea` in INDEX are only a **cheap shortlist hint** — they pick
  the few families worth inspecting. The actual dedup verdict comes from the
  agent **opening those families' FAMILY.md + Strategy.ts and judging whether
  the decision driver / logic is genuinely the same.** Never auto-reject on key
  overlap — similar-but-different is allowed; only same-actual-logic is a
  duplicate. On a real duplicate: **seed mode** → stop + report; **autonomous
  mode** → try a different idea (bounded retry ~3–5, remembers its own attempts;
  hitting the cap = "space looks saturated", a signal not an error).
- **"Experiments to try" size:** minimum 3, no hard cap, quality-gated. Each
  hypothesis must have a real mechanism/rationale — no padding to hit a number.
  Better 3 strong than 8 with filler.
- **Constraints live in an editable `CONSTRAINTS.md`, not in worker logic.**
  propose-family reads it (alongside INDEX.json) and must not propose anything
  that violates it. The user curates/grows it over time — when a proposal isn't
  wanted, add a line. The replay invariant is just the first entry, not
  special-cased code. CONSTRAINTS.md holds **forbidden-forever** rules only.
  A good-but-not-yet-runnable idea is NOT a constraint — it's captured as a
  family with `status: blocked` + `retryOnlyIf` (the schema already supports it).
