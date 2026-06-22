import { z } from 'zod'

const FamilyStatus = z.enum(['proposed', 'active', 'archived', 'blocked'])

const FamilyEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  status: FamilyStatus,
  title: z.string().min(1),
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

export const GlobalIndexSchema = z.object({
  schemaVersion: z.literal(1),
  artifactType: z.literal('strategy-global-index'),
  families: z.array(FamilyEntrySchema),
  blockedIdeas: z.array(BlockedIdeaSchema),
})

export type GlobalIndex = z.infer<typeof GlobalIndexSchema>
