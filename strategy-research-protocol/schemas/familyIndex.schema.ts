import { z } from 'zod'
import {
  Decision,
  ExperimentKind,
  ExperimentStatus,
  FamilyStatus,
  ResultRef,
  Slug,
} from './enums.js'

/** One experiment = one hypothesis from the family's menu. */
export const Experiment = z.object({
  /** "<family>.<NNN>-<short-kebab-name>", e.g. "book-imbalance.001-baseline-sweep" */
  id: z.string().min(1),
  /** run order; 1 is reserved for the baseline param sweep */
  order: z.number().int().positive(),
  kind: ExperimentKind,
  /** false → straight to backtest; true → Implementer writes code first */
  requiresCode: z.boolean(),
  /** which .ts this experiment runs against, e.g. "Strategy.ts" */
  code: z.string().min(1),
  /** one-line label (full rationale lives in FAMILY.md) */
  idea: z.string().min(1),
  /** param grid for a param-search, else null */
  sweep: z.record(z.string(), z.array(z.unknown())).nullable(),
  /** fixed params for a single run, else null */
  params: z.record(z.string(), z.unknown()).nullable(),
  status: ExperimentStatus,
  decision: Decision,
  /** pointer into backtest_runs once it has run, else null */
  result: ResultRef.nullable(),
  /** winning param cell the Evaluator picked from the sweep; null until judged */
  selectedParams: z.record(z.string(), z.unknown()).nullable(),
})
export type Experiment = z.infer<typeof Experiment>

/** FAMILY.json — the structured source of truth for one family. */
export const FamilyIndex = z.object({
  schemaVersion: z.literal(1),
  artifactType: z.literal('strategy-family-index'),
  family: Slug,
  status: FamilyStatus,
  coreIdea: z.string().min(1),
  /** normalized synonyms of this family's idea — dedup hints for future proposals */
  duplicateKeys: z.array(z.string()).default([]),
  /** when killed/blocked: the condition under which to revisit; else null */
  retryOnlyIf: z.string().nullable().default(null),
  /** winning experiment id, or null */
  champion: z.string().nullable(),
  tags: z.array(z.string()),
  experiments: z.array(Experiment),
})
export type FamilyIndex = z.infer<typeof FamilyIndex>
