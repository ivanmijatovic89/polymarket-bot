import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import test from 'node:test'
import { buildStrategyArtifact } from './bundle.js'
import { makeFixtureRepo } from './testFixture.js'

const SOURCE = { repo: 'file://fixture', commit: 'a'.repeat(40), dirty: false }

test('bundles the external repo with engine imports rewritten to #pmb externals', async () => {
  const { repoDir, entrypoint } = makeFixtureRepo()
  try {
    const built = await buildStrategyArtifact({ repoDir, entrypoint, source: SOURCE })
    const text = built.bytes.toString('utf8')
    // Engine stays external, with explicit .ts targets.
    assert.match(text, /from\s*["']#pmb\/strategy\/plugins\/PluginSet\.ts["']/)
    assert.match(text, /from\s*["']#pmb\/strategy\/plugins\/ExternalFeedsRequestPlugin\.ts["']/)
    // zod stays external.
    assert.match(text, /from\s*["']zod["']/)
    // The repo's own helper is merged in (multi-file support).
    assert.match(text, /helperName/)
    // Type-only engine import leaves no runtime trace.
    assert.doesNotMatch(text, /#pmb\/strategy\/strategyDefinition\.ts/)
    // Banner is embedded, timestamp-free.
    assert.match(text, /__pmbArtifact/)
    assert.equal(built.banner.source.commit, SOURCE.commit)
  } finally {
    rmSync(repoDir, { recursive: true, force: true })
  }
})

test('same source produces byte-identical bundles (deterministic sha)', async () => {
  const { repoDir, entrypoint } = makeFixtureRepo()
  try {
    const a = await buildStrategyArtifact({ repoDir, entrypoint, source: SOURCE })
    const b = await buildStrategyArtifact({ repoDir, entrypoint, source: SOURCE })
    assert.equal(a.sha256, b.sha256)
    assert.deepEqual(a.bytes, b.bytes)
  } finally {
    rmSync(repoDir, { recursive: true, force: true })
  }
})

test('rejects engine imports outside the allowlist (src/db)', async () => {
  const { repoDir } = makeFixtureRepo()
  try {
    await assert.rejects(
      buildStrategyArtifact({ repoDir, entrypoint: 'strategies/bad.v1.ts', source: SOURCE }),
      /engine import not allowed.*src\/db\/index/s,
    )
  } finally {
    rmSync(repoDir, { recursive: true, force: true })
  }
})

test('a symlinked engine root still keeps engine imports external', async (t) => {
  const { symlinkSync, mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const path = (await import('node:path')).default
  const { fileURLToPath } = await import('node:url')
  const realEngineRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
  )
  const linkDir = mkdtempSync(path.join(tmpdir(), 'engine-symlink-'))
  const engineLink = path.join(linkDir, 'polymarket-bot')
  symlinkSync(realEngineRoot, engineLink)
  t.after(() => rmSync(linkDir, { recursive: true, force: true }))

  const { repoDir, entrypoint } = makeFixtureRepo()
  try {
    // Regression: without realpath handling, the symlinked engineRoot never
    // compares equal to esbuild's realpath'd resolutions and engine sources
    // get silently inlined (forked class identity).
    const built = await buildStrategyArtifact({
      repoDir,
      entrypoint,
      source: SOURCE,
      engineRoot: engineLink,
    })
    const text = built.bytes.toString('utf8')
    assert.match(text, /from\s*["']#pmb\/strategy\/plugins\/PluginSet\.ts["']/)
  } finally {
    rmSync(repoDir, { recursive: true, force: true })
  }
})

test('rejects a missing entrypoint', async () => {
  const { repoDir } = makeFixtureRepo()
  try {
    await assert.rejects(
      buildStrategyArtifact({ repoDir, entrypoint: 'strategies/nope.ts', source: SOURCE }),
      /entrypoint not found/,
    )
  } finally {
    rmSync(repoDir, { recursive: true, force: true })
  }
})
