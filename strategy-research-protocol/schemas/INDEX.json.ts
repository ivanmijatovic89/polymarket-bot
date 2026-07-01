import { z } from 'zod'
import { FamilyStatus, ResultRef, Slug } from './statuses.js'

/** One rollup row in the global index. Generated from each FAMILY.json. */
export const GlobalIndexFamily = z.object({
  family: Slug,
  status: FamilyStatus,
  coreIdea: z.string().min(1),
  /** dedup memory — Proposer checks these before proposing a new family */
  duplicateKeys: z.array(z.string()),
  /** set when killed/blocked: the condition under which to revisit; else null */
  retryOnlyIf: z.string().nullable(),
  /** → FAMILY.md, or null if the idea never became a folder */
  path: z.string().nullable(),
  champion: z.string().nullable(),
  championResult: ResultRef.nullable(),
  tags: z.array(z.string()),
})
export type GlobalIndexFamily = z.infer<typeof GlobalIndexFamily>

/** INDEX.json — generated rollup of all families. Never hand-edited. */
export const GlobalIndex = z.object({
  schemaVersion: z.literal(1),
  artifactType: z.literal('strategy-global-index'),
  families: z.array(GlobalIndexFamily),
})
export type GlobalIndex = z.infer<typeof GlobalIndex>
