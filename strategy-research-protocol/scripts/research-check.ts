/**
 * research:check — validate every research family folder against the
 * protocol: both schemas plus the cross-file invariants that need FAMILY.md,
 * FAMILY.json, the strategy files, and STAGE-GATES.md together.
 *
 *   npm run research:check
 *
 * Exit codes: 0 = all families valid, 1 = violations found.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { parse as parseYaml } from 'yaml'
import { FamilyIndex, parseFamilyDoc, type Experiment } from '../schemas/index.js'

const RESEARCH_DIR = join(process.cwd(), 'src', 'strategies', 'research')
const GATES_PATH = join(process.cwd(), 'strategy-research-protocol', 'STAGE-GATES.md')

const GatesConfig = z.object({
  gatesVersion: z.number().int().positive(),
  minExperiments: z.number().int().positive(),
  stages: z.array(
    z.object({
      stage: z.number().int().positive(),
      name: z.string().min(1),
      markets: z.number().int().positive(),
    }),
  ),
})
type GatesConfig = z.infer<typeof GatesConfig>

function loadGatesConfig(): GatesConfig {
  const raw = readFileSync(GATES_PATH, 'utf8')
  const fence = raw.match(/```yaml\n([\s\S]*?)```/)
  if (!fence) throw new Error(`[research-check] no yaml config block in ${GATES_PATH}`)
  return GatesConfig.parse(parseYaml(fence[1] ?? ''))
}

function familyFolders(): string[] {
  if (!existsSync(RESEARCH_DIR)) return []
  return readdirSync(RESEARCH_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(RESEARCH_DIR, e.name, 'FAMILY.json')))
    .map((e) => e.name)
    .sort()
}

function isActive(exp: Experiment): boolean {
  return exp.status === 'queued' || exp.status === 'running'
}

function checkFamily(folder: string, gates: GatesConfig): string[] {
  const errs: string[] = []
  const dir = join(RESEARCH_DIR, folder)

  let fam: FamilyIndex | null = null
  try {
    const parsed = FamilyIndex.safeParse(JSON.parse(readFileSync(join(dir, 'FAMILY.json'), 'utf8')))
    if (parsed.success) fam = parsed.data
    else
      errs.push(...parsed.error.issues.map((i) => `FAMILY.json ${i.path.join('.')}: ${i.message}`))
  } catch (e) {
    errs.push(`FAMILY.json unreadable: ${(e as Error).message}`)
  }

  let doc: ReturnType<typeof parseFamilyDoc> | null = null
  const mdPath = join(dir, 'FAMILY.md')
  if (!existsSync(mdPath)) {
    errs.push('FAMILY.md is missing')
  } else {
    try {
      doc = parseFamilyDoc(readFileSync(mdPath, 'utf8'))
    } catch (e) {
      errs.push(`FAMILY.md invalid: ${(e as Error).message}`)
    }
  }

  if (!fam || !doc) return errs

  if (fam.family !== folder) errs.push(`FAMILY.json family "${fam.family}" != folder "${folder}"`)
  if (doc.frontmatter.family !== folder)
    errs.push(`FAMILY.md frontmatter family "${doc.frontmatter.family}" != folder "${folder}"`)

  const ids = new Set(fam.experiments.map((e) => e.id))

  for (const exp of fam.experiments) {
    if (!existsSync(join(dir, exp.code))) errs.push(`${exp.id}: code file missing: ${exp.code}`)

    const prefix = `${fam.family}--${exp.id}`
    if (exp.batchUid !== null && !exp.batchUid.startsWith(prefix))
      errs.push(`${exp.id}: batchUid "${exp.batchUid}" must start with "${prefix}"`)
    for (const pass of exp.search?.passes ?? []) {
      if (!pass.batchUid.startsWith(prefix))
        errs.push(`${exp.id}: pass batchUid "${pass.batchUid}" must start with "${prefix}"`)
    }
    if (exp.search?.refine && !exp.search.refine.batchUid.startsWith(prefix))
      errs.push(
        `${exp.id}: refine batchUid "${exp.search.refine.batchUid}" must start with "${prefix}"`,
      )

    if (exp.outcome) {
      if (exp.outcome.gatesVersion > gates.gatesVersion)
        errs.push(
          `${exp.id}: gatesVersion ${exp.outcome.gatesVersion} > current ${gates.gatesVersion}`,
        )
      const maxStage = Math.max(...gates.stages.map((s) => s.stage))
      if (exp.outcome.stageReached > maxStage)
        errs.push(`${exp.id}: stageReached ${exp.outcome.stageReached} > highest stage ${maxStage}`)
      const stageDef = gates.stages.find((s) => s.stage === exp.outcome!.stageReached)
      if (stageDef && (exp.coverage?.markets ?? 0) < stageDef.markets)
        errs.push(
          `${exp.id}: stageReached ${exp.outcome.stageReached} requires coverage >= ` +
            `${stageDef.markets} markets, has ${exp.coverage?.markets ?? 0}`,
        )
    }
  }

  for (const entry of doc.logEntries) {
    if (!ids.has(entry.experimentId))
      errs.push(`Research log entry "${entry.experimentId}" has no matching experiment`)
  }

  // Log-before-acting: every evaluated experiment needs its Research-log
  // entry. Exception window: the single most recently evaluated experiment
  // may lack one — but only while nothing new is queued/running and the
  // family is not killed (the Researcher must log before acting again).
  const logged = new Set(doc.logEntries.map((e) => e.experimentId))
  const missing = fam.experiments.filter((e) => e.status === 'evaluated' && !logged.has(e.id))
  if (missing.length > 0) {
    const newest = [...fam.experiments]
      .filter((e) => e.status === 'evaluated')
      .sort((a, b) => (a.decidedAt ?? '').localeCompare(b.decidedAt ?? ''))
      .at(-1)
    const withinWindow =
      missing.length === 1 &&
      missing[0]?.id === newest?.id &&
      !fam.experiments.some(isActive) &&
      fam.status !== 'killed'
    if (!withinWindow) {
      errs.push(
        `evaluated experiments without a Research log entry: ` +
          missing.map((e) => e.id).join(', '),
      )
    }
  }

  if (fam.status === 'killed' && fam.experiments.some(isActive))
    errs.push('killed family must not have queued/running experiments')

  return errs
}

/**
 * The reference examples must stay schema-valid too — they teach the
 * format, so a schema change that forgets them would ship a wrong example.
 * Standalone validation only (no folder-name or cross-family invariants).
 */
function checkExamples(): string[] {
  const errs: string[] = []
  const dir = join(process.cwd(), 'strategy-research-protocol', 'examples')
  if (!existsSync(dir)) return errs

  const jsonPath = join(dir, 'FAMILY.json')
  if (existsSync(jsonPath)) {
    try {
      const parsed = FamilyIndex.safeParse(JSON.parse(readFileSync(jsonPath, 'utf8')))
      if (!parsed.success)
        errs.push(
          ...parsed.error.issues.map(
            (i) => `examples/FAMILY.json ${i.path.join('.')}: ${i.message}`,
          ),
        )
    } catch (e) {
      errs.push(`examples/FAMILY.json unreadable: ${(e as Error).message}`)
    }
  }

  const mdPath = join(dir, 'FAMILY.md')
  if (existsSync(mdPath)) {
    try {
      parseFamilyDoc(readFileSync(mdPath, 'utf8'))
    } catch (e) {
      errs.push(`examples/FAMILY.md invalid: ${(e as Error).message}`)
    }
  }

  return errs
}

const gates = loadGatesConfig()
const folders = familyFolders()
let failed = 0

for (const folder of folders) {
  const errs = checkFamily(folder, gates)
  if (errs.length === 0) {
    console.log(`ok    ${folder}`)
  } else {
    failed++
    console.error(`FAIL  ${folder}`)
    for (const e of errs) console.error(`      - ${e}`)
  }
}

{
  const errs = checkExamples()
  if (errs.length === 0) {
    console.log('ok    examples')
  } else {
    failed++
    console.error('FAIL  examples')
    for (const e of errs) console.error(`      - ${e}`)
  }
}

console.log(
  `[research-check] ${folders.length} families checked, ${failed} failed ` +
    `(gates v${gates.gatesVersion})`,
)
if (folders.length === 0) console.log('[research-check] no family folders found — nothing to do')
process.exit(failed > 0 ? 1 : 0)
