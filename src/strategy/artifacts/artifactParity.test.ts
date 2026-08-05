import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { z } from 'zod'
import { isExternalFeedsRequestPlugin } from '../plugins/ExternalFeedsRequestPlugin.js'
import { PluginSet } from '../plugins/PluginSet.js'
import { buildStrategyArtifact } from './bundle.js'
import { artifactCacheDir, artifactCachePath, ensureArtifactLoaded } from './loader.js'
import { makeFixtureRepo } from './testFixture.js'

/**
 * Single-realm proof: an artifact's engine imports must resolve to the SAME
 * module instances the host uses. This is what guarantees live trading and
 * backtests consume the identical StrategyDefinition contract — the mission-
 * critical invariant of issue #211. If the bundler ever inlined engine code,
 * these `instanceof` checks would fail (frozen duplicate classes).
 */

process.env.STRATEGY_ARTIFACT_CACHE_DIR = `data/strategy-artifacts-parity-${process.pid}`

test('artifact plugin instances carry host class identity', async (t) => {
  t.after(() => rmSync(artifactCacheDir(), { recursive: true, force: true }))
  const { repoDir, entrypoint } = makeFixtureRepo()
  try {
    const built = await buildStrategyArtifact({ repoDir, entrypoint })
    const cachePath = artifactCachePath(built.sha256)
    mkdirSync(path.dirname(cachePath), { recursive: true })
    writeFileSync(cachePath, built.bytes)

    const def = await ensureArtifactLoaded({
      sha256: built.sha256,
      r2Url: 'r2://test-bucket/unused',
    })
    const createdRun = def.create({ size: 1 } as never)

    // pluginSet was constructed INSIDE the artifact — instanceof against the
    // host's ESM import passes only if #pmb resolution yields one realm.
    assert.ok(createdRun.pluginSet instanceof PluginSet)

    const plugins = createdRun.pluginSet!.list()
    assert.equal(plugins.length, 1)
    // Structural detection (the cross-realm-safe check the runtimes use) AND
    // real instanceof both hold.
    assert.ok(isExternalFeedsRequestPlugin(plugins[0]!))

    // The artifact's schema is a working zod schema from the host's zod
    // (external), so host-side error formatting works on it.
    const bad = def.schema.safeParse({ size: 'not-a-number' })
    assert.equal(bad.success, false)
    if (!bad.success) {
      const flattened = z.flattenError(bad.error)
      assert.ok(flattened.fieldErrors)
    }
  } finally {
    rmSync(repoDir, { recursive: true, force: true })
  }
})
