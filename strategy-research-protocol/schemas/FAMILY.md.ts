import { z } from 'zod'
import { parse as parseYaml } from 'yaml'
import { ExperimentId, Slug } from './statuses.js'

/**
 * FAMILY.md frontmatter — the reasoning file. Intentionally minimal: all
 * structured state lives in FAMILY.json.
 */
export const FamilyDocFrontmatter = z
  .object({
    artifactType: z.literal('strategy-family'),
    family: Slug,
  })
  .strict()
export type FamilyDocFrontmatter = z.infer<typeof FamilyDocFrontmatter>

/**
 * Required H2 sections, in canonical order.
 *
 * The first five are written ONCE by ProposeFamily and then left alone.
 * "Research log" is the only living section: append-only, written only by
 * the Researcher — one dated `### <experiment-id>` entry per evaluated
 * experiment, each ending with a `Lesson:` line.
 */
export const REQUIRED_FAMILY_DOC_SECTIONS = [
  'Thesis',
  'Signal definition',
  'Edge economics',
  'Experiment roadmap',
  'Duplicate notes',
  'Research log',
] as const

/** Pull `## Heading` titles (level-2 only) from markdown body text. */
export function extractH2(markdown: string): string[] {
  return [...markdown.matchAll(/^##[ \t]+(.+?)[ \t]*$/gm)].map((m) => m[1] ?? '')
}

/** One `### <experiment-id>` entry inside the Research log section. */
export const ResearchLogEntry = z.object({
  experimentId: ExperimentId,
  /** entry contains a line starting with `Lesson:` (optionally bolded) */
  hasLesson: z.boolean(),
})
export type ResearchLogEntry = z.infer<typeof ResearchLogEntry>

/**
 * Extract the Research log entries from the markdown body: every H3 heading
 * inside the `## Research log` section, with a flag for the mandatory
 * `Lesson:` line. H3 headings may carry a date suffix after the id, e.g.
 * `### 001-persistence-filter — 2026-07-03`.
 */
export function extractResearchLog(markdown: string): ResearchLogEntry[] {
  const sectionMatch = markdown.match(/^##[ \t]+Research log[ \t]*$/m)
  if (!sectionMatch || sectionMatch.index === undefined) return []
  const rest = markdown.slice(sectionMatch.index + sectionMatch[0].length)
  const nextH2 = rest.match(/^##[ \t]+(?!#)/m)
  const section = nextH2?.index !== undefined ? rest.slice(0, nextH2.index) : rest

  const entries: ResearchLogEntry[] = []
  const h3 = [...section.matchAll(/^###[ \t]+([0-9]{3}-[a-z0-9-]+)\b.*$/gm)]
  for (let i = 0; i < h3.length; i++) {
    const match = h3[i]
    const experimentId = match?.[1]
    if (!match || !experimentId) continue
    const start = (match.index ?? 0) + match[0].length
    const end = h3[i + 1]?.index ?? section.length
    const block = section.slice(start, end)
    entries.push({
      experimentId,
      hasLesson: /^[ \t]{0,3}(\*\*)?Lesson:/m.test(block),
    })
  }
  return entries
}

/**
 * Full-document shape: validated frontmatter, the H2 headings found in the
 * body, and the parsed Research log entries. Fails if any required section
 * is missing or a log entry lacks its `Lesson:` line.
 *
 * Cross-file rules (every log entry maps to a known experiment id, every
 * evaluated experiment has an entry) live in research-check, which has both
 * files in hand.
 */
export const FamilyDoc = z
  .object({
    frontmatter: FamilyDocFrontmatter,
    headings: z.array(z.string()),
    logEntries: z.array(ResearchLogEntry),
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
    const seen = new Set<string>()
    for (const entry of doc.logEntries) {
      if (seen.has(entry.experimentId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['logEntries'],
          message: `Duplicate Research log entry: ${entry.experimentId}`,
        })
      }
      seen.add(entry.experimentId)
      if (!entry.hasLesson) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['logEntries'],
          message: `Research log entry ${entry.experimentId} is missing its "Lesson:" line`,
        })
      }
    }
  })
export type FamilyDoc = z.infer<typeof FamilyDoc>

/** Validate raw FAMILY.md text: frontmatter + H2 sections + Research log. */
export function parseFamilyDoc(raw: string): FamilyDoc {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) throw new Error('FAMILY.md is missing YAML frontmatter')
  const frontmatter = parseYaml(m[1] ?? '')
  const body = raw.slice(m[0].length)
  return FamilyDoc.parse({
    frontmatter,
    headings: extractH2(body),
    logEntries: extractResearchLog(body),
  })
}
