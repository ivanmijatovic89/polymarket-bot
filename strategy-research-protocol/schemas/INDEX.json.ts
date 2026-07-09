import { z } from 'zod'
import { OutcomeMetrics } from './FAMILY.json.js'
import { ExperimentId, FamilyStatus, Slug } from './statuses.js'

/**
 * One rollup row in the global index. Generated from each FAMILY.json so
 * ProposeFamily dedup and inspiration work from INDEX.json alone.
 */
export const GlobalIndexFamily = z.object({
  family: Slug,
  status: FamilyStatus,
  coreIdea: z.string().min(1),
  /** who proposed the family (FAMILY.json proposedBy), or null on pre-attribution families */
  proposedBy: z.string().nullable(),
  /** dedup memory — Proposer checks these before proposing a new family */
  duplicateKeys: z.array(z.string()),
  /** set when killed: the condition under which to revisit; else null */
  retryOnlyIf: z.string().nullable(),
  /** one-sentence family verdict, set at kill/validated; else null */
  verdictSummary: z.string().nullable(),
  /** → FAMILY.md, or null if the idea never became a folder */
  path: z.string().nullable(),
  champion: ExperimentId.nullable(),
  /** champion's outcome metrics, or null when no champion */
  championMetrics: OutcomeMetrics.nullable(),
  /** highest stage the champion passed, or null when no champion */
  championStageReached: z.number().int().nonnegative().nullable(),
  tags: z.array(z.string()),
})
export type GlobalIndexFamily = z.infer<typeof GlobalIndexFamily>

/** INDEX.json — generated rollup of all families. Never hand-edited. */
export const GlobalIndex = z.object({
  schemaVersion: z.literal(2),
  artifactType: z.literal('strategy-global-index'),
  families: z.array(GlobalIndexFamily),
})
export type GlobalIndex = z.infer<typeof GlobalIndex>
