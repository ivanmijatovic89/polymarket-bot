import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileExists } from '../../utils/fs.js'
import { sha256OfBuffer } from '../../utils/hash.js'
import { buildStrategyArtifact } from './bundle.js'
import {
  ArtifactIntegrityError,
  ArtifactShapeError,
  artifactCacheDir,
  artifactCachePath,
  ensureArtifactLoaded,
} from './loader.js'
import { FIXTURE_STRATEGY_ID, makeFixtureRepo } from './testFixture.js'

// Isolated cache dir for this test process — must stay under the repo root so
// #pmb/* and zod resolve from the artifact (loader.ts documents this).
process.env.STRATEGY_ARTIFACT_CACHE_DIR = `data/strategy-artifacts-test-${process.pid}`

function writeToCache(bytes: Buffer, sha256: string): string {
  const p = artifactCachePath(sha256)
  mkdirSync(path.dirname(p), { recursive: true })
  writeFileSync(p, bytes)
  return p
}

test('loads a cached artifact end-to-end (#pmb + zod resolution from .mjs)', async (t) => {
  t.after(() => rmSync(artifactCacheDir(), { recursive: true, force: true }))
  const { repoDir, entrypoint } = makeFixtureRepo()
  try {
    const built = await buildStrategyArtifact({ repoDir, entrypoint })
    writeToCache(built.bytes, built.sha256)

    const ref = { sha256: built.sha256, r2Url: 'r2://test-bucket/unused' }
    const def = await ensureArtifactLoaded(ref)
    assert.equal(def.id, FIXTURE_STRATEGY_ID)

    // The artifact's zod schema is usable by the host (external zod instance).
    const parsed = def.schema.safeParse({ size: 2 })
    assert.equal(parsed.success, true)

    const built2 = def.create({ size: 2 } as never)
    assert.equal(built2.strategy.name, 'ext-toy:2')

    // Memoized: the same ref returns the identical promise result.
    const again = await ensureArtifactLoaded(ref)
    assert.equal(again, def)
  } finally {
    rmSync(repoDir, { recursive: true, force: true })
  }
})

test('hash mismatch deletes the corrupt cache file and throws', async (t) => {
  t.after(() => rmSync(artifactCacheDir(), { recursive: true, force: true }))
  const { repoDir, entrypoint } = makeFixtureRepo()
  try {
    // Distinct CODE ⇒ distinct sha (git state is no longer part of the
    // identity): the previous test's per-process memo must not short-circuit
    // this load.
    // Change code that the definition actually USES — comments are stripped
    // and unused exports are tree-shaken, either of which would leave the
    // bytes (and sha) identical.
    writeFileSync(
      path.join(repoDir, 'strategies/helper.ts'),
      `export const helperName = 'ext-toy-corrupt-variant'\n`,
    )
    const built = await buildStrategyArtifact({ repoDir, entrypoint })
    const corrupted = Buffer.from(built.bytes)
    corrupted[0] = corrupted[0]! ^ 0xff
    const cached = writeToCache(corrupted, built.sha256)

    await assert.rejects(
      ensureArtifactLoaded({ sha256: built.sha256, r2Url: 'r2://test-bucket/unused' }),
      (err: unknown) => err instanceof ArtifactIntegrityError,
    )
    assert.equal(await fileExists(cached), false)
  } finally {
    rmSync(repoDir, { recursive: true, force: true })
  }
})

test('a module without the artifact banner is rejected', async (t) => {
  t.after(() => rmSync(artifactCacheDir(), { recursive: true, force: true }))
  const bytes = Buffer.from(
    `export const definition = { id: 'no-banner', schema: {}, create: () => ({ strategy: {} }) }\n`,
  )
  writeToCache(bytes, sha256OfBuffer(bytes))
  await assert.rejects(
    ensureArtifactLoaded({ sha256: sha256OfBuffer(bytes), r2Url: 'r2://test-bucket/unused' }),
    (err: unknown) => err instanceof ArtifactShapeError && /banner/.test((err as Error).message),
  )
})

test('an invalid sha256 is rejected before any I/O', async () => {
  await assert.rejects(
    ensureArtifactLoaded({ sha256: 'not-a-sha', r2Url: 'r2://test-bucket/unused' }),
    (err: unknown) =>
      err instanceof ArtifactShapeError && /invalid sha256/.test((err as Error).message),
  )
})
