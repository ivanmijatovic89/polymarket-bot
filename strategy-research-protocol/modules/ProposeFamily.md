# Worker: propose-family

Propose **one** new strategy family and make its baseline experiment ready to
run. This worker writes the family memory files and `000-baseline.ts`, then
stops. It does not run backtests, judge results, promote champions, or edit
[`src/strategies/research/INDEX.json`](../../src/strategies/research/INDEX.json).

## Output

Create exactly one folder:

```text
src/strategies/research/<family>/
  FAMILY.md
  FAMILY.json
  000-baseline.ts
```

Do not write family artifacts under `strategy-research-protocol/`. Strategy
code must live under `src/` so auto-discovery can import it.

## Inputs

Read these before writing:

- [`strategy-research-protocol/RESEARCH_SCOPE.md`](../RESEARCH_SCOPE.md) —
  research scope and market assumptions.
- [`strategy-research-protocol/PolymarketTwinEngine.md`](../PolymarketTwinEngine.md) —
  tick, replay, order, cost, latency, and dataset semantics.
- [`src/strategies/research/INDEX.json`](../../src/strategies/research/INDEX.json) —
  generated map of existing research families for deduplication (including
  `verdictSummary` and `retryOnlyIf` of killed families — lessons to not
  repeat).
- [`strategy-research-protocol/MEMORY.md`](../MEMORY.md) — memory rules and
  field tables.
- [`strategy-research-protocol/CONSTRAINTS.md`](../CONSTRAINTS.md) — hard ban
  list.
- [`strategy-research-protocol/LESSONS.md`](../LESSONS.md) — cross-family
  lessons; a proposal that ignores a recorded lesson is a defective proposal.
- [`strategy-research-protocol/STAGE-GATES.md`](../STAGE-GATES.md) — the
  gates the baseline will face; stage-1 coverage sizes the sweep.
- [`strategy-research-protocol/rules/FAMILY-NAMING.md`](../rules/FAMILY-NAMING.md),
  [`strategy-research-protocol/rules/EXPERIMENT-NAMING.md`](../rules/EXPERIMENT-NAMING.md),
  [`strategy-research-protocol/rules/BATCH-UID.md`](../rules/BATCH-UID.md).
- `strategy-research-protocol/schemas/` — exact shapes for both files.

Optional input: a one-line seed idea from the user. Without a seed, propose
autonomously from research memory.

## Dedup Scope

Deduplication is against research families only, via
[`src/strategies/research/INDEX.json`](../../src/strategies/research/INDEX.json).
Open a listed family's files when the index suggests overlap. Do not scan the
legacy strategy library outside `src/strategies/research/` for deduplication;
reading a few non-research strategies only for API idioms is allowed.

## Steps

1. **Read required context.** Do not propose from memory alone.

2. **Form one idea.** Seed mode: develop the user's seed unless it violates
   constraints or duplicates. Autonomous mode: use INDEX.json (especially
   killed families' lessons), constraints, and market microstructure
   reasoning. Do not search the web.

3. **Constraint check.** If the idea violates
   [`strategy-research-protocol/CONSTRAINTS.md`](../CONSTRAINTS.md), discard
   it. In seed mode, stop and report the violated constraint.

4. **Edge economics gate.** Costs are measured, never modeled
   ([`strategy-research-protocol/STAGE-GATES.md`](../STAGE-GATES.md)). The
   gate is a mechanism argument: why should THIS edge be structurally fat —
   who is on the other side, and what do the measured numbers of comparable
   past strategies say (killed families' outcomes in INDEX.json, LESSONS.md,
   segments of prior runs)? If comparable strategies were measured
   fee-bound and this idea brings nothing structurally different, the
   family must not be proposed. This argument — with the cited measured
   numbers — becomes the Edge economics section.

5. **Dedup by driver, not by words.** Shortlist with `duplicateKeys`, `tags`,
   `coreIdea`. Same primary decision driver = same family, even if params,
   filters, exits, or wording differ. On a true duplicate: seed mode — stop
   and report, write nothing; autonomous mode — try another idea, and after
   3-5 attempts that all duplicate, report saturation.

6. **Choose the family slug** per
   [`strategy-research-protocol/rules/FAMILY-NAMING.md`](../rules/FAMILY-NAMING.md).

7. **Write `FAMILY.md`** with the minimal frontmatter and exactly these H2
   sections in order (shapes in `schemas/FAMILY.md.ts`):

   ```text
   ## Thesis
   ## Signal definition
   ## Edge economics
   ## Experiment roadmap
   ## Duplicate notes
   ## Research log
   ```

   - **Thesis** — who is on the other side of this trade, why the mispricing
     exists, why it has not been arbitraged away.
   - **Signal definition** — precise formulas over recorded fields only.
   - **Edge economics** — the step-4 math: expected gross edge vs the cost
     floor, with numbers.
   - **Experiment roadmap** — at least **5 mechanism-distinct** ranked ideas
     beyond the baseline (the empirical-kill rule requires exhausting them).
     These are NOT queued experiments; they stay prose until the Researcher
     specs them.
   - **Duplicate notes** — near-duplicate reasoning matching `duplicateKeys`.
   - **Research log** — leave empty except the heading; only the Researcher
     appends entries.

8. **Write `FAMILY.json`** (schema v2) with exactly one queued experiment:

   ```json
   {
     "schemaVersion": 2,
     "artifactType": "strategy-family-index",
     "family": "<family>",
     "status": "proposed",
     "coreIdea": "<one sentence>",
     "duplicateKeys": ["<normalized-synonym>"],
     "retryOnlyIf": null,
     "champion": null,
     "verdictSummary": null,
     "tags": ["<tag>"],
     "experiments": [
       {
         "id": "000-baseline",
         "kind": "param-search",
         "code": "000-baseline.ts",
         "basedOn": null,
         "hypothesis": "<one sentence: what the baseline mechanism should show>",
         "successCriteria": "Best cell netEvPerMarket > 0 at stage-1 coverage (STAGE-GATES.md gate 1).",
         "params": null,
         "search": {
           "mode": "coordinate",
           "defaults": { "<param>": "<value>" },
           "passes": [
             {
               "param": "<highest-impact-param>",
               "values": ["<v1>", "<v2>", "<v3>"],
               "batchUid": "<family>--000-baseline--p1-<param>",
               "submissionUids": [],
               "best": null,
               "note": null
             }
           ]
         },
         "batchUid": null,
         "submissionUids": [],
         "baselineId": null,
         "coverage": null,
         "status": "queued",
         "gateLog": [],
         "submittedAt": null,
         "decidedAt": null,
         "abortReason": null,
         "outcome": null
       }
     ]
   }
   ```

   - Declare `defaults` for every knob and justify them in FAMILY.md (Signal
     definition or Edge economics) — pass 1 sweeps against these defaults, so
     bad defaults poison the whole search.
   - Pre-declare one pass per param, ordered by expected impact, with pass
     batchUids per [`strategy-research-protocol/rules/BATCH-UID.md`](../rules/BATCH-UID.md).
     Empty `submissionUids` = not submitted.

9. **Write `000-baseline.ts`.** Learn the local API from
   `src/strategy/strategyDefinition.ts`, `src/strategy/Strategy.ts`,
   `src/strategy/strategyToolkit.ts`, and
   `src/strategies/templates/Template.v1.ts`. Export `definition` with
   `definition.id = "<family>.000-baseline"` and a strict Zod params schema
   whose knobs match `search.defaults`. Deterministic behavior only; safe
   when optional plugin data is missing; deterministic `clientOrderId`
   patterns; no registry edits (auto-discovery).

10. **Typecheck enough to catch API errors. Do not run a backtest.**

11. **Leave INDEX.json alone.** The orchestrator runs `buildStrategyIndex`
    afterward.

## Forbidden

- Running backtests or judging results.
- Editing INDEX.json or another family's files.
- Seeding more than one experiment, or putting roadmap ideas in FAMILY.json.
- Writing anything into the Research log.
- Creating versioned files or `v1`/`v2` ids.
- Marking the family anything but `proposed`.
- Using live-only fields, unrecorded transport behavior, or external feed
  data as a required backtest input.

## Final Self-Check

- Both files validate (`npm run research:check` passes for this family).
- FAMILY.json has exactly one experiment, `000-baseline`, status `queued`,
  with `hypothesis` + `successCriteria` + full coordinate `search`.
- The Edge economics section contains actual numbers, not vibes.
- The roadmap has at least 5 mechanism-distinct ideas.
- `000-baseline.ts` exports `definition` with the mechanical id; sweep knobs
  match the params schema.
- `champion` is null; Research log is empty; no backtest was run; INDEX.json
  untouched.

## Stop Condition

Stop after one valid family is ready for its smoke test, or after reporting a
duplicate, constraint violation, failed edge-economics gate, or saturated
idea space with nothing written.
