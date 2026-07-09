/**
 * buildStrategyIndex — regenerate src/strategies/research/INDEX.json from every
 * FAMILY.json under src/strategies/research/.
 *
 * INDEX.json is a generated rollup, never hand-edited. Run after adding or
 * changing a family:  npm run research:build-index
 *
 * Lives with the protocol (next to the schemas it uses). It only reads the
 * family JSON files from src/ — it does not import any strategy code.
 */
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FamilyIndex, GlobalIndex, type GlobalIndexFamily } from '../schemas/index.js'

const RESEARCH_DIR = join(process.cwd(), 'src', 'strategies', 'research')
const INDEX_PATH = join(RESEARCH_DIR, 'INDEX.json')

function familyFolders(): string[] {
  if (!existsSync(RESEARCH_DIR)) return []
  return readdirSync(RESEARCH_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

function rollupRow(folder: string): GlobalIndexFamily | null {
  const familyPath = join(RESEARCH_DIR, folder, 'FAMILY.json')
  if (!existsSync(familyPath)) return null // not a family folder

  const parsed = FamilyIndex.safeParse(JSON.parse(readFileSync(familyPath, 'utf8')))
  if (!parsed.success) {
    throw new Error(`[build-index] invalid ${folder}/FAMILY.json:\n${parsed.error.message}`)
  }
  const fam = parsed.data

  const championExp = fam.champion ? fam.experiments.find((e) => e.id === fam.champion) : undefined

  return {
    family: fam.family,
    status: fam.status,
    coreIdea: fam.coreIdea,
    proposedBy: fam.proposedBy,
    duplicateKeys: fam.duplicateKeys,
    retryOnlyIf: fam.retryOnlyIf,
    verdictSummary: fam.verdictSummary,
    path: `${fam.family}/FAMILY.md`,
    champion: fam.champion,
    championMetrics: championExp?.outcome?.metrics ?? null,
    championStageReached: championExp?.outcome?.stageReached ?? null,
    tags: fam.tags,
  }
}

function buildStrategyIndex(): GlobalIndex {
  const families = familyFolders()
    .map(rollupRow)
    .filter((r): r is GlobalIndexFamily => r !== null)

  const seen = new Set<string>()
  for (const f of families) {
    if (seen.has(f.family)) throw new Error(`[build-index] duplicate family slug: ${f.family}`)
    seen.add(f.family)
  }

  return GlobalIndex.parse({
    schemaVersion: 2,
    artifactType: 'strategy-global-index',
    families,
  })
}

const index = buildStrategyIndex()
const json = JSON.stringify(index, null, 2) + '\n'

const checkMode = process.argv.includes('--check')
if (checkMode) {
  const current = existsSync(INDEX_PATH) ? readFileSync(INDEX_PATH, 'utf8') : ''
  if (current !== json) {
    console.error('[build-index] INDEX.json is stale — run `npm run research:build-index`.')
    process.exit(1)
  }
  console.log('[build-index] INDEX.json is up to date.')
} else {
  const tmp = `${INDEX_PATH}.tmp`
  writeFileSync(tmp, json)
  renameSync(tmp, INDEX_PATH)
  console.log(`[build-index] wrote ${index.families.length} families to INDEX.json`)
}
