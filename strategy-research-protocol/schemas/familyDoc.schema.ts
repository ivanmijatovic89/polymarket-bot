import { z } from 'zod'
import { parse as parseYaml } from 'yaml'
import { FamilyStatus, Slug } from './enums.js'

/**
 * FAMILY.md frontmatter — the human/AI-readable reasoning file.
 */
export const FamilyDocFrontmatter = z.object({
  artifactType: z.literal('strategy-family'),
  family: Slug,
  status: FamilyStatus,
  champion: z.string().nullable(),
  tags: z.array(z.string()),
})
export type FamilyDocFrontmatter = z.infer<typeof FamilyDocFrontmatter>

/** Required H2 sections in the FAMILY.md body, in canonical order. */
export const REQUIRED_FAMILY_DOC_SECTIONS = [
  'Core idea',
  'Primary decision driver',
  'Experiments to try',
  'Allowed experiment directions',
  'Forbidden directions',
  'Known weaknesses',
  'Experiment log',
  'Duplicate notes',
] as const

/** Pull `## Heading` titles (level-2 only) from markdown body text. */
export function extractH2(markdown: string): string[] {
  return [...markdown.matchAll(/^##[ \t]+(.+?)[ \t]*$/gm)].map((m) => m[1])
}

/**
 * Full-document schema: validated frontmatter + the list of H2 headings found
 * in the body. Fails if any required section is missing.
 *
 * Use `parseFamilyDoc(raw)` to go straight from file text to a validated doc.
 */
export const FamilyDoc = z
  .object({
    frontmatter: FamilyDocFrontmatter,
    headings: z.array(z.string()),
  })
  .superRefine((doc, ctx) => {
    const present = new Set(doc.headings)
    for (const section of REQUIRED_FAMILY_DOC_SECTIONS) {
      if (!present.has(section)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['headings'],
          message: `Missing required H2 section: "## ${section}"`,
        })
      }
    }
  })
export type FamilyDoc = z.infer<typeof FamilyDoc>

/** Validate raw FAMILY.md text: parses frontmatter + extracts H2s, then checks both. */
export function parseFamilyDoc(raw: string): FamilyDoc {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) throw new Error('FAMILY.md is missing YAML frontmatter')
  const frontmatter = parseYaml(m[1])
  const body = raw.slice(m[0].length)
  return FamilyDoc.parse({ frontmatter, headings: extractH2(body) })
}
