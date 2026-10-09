import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildInventory, inspectStrategy, REFERENCE_REVISION } from './inventory-strategies.mjs'

test('static inspection never executes factories and preserves schema/source identity', () => {
  const source = `import { ExternalFeedsRequestPlugin } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import type { Strategy } from '../../strategy/Strategy.js'
const ConfigSchema = z.strictObject({ threshold: z.coerce.number().default(5), enabled: z.boolean() })
export const definition = { id: 'probe', schema: ConfigSchema, create: () => { throw new Error('must not run') } }
`
  const entry = inspectStrategy(source, 'src/strategies/research/probe.ts')
  assert.ok(entry)
  assert.equal(entry.literalId, 'probe')
  assert.equal(entry.category, 'research')
  assert.deepEqual(entry.schema.fieldNames, ['enabled', 'threshold'])
  assert.equal(entry.schema.validationContractCaptured, false)
  assert.equal(entry.pluginImports.length, 1)
  assert.equal(entry.imports[1]?.typeOnly, true)
  assert.match(entry.sourceSha256, /^[a-f0-9]{64}$/)
  assert.notEqual(inspectStrategy(`${source}\n`, entry.file)?.sourceSha256, entry.sourceSha256)
})

test('malformed/dynamic candidates remain visible and nondefinitions are excluded', () => {
  assert.equal(inspectStrategy('export const helper = 5', 'src/strategies/helper.ts'), null)
  const entry = inspectStrategy(
    'export const definition = makeDefinition()',
    'protocols/probe/strategies/dynamic.ts',
  )
  assert.ok(entry)
  assert.equal(entry.literalId, null)
  assert.equal(entry.category, 'protocol')
  assert.equal(entry.staticDefinitionStatus, 'requires-runtime-validation')
})

test('pinned inventory is reproducible, separates catalog evidence and retains external unknowns', () => {
  const first = buildInventory(false)
  assert.deepEqual(buildInventory(false), first)
  assert.equal(first.referenceRevision, REFERENCE_REVISION)
  assert.equal(first.counts.trackedCandidateFiles, 73)
  assert.deepEqual(first.counts.categories, {
    core: 30,
    research: 23,
    template: 4,
    experiment: 2,
    protocol: 14,
  })
  assert.equal(first.loadedCatalog.status, 'not-captured')
  assert.equal(first.externalArtifacts.references, null)
  assert.equal(first.externalArtifacts.status, 'pending')
  assert.notEqual(first.inventoryStatus, 'complete')
  assert.ok(first.consumerPaths.includes('src/cli/trading-bot.ts'))
  assert.ok(first.candidates.every((entry) => entry.runtimeCatalogStatus === 'not-captured'))
})

test('saved reviewed registry capture matches pinned static source identity', () => {
  const saved = JSON.parse(
    readFileSync(
      new URL('../../docs/rust-migration/strategy-inventory.json', import.meta.url),
      'utf8',
    ),
  )
  const inventory = buildInventory(false)
  assert.equal(saved.staticSnapshotSha256, inventory.staticSnapshotSha256)
  assert.equal(saved.referenceTree, inventory.referenceTree)
  assert.equal(saved.packageLockSha256, inventory.packageLockSha256)
  assert.equal(saved.loadedCatalog.status, 'captured')
  assert.equal(saved.loadedCatalog.nodeVersion.split('.')[0], '20')
  assert.equal(saved.loadedCatalog.processExitCode, 0)
  assert.equal(saved.loadedCatalog.entries.length, 73)
  assert.deepEqual(saved.loadedCatalog.warnings, [])
  assert.deepEqual(saved.loadedCatalog.errors, [])
  assert.deepEqual(saved.comparison.loadedWithoutStaticId, [])
  assert.deepEqual(saved.comparison.duplicateLiteralIds, [])
  assert.ok(
    saved.candidates.every(
      (entry: { runtimeCatalogStatus: string }) =>
        entry.runtimeCatalogStatus === 'id-present-in-loaded-catalog',
    ),
  )
  assert.equal(saved.externalArtifacts.status, 'pending')
})
