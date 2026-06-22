import { z } from 'zod'

const FamilyStatus = z.enum(['proposed', 'active', 'archived', 'blocked'])

export const FamilyFrontmatterSchema = z.object({
  artifactType: z.literal('strategy-family'),
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9-]+$/),
  status: FamilyStatus,
  tags: z.array(z.string()),
  duplicateKeys: z.array(z.string()),
})

export type FamilyFrontmatter = z.infer<typeof FamilyFrontmatterSchema>
