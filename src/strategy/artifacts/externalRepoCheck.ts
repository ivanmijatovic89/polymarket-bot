import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Typecheck + lint an EXTERNAL strategy repo with this checkout's toolchain
 * (same throwaway-tsconfig trick as scripts/protocol-check.mts). The external
 * repo needs no tsc/eslint installs of its own — it is just code.
 */

const ENGINE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

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
            path.join(repoDir, '**/*.ts'),
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

/** The engine's ESLint config run against the external repo's .ts files. Returns success. */
export function lintExternalRepo(args: { repoDir: string; engineRoot?: string }): boolean {
  const engineRoot = path.resolve(args.engineRoot ?? ENGINE_ROOT)
  const repoDir = path.resolve(args.repoDir)
  const patterns = [path.join(repoDir, '**/*.ts')]
  if (!patterns.some((p) => existsSync(path.dirname(p)))) return true
  return run(
    path.join(engineRoot, 'node_modules/.bin/eslint'),
    [...patterns, '--no-error-on-unmatched-pattern'],
    engineRoot,
  )
}
