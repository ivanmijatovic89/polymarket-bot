import { z } from 'zod'

const VersionStatus = z.enum(['active', 'archived', 'blocked'])

const CandidateStatus = z.enum([
  'proposed',
  'accepted',
  'implemented',
  'tested',
  'rejected',
  'promoted',
  'blocked',
])

const VersionEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+\.v[0-9]+$/),
  status: VersionStatus,
  summary: z.string().min(1),
  path: z.string().min(1),
})

const CandidateEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+\.v[0-9]+\.c[0-9]{3}$/),
  status: CandidateStatus,
  summary: z.string().min(1),
  tags: z.array(z.string()),
  duplicateKeys: z.array(z.string()),
  path: z.string().min(1),
})

const BlockedIdeaSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  summary: z.string().min(1),
  reason: z.string().min(1),
  duplicateKeys: z.array(z.string()),
})

export const FamilyIndexSchema = z.object({
  schemaVersion: z.literal(1),
  artifactType: z.literal('strategy-family-index'),
  family: z.string().regex(/^[a-z0-9-]+$/),
  versions: z.array(VersionEntrySchema),
  candidates: z.array(CandidateEntrySchema),
  blockedIdeas: z.array(BlockedIdeaSchema),
})

export type FamilyIndex = z.infer<typeof FamilyIndexSchema>
