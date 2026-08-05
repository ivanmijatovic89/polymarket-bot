import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Test-only fixture: a toy EXTERNAL strategy repo in the OS tmpdir, importing
 * the engine through relative paths into this checkout (exactly how a real
 * sibling-repo strategy is authored — the bundler rewrites those to #pmb/*).
 */

export const ENGINE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
)

export const FIXTURE_STRATEGY_ID = 'ext-toy.v1'

/** Relative import specifier from `fromDir` into the engine checkout (posix). */
function engineImport(fromDir: string, srcRel: string): string {
  const rel = path.relative(fromDir, path.join(ENGINE_ROOT, 'src', srcRel))
  return rel.split(path.sep).join('/')
}

export function makeFixtureRepo(): { repoDir: string; entrypoint: string } {
  // realpath: macOS tmpdir is a symlink (/var → /private/var); esbuild resolves
  // from realpaths, so relative engine imports must be computed from one too.
  const repoDir = realpathSync(mkdtempSync(path.join(tmpdir(), 'ext-strategy-fixture-')))
  const strategiesDir = path.join(repoDir, 'strategies')
  mkdirSync(strategiesDir, { recursive: true })

  // Minimal external-repo scaffold: ESM module type (required so the engine's
  // strict tsconfig treats the files as ES modules during strategy:check).
  writeFileSync(
    path.join(repoDir, 'package.json'),
    `${JSON.stringify({ name: 'ext-strategy-fixture', private: true, type: 'module' }, null, 2)}\n`,
  )

  writeFileSync(path.join(strategiesDir, 'helper.ts'), `export const helperName = 'ext-toy'\n`)

  writeFileSync(
    path.join(strategiesDir, 'toy.v1.ts'),
    [
      `import { z } from 'zod'`,
      `import type { StrategyDefinition } from '${engineImport(strategiesDir, 'strategy/strategyDefinition.js')}'`,
      `import { PluginSet } from '${engineImport(strategiesDir, 'strategy/plugins/PluginSet.js')}'`,
      `import { ExternalFeedsRequestPlugin } from '${engineImport(strategiesDir, 'strategy/plugins/ExternalFeedsRequestPlugin.js')}'`,
      `import { helperName } from './helper.js'`,
      ``,
      `export const definition: StrategyDefinition<{ size: number }> = {`,
      `  id: '${FIXTURE_STRATEGY_ID}',`,
      `  schema: z.object({ size: z.number().default(1) }),`,
      `  create: (params) => {`,
      `    const pluginSet = new PluginSet()`,
      `    pluginSet.register(new ExternalFeedsRequestPlugin({ binanceWsSpotPrice: {} }))`,
      `    return {`,
      `      strategy: {`,
      `        name: helperName + ':' + params.size,`,
      `        onMarketTick: () => [],`,
      `        onAccountEvent: () => [],`,
      `      },`,
      `      pluginSet,`,
      `    }`,
      `  },`,
      `}`,
      ``,
    ].join('\n'),
  )

  // Hand-written #pmb specifier outside the allowlist — must be rejected the
  // same way as a rewritten relative import (no allowlist bypass).
  writeFileSync(
    path.join(strategiesDir, 'bad-pmb.v1.ts'),
    [
      `// @ts-expect-error #pmb only resolves inside the engine checkout`,
      `import { getDb } from '#pmb/db/index.ts'`,
      ``,
      `export const definition = {`,
      `  id: 'ext-bad-pmb.v1',`,
      `  schema: {},`,
      `  create: () => ({ strategy: { name: String(Boolean(getDb)), onMarketTick: () => [], onAccountEvent: () => [] } }),`,
      `}`,
      ``,
    ].join('\n'),
  )

  // A strategy that reaches outside the allowed engine surface — publish must reject it.
  writeFileSync(
    path.join(strategiesDir, 'bad.v1.ts'),
    [
      `import { getDb } from '${engineImport(strategiesDir, 'db/index.js')}'`,
      ``,
      `export const definition = {`,
      `  id: 'ext-bad.v1',`,
      `  schema: {},`,
      `  create: () => ({ strategy: { name: String(Boolean(getDb)), onMarketTick: () => [], onAccountEvent: () => [] } }),`,
      `}`,
      ``,
    ].join('\n'),
  )

  return { repoDir, entrypoint: 'strategies/toy.v1.ts' }
}
