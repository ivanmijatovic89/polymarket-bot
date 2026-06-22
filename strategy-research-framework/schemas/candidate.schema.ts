import { z } from 'zod'

const CandidateStatus = z.enum([
  'proposed',
  'accepted',
  'implemented',
  'tested',
  'rejected',
  'promoted',
  'blocked',
])

export const CandidateFrontmatterSchema = z.object({
  artifactType: z.literal('strategy-candidate'),
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9-]+\.v[0-9]+\.c[0-9]{3}$/),
  family: z.string().regex(/^[a-z0-9-]+$/),
  parentVersion: z.string().regex(/^v[0-9]+$/),
  status: CandidateStatus,
  tags: z.array(z.string()),
  duplicateKeys: z.array(z.string()),
})

export type CandidateFrontmatter = z.infer<typeof CandidateFrontmatterSchema>
