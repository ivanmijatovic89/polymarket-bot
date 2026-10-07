import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { inspectBundle, inventoryArtifacts, sanitizeLocation } from './inventory-artifacts.mjs'

const digest = (text: string) => createHash('sha256').update(text).digest('hex')
async function temp(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'artifact-inventory-test-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
const code =
  'globalThis.__inventoryMustNotRun = true; var Config = z.object({x:z.coerce.number()}); var definition={id:"test.v1", schema:Config}; var __pmbArtifact={formatVersion:2,entrypoint:"strategies/test.ts"}; export {definition,__pmbArtifact};'

test('static parsing preserves literals without executing code or following imports', () => {
  const result = inspectBundle(
    'import "node:fs"; import("./missing.mjs"); new ExternalFeedsRequestPlugin({});' + code,
  )
  assert.equal((globalThis as Record<string, unknown>).__inventoryMustNotRun, undefined)
  assert.equal(result.literalStrategyId, 'test.v1')
  assert.deepEqual(result.banner, { formatVersion: 2, entrypoint: 'strategies/test.ts' })
  assert.deepEqual(result.imports, ['./missing.mjs', 'node:fs'])
  assert.equal(result.executionValidated, false)
  assert.equal(result.validationContractCaptured, false)
  assert.ok(result.schemaExpressionSha256)
})

test('nested shadow definitions cannot replace top-level artifact identity', () => {
  assert.equal(
    inspectBundle(code + ' function hidden(){var definition={id:"wrong"};}').literalStrategyId,
    'test.v1',
  )
  assert.equal(
    inspectBundle('var definition=factory(); export {definition};').literalStrategyId,
    null,
  )
})

test('locations remove URL credentials, query tokens and fragments', () => {
  assert.equal(
    sanitizeLocation('https://name:secret@example.test/repo.git?token=x#secret'),
    'https://example.test/repo.git',
  )
  assert.equal(sanitizeLocation('git@github.com:owner/repo.git'), 'git@github.com:owner/repo.git')
})

test('content-addressed cache discovery keeps unknown sets pending and is reproducible', async () =>
  temp(async (root) => {
    await writeFile(path.join(root, digest(code) + '.mjs'), code)
    const a = await inventoryArtifacts({ cacheRoots: [root], sourceRoots: [] })
    const b = await inventoryArtifacts({ cacheRoots: [root], sourceRoots: [] })
    assert.deepEqual(a, b)
    assert.equal(a.summary.observedImmutableShas, 1)
    assert.equal(a.summary.cacheOnlyShas, 1)
    assert.equal(a.referenceSets.runRows.count, null)
    assert.equal(a.referenceSets.queueJobs.status, 'pending')
    assert.equal(a.summary.nativePortsVerified, 0)
  }))

test('bad hash and symlink artifacts are never treated as verified bytes', async () =>
  temp(async (root) => {
    await writeFile(path.join(root, '0'.repeat(64) + '.mjs'), code)
    await symlink(
      path.join(root, '0'.repeat(64) + '.mjs'),
      path.join(root, '1'.repeat(64) + '.mjs'),
    )
    const result = await inventoryArtifacts({ cacheRoots: [root], sourceRoots: [] })
    assert.equal(result.summary.integrityFailures, 1)
    assert.equal(result.artifacts[0]!.caches[0]!.observation, null)
    assert.equal(result.artifacts[1]!.caches[0]!.status, 'skipped-nonregular-file')
  }))

test('oversized bundle is hashed but its AST is not loaded', async () =>
  temp(async (root) => {
    const huge = '//' + 'x'.repeat(2 * 1024 * 1024)
    await writeFile(path.join(root, digest(huge) + '.mjs'), huge)
    const result = await inventoryArtifacts({ cacheRoots: [root], sourceRoots: [] })
    assert.equal(result.artifacts[0]!.caches[0]!.status, 'hash-only-parse-size-limit')
  }))

test('all metadata versions survive, capped query stays incomplete, and URLs are sanitized', async () =>
  temp(async (root) => {
    const cache = path.join(root, 'cache')
    await mkdir(cache)
    const row = (sha256: string) => ({
      sha256,
      strategyId: 'same.v1',
      entrypoint: 'strategies/a.ts',
      sourceRepo: 'https://u:p@example.test/repo?key=secret',
      sourceCommit: 'a'.repeat(40),
      sourceDirty: true,
      engineCommit: 'b'.repeat(40),
      formatVersion: 2,
      sizeBytes: 1,
      r2Url: 'r2://bucket/object?token=secret',
      unexpectedSecret: 'must-not-persist',
    })
    const metadata = path.join(root, 'metadata.json')
    await writeFile(
      metadata,
      JSON.stringify({
        query: 'listStrategyArtifacts(2)',
        limit: 2,
        exhausted: true,
        rows: [row('0'.repeat(64)), row('1'.repeat(64))],
      }),
    )
    const result = await inventoryArtifacts({
      cacheRoots: [cache],
      sourceRoots: [],
      metadataSnapshot: metadata,
    })
    assert.equal(result.catalog.status, 'truncated-or-incomplete')
    assert.equal(result.summary.catalogRows, 2)
    assert.equal(result.summary.catalogShasMissingLocalBytes, 2)
    assert.equal(result.artifacts[0]!.metadata[0]!.sourceRepo, 'https://example.test/repo')
    assert.equal(JSON.stringify(result).includes('must-not-persist'), false)
    assert.equal(JSON.stringify(result.artifacts).includes('secret'), false)
    await writeFile(
      metadata,
      JSON.stringify({
        query: 'listStrategyArtifacts(2)',
        limit: 2,
        exhausted: false,
        rows: [row('0'.repeat(64)), row('0'.repeat(64))],
      }),
    )
    await assert.rejects(
      inventoryArtifacts({ cacheRoots: [cache], sourceRoots: [], metadataSnapshot: metadata }),
      /duplicate/,
    )
  }))
