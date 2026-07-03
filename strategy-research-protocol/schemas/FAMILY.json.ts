import { z } from 'zod'
import {
  Decision,
  ExperimentId,
  ExperimentKind,
  ExperimentStatus,
  FamilyStatus,
  ResultRef,
  Slug,
} from './statuses.js'

/** One experiment = one hypothesis from the family's menu. */
export const Experiment = z.object({
  /** Local id, e.g. "000-baseline" or "002-persistence-filter". */
  id: ExperimentId,
  /** run order; 1 is reserved for the baseline param sweep. */
  order: z.number().int().positive(),
  kind: ExperimentKind,
  /** Which .ts this experiment runs against, e.g. "000-baseline.ts". */
  code: z.string().min(1),
  /** one-line label (full rationale lives in FAMILY.md) */
  idea: z.string().min(1),
  /** local experiment id this experiment branches from, or null for baseline */
  basedOn: ExperimentId.nullable().default(null),
  /** param grid for a param-search, else null */
  sweep: z.record(z.string(), z.array(z.unknown())).nullable(),
  /** fixed params for a single run, else null */
  params: z.record(z.string(), z.unknown()).nullable(),
  status: ExperimentStatus,
  decision: Decision,
  /** ISO timestamp set when the evaluator records a non-pending decision. */
  decidedAt: z.string().datetime().nullable().default(null),
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
  /** winning local experiment id, or null */
  champion: ExperimentId.nullable(),
  tags: z.array(z.string()),
  experiments: z.array(Experiment),
}).superRefine((fam, ctx) => {
  const ids = new Set<string>()
  for (const exp of fam.experiments) {
    if (ids.has(exp.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['experiments'],
        message: `Duplicate experiment id: ${exp.id}`,
      })
    }
    ids.add(exp.id)
  }

  const baseline = fam.experiments.find((e) => e.id === '000-baseline')
  if (!baseline) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['experiments'],
      message: 'Missing required baseline experiment: 000-baseline',
    })
  } else {
    if (baseline.order !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['experiments'],
        message: '000-baseline must have order 1',
      })
    }
    if (baseline.code !== '000-baseline.ts') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['experiments'],
        message: '000-baseline must use code "000-baseline.ts"',
      })
    }
  }

  if (fam.champion !== null && !ids.has(fam.champion)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['champion'],
      message: `Champion does not match an experiment id: ${fam.champion}`,
    })
  }

  for (const exp of fam.experiments) {
    if (exp.basedOn !== null && !ids.has(exp.basedOn)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['experiments'],
        message: `Experiment ${exp.id} is based on unknown experiment ${exp.basedOn}`,
      })
    }
    if (exp.decision === 'promote' && exp.decidedAt === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['experiments'],
        message: `Promoted experiment ${exp.id} must set decidedAt`,
      })
    }
  }

  const promotions = fam.experiments
    .filter((e) => e.decision === 'promote' && e.decidedAt !== null)
    .sort((a, b) => a.decidedAt!.localeCompare(b.decidedAt!))

  if (promotions.length === 0) {
    if (fam.champion !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['champion'],
        message: 'Champion must be null when no experiment has decision "promote"',
      })
    }
  } else {
    const latestPromotion = promotions[promotions.length - 1]
    if (fam.champion !== latestPromotion?.id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['champion'],
        message: 'Champion must equal the latest promoted experiment by decidedAt',
      })
    }
  }
})
export type FamilyIndex = z.infer<typeof FamilyIndex>
