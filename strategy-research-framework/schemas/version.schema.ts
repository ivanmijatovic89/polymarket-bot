import { z } from 'zod'

const VersionStatus = z.enum(['active', 'archived', 'blocked'])

export const VersionFrontmatterSchema = z.object({
  artifactType: z.literal('strategy-version'),
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9-]+\.v[0-9]+$/),
  family: z.string().regex(/^[a-z0-9-]+$/),
  status: VersionStatus,
})

export type VersionFrontmatter = z.infer<typeof VersionFrontmatterSchema>
