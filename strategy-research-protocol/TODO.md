# TODO

Working checklist for building out Strategy Research Protocol, in order. Keep
this file current: check items off as they land, add follow-ups as they appear.

## 1. Naming and versioning rules

Decision: **no version numbers.** Every code experiment is one immutable file
named by its experiment id; the champion is a pointer in `FAMILY.json`.

- [x] Split `rules/NAMING.md` into
      [`strategy-research-protocol/rules/FAMILY-NAMING.md`](./rules/FAMILY-NAMING.md)
      and
      [`strategy-research-protocol/rules/EXPERIMENT-NAMING.md`](./rules/EXPERIMENT-NAMING.md);
      delete `NAMING.md` and the `VERSIONING.md` stub.
- [x] Experiment id `NNN-short-hypothesis` (local to family, `000-baseline`
      reserved); code file = `<experiment-id>.ts`; registry id =
      `<family>.<experiment-id>`.
- [x] Champion pointer + freeze rule (files with results are never edited or
      deleted).

## 2. Clean up backtest tool docs

- [x] Batch UID naming convention →
      [`strategy-research-protocol/rules/BATCH-UID.md`](./rules/BATCH-UID.md)
      (`<family>--<experiment-id>`, sweeps share one batchUid, re-runs append
      `--rN`).
- [x] Commit-before-run rule: canonical section "Workers Run Committed Code
      Only" in
      [`strategy-research-protocol/PolymarketTwinEngine.md`](./PolymarketTwinEngine.md),
      one-line Precondition pointers in both tool docs (workers self-update;
      the old restart-workers rule is obsolete).
- [x] [`strategy-research-protocol/tools/runBacktest.md`](./tools/runBacktest.md):
      define how a sweep grid becomes runs (link BATCH-UID.md).
- [x] [`strategy-research-protocol/tools/extendBacktest.md`](./tools/extendBacktest.md):
      align with the same conventions; clarify when extending is preferred over
      a new run.

## 3. Make PolymarketTwinEngine.md concrete

- [x] Rework
      [`strategy-research-protocol/PolymarketTwinEngine.md`](./PolymarketTwinEngine.md)
      with concrete numbers and details (tick semantics, costs/fees, order
      types, latency model, dataset shape) instead of abstract prose.

## 4. Rewrite ProposeFamily from scratch

- [x] [`strategy-research-protocol/modules/ProposeFamily.md`](./modules/ProposeFamily.md)
      is an old file — rewrite it from scratch against the updated rules,
      schemas, and tool docs from steps 1–3.

## 5. Settle FAMILY.md / FAMILY.json format

- [x] Revisit the FAMILY.md format (frontmatter fields, required sections) and
      FAMILY.json schema — adjust/simplify where needed.
- [x] Resolve the dual-source-of-truth overlap (status/champion/tags exist in
      both files today).
- [x] Adopt the new experiment model in the schemas: local
      `NNN-short-hypothesis` experiment ids, `champion` as an experiment id
      string (code/params resolved via the experiment record), `decidedAt`
      timestamp on experiments (champion history is derived: decision =
      `promote` ordered by `decidedAt`; latest must equal `champion`),
      `basedOn` lineage field, and the `000-baseline` convention (replaces
      `001-baseline-sweep`); keep `kind: param-search|variation` for now
      because tools still need to distinguish sweep-only experiments from
      code-changing experiments.
- [x] Update `strategy-research-protocol/schemas/` and
      `strategy-research-protocol/examples/` to match (current examples
      contradict the rules: two seeded experiments, champion mismatch, stray
      `---` after frontmatter).
- [x] Migrate the existing `src/strategies/research/liquidity-wall/` family
      from the old convention (`Strategy.ts`, `LiquidityWall.v1`) to
      `000-baseline.ts` / `liquidity-wall.000-baseline`.

## 6. Continue the loop

- [ ] Next protocol pieces after 1–5: evaluator contract
      (`modules/EvaluateExperiment.md`), result-aware experiment proposal
      (`modules/ProposeNextExperiment.md`), one-iteration research worker
      (`modules/ResearchFamily.md`), and `npm run research:check` validation.
