import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import test from 'node:test'
import { buildStrategyArtifact } from './bundle.js'
import { makeFixtureRepo } from './testFixture.js'

test('bundles the external repo with engine imports rewritten to #pmb externals', async () => {
  const { repoDir, entrypoint } = makeFixtureRepo()
  try {
    const built = await buildStrategyArtifact({ repoDir, entrypoint })
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
    // Banner is embedded — code-only (no git state in the bytes).
    assert.match(text, /__pmbArtifact/)
    assert.equal(built.banner.entrypoint, entrypoint)
    assert.doesNotMatch(text, /sourceCommit|"commit"|"dirty"/)
  } finally {
    rmSync(repoDir, { recursive: true, force: true })
  }
})

test('same source produces byte-identical bundles (deterministic sha)', async () => {
  const { repoDir, entrypoint } = makeFixtureRepo()
  try {
    const a = await buildStrategyArtifact({ repoDir, entrypoint })
    const b = await buildStrategyArtifact({ repoDir, entrypoint })
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
      buildStrategyArtifact({ repoDir, entrypoint: 'strategies/bad.v1.ts' }),
      /engine import not allowed.*src\/db\/index/s,
    )
  } finally {
    rmSync(repoDir, { recursive: true, force: true })
  }
})

test('hand-written #pmb specifiers go through the same allowlist (no bypass)', async () => {
  const { repoDir } = makeFixtureRepo()
  try {
    await assert.rejects(
      buildStrategyArtifact({ repoDir, entrypoint: 'strategies/bad-pmb.v1.ts' }),
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
      engineRoot: engineLink,
    })
    const text = built.bytes.toString('utf8')
    assert.match(text, /from\s*["']#pmb\/strategy\/plugins\/PluginSet\.ts["']/)
  } finally {
    rmSync(repoDir, { recursive: true, force: true })
  }
})

test('rejects bundling a file that lies outside the strategy repo', async (t) => {
  const { writeFileSync: wf } = await import('node:fs')
  const path = (await import('node:path')).default
  const { repoDir, entrypoint } = makeFixtureRepo()
  // A real file OUTSIDE the repo dir (sibling in the tmp parent) — imported
  // relatively, it bundles content that no commit of the repo contains.
  const outside = path.join(repoDir, '..', `outside-${path.basename(repoDir)}.ts`)
  wf(outside, 'export const leaked = 1\n')
  t.after(() => rmSync(outside, { force: true }))
  wf(
    path.join(repoDir, 'strategies', 'escape.v1.ts'),
    [
      `import { leaked } from '../../${path.basename(outside).replace(/\.ts$/, '.js')}'`,
      `export const definition = {`,
      `  id: 'ext-escape.v1',`,
      `  schema: { safeParse: () => ({ success: true, data: {} }) },`,
      `  create: () => ({ strategy: { name: String(leaked), onMarketTick: () => [], onAccountEvent: () => [] } }),`,
      `}`,
      ``,
    ].join('\n'),
  )
  try {
    await assert.rejects(
      buildStrategyArtifact({ repoDir, entrypoint: 'strategies/escape.v1.ts' }),
      /outside the strategy repo/,
    )
    // Sanity: the base fixture still builds (guard doesn't overfire).
    await buildStrategyArtifact({ repoDir, entrypoint })
  } finally {
    rmSync(repoDir, { recursive: true, force: true })
  }
})

test('rejects a missing entrypoint', async () => {
  const { repoDir } = makeFixtureRepo()
  try {
    await assert.rejects(
      buildStrategyArtifact({ repoDir, entrypoint: 'strategies/nope.ts' }),
      /entrypoint not found/,
    )
  } finally {
    rmSync(repoDir, { recursive: true, force: true })
  }
})
