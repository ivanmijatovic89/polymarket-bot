import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Typecheck + lint an EXTERNAL strategy repo with this checkout's toolchain
 * (same throwaway-tsconfig trick as scripts/protocol-check.mts). The external
 * repo needs no tsc/eslint installs of its own — it is just code.
 */

// realpath'd for consistency with bundle.ts's engine-root handling.
const ENGINE_ROOT = (() => {
  const resolved = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  try {
    return realpathSync(resolved)
  } catch {
    return resolved
  }
})()

function run(cmd: string, cmdArgs: string[], cwd: string): boolean {
  const res = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit' })
  return res.status === 0
}

/**
 * `tsc --noEmit` over the engine's src/** plus the external repo's .ts files,
 * under the engine's strict tsconfig. Returns success.
 */
export function typecheckExternalRepo(args: { repoDir: string; engineRoot?: string }): boolean {
  const engineRoot = path.resolve(args.engineRoot ?? ENGINE_ROOT)
  const repoDir = path.resolve(args.repoDir)
  if (!existsSync(repoDir)) {
    console.error(`[strategy-check] repo not found: ${repoDir}`)
    return false
  }
  const tmp = mkdtempSync(path.join(tmpdir(), 'strategy-check-'))
  try {
    const tsconfigPath = path.join(tmp, 'tsconfig.json')
    writeFileSync(
      tsconfigPath,
      JSON.stringify(
        {
          extends: path.join(engineRoot, 'tsconfig.json'),
          // The temp config lives in the OS tmpdir, so @types lookup (which is
          // config-relative) must be pointed back at the engine's node_modules.
          // `zod` is mapped to the engine's copy so external repos need no
          // node_modules of their own (at runtime the bundle keeps zod
          // external and the host's instance is used anyway).
          compilerOptions: {
            typeRoots: [path.join(engineRoot, 'node_modules/@types')],
            paths: {
              zod: [path.join(engineRoot, 'node_modules/zod/index.d.ts')],
            },
          },
          include: [
            path.join(engineRoot, 'src/**/*.ts'),
            path.join(engineRoot, 'src/**/*.tsx'),
            // .tsx/.mts too — esbuild bundles them, so the gates must see them.
            path.join(repoDir, '**/*.ts'),
            path.join(repoDir, '**/*.tsx'),
            path.join(repoDir, '**/*.mts'),
          ],
          exclude: [
            path.join(engineRoot, 'src/llm-usage'),
            path.join(repoDir, 'node_modules'),
            path.join(repoDir, '**/node_modules'),
          ],
        },
        null,
        2,
      ),
    )
    return run(
      path.join(engineRoot, 'node_modules/.bin/tsc'),
      ['-p', tsconfigPath, '--noEmit', '--pretty', 'false'],
      engineRoot,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/**
 * The engine's ESLint rules run against the external repo's .ts files.
 * Returns success.
 *
 * Uses a throwaway flat config mirroring eslint.config.cjs but WITHOUT
 * `parserOptions.project`: the root config does typed linting pinned to this
 * repo's tsconfigs, and external files are not part of any of those projects
 * — typed linting would hard-fail on every external repo regardless of code
 * quality. Type-aware checking is strategy:check's tsc step instead.
 */
export function lintExternalRepo(args: { repoDir: string; engineRoot?: string }): boolean {
  const engineRoot = path.resolve(args.engineRoot ?? ENGINE_ROOT)
  const repoDir = path.resolve(args.repoDir)
  if (!existsSync(repoDir)) {
    console.error(`[strategy-lint] repo not found: ${repoDir}`)
    return false
  }
  const tmp = mkdtempSync(path.join(tmpdir(), 'strategy-lint-'))
  try {
    const configPath = path.join(tmp, 'eslint.config.cjs')
    writeFileSync(
      configPath,
      [
        // The temp config lives in the OS tmpdir, so bare plugin specifiers
        // must be resolved from the engine checkout (exports-aware — a direct
        // directory require would bypass package "exports" and fail).
        `const { createRequire } = require('node:module')`,
        `const engineRequire = createRequire(${JSON.stringify(path.join(engineRoot, 'package.json'))})`,
        `const tsParser = engineRequire('@typescript-eslint/parser')`,
        `const tsPlugin = engineRequire('@typescript-eslint/eslint-plugin')`,
        `const prettierConfig = engineRequire('eslint-config-prettier')`,
        `module.exports = [`,
        `  { ignores: ['**/node_modules/**'] },`,
        `  {`,
        `    files: ['**/*.ts', '**/*.tsx', '**/*.mts'],`,
        `    languageOptions: { parser: tsParser, parserOptions: { sourceType: 'module' } },`,
        `    plugins: { '@typescript-eslint': tsPlugin },`,
        `    rules: {`,
        `      ...tsPlugin.configs.recommended.rules,`,
        `      ...(prettierConfig.rules ?? {}),`,
        `      'no-console': 'off',`,
        `      '@typescript-eslint/no-explicit-any': 'warn',`,
        `    },`,
        `  },`,
        `]`,
        ``,
      ].join('\n'),
    )
    // cwd MUST be the external repo: ESLint silently skips lint targets
    // outside its working directory, which would turn this gate into a no-op.
    return run(
      path.join(engineRoot, 'node_modules/.bin/eslint'),
      ['--config', configPath, '**/*.{ts,tsx,mts}', '--no-error-on-unmatched-pattern'],
      repoDir,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
