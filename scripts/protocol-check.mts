/**
 * Per-protocol typecheck + lint: `npm run protocol:check -- <name>`.
 *
 * Checks ONLY protocols/<name>/strategies/ (plus its imports from src/), so a
 * broken strategy some OTHER protocol pushed to main can never block this
 * protocol's mandatory pre-push self-check. The all-protocols variants
 * (code:typecheck:protocols / code:eslint:protocols) stay for repo-wide
 * health checks.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const name = process.argv[2]
if (!name || name.startsWith('-') || name.includes('/')) {
  console.error('usage: npm run protocol:check -- <protocol-name>')
  process.exit(2)
}
if (!existsSync(join(root, 'protocols', name))) {
  console.error(`[protocol-check] protocol not found: protocols/${name}/`)
  process.exit(2)
}

// Strategy code can live at the protocol level and/or per seat
// (protocols/<name>/models/<seat>/strategies — multi-model protocols).
const strategiesDir = join(root, 'protocols', name, 'strategies')
const seatStrategiesGlob = join(root, 'protocols', name, 'models', '*', 'strategies')
const hasStrategies = existsSync(strategiesDir)
const hasModels = existsSync(join(root, 'protocols', name, 'models'))
if (!hasStrategies && !hasModels) {
  console.log(
    `[protocol-check] ${name}: no strategies/ or models/ directory — nothing to check, OK`,
  )
  process.exit(0)
}

function run(cmd: string, args: string[]): boolean {
  const res = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' })
  return res.status === 0
}

// Typecheck: a throwaway tsconfig that extends the root one but narrows the
// protocol include to just this protocol (absolute paths, so its location in
// the OS tmpdir does not matter).
const tmp = mkdtempSync(join(tmpdir(), 'protocol-check-'))
let ok = true
try {
  const tsconfigPath = join(tmp, 'tsconfig.json')
  writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        extends: join(root, 'tsconfig.json'),
        // The temp config lives in the OS tmpdir, so @types lookup (which is
        // config-relative) must be pointed back at the repo's node_modules.
        compilerOptions: { typeRoots: [join(root, 'node_modules/@types')] },
        include: [
          join(root, 'src/**/*.ts'),
          join(root, 'src/**/*.tsx'),
          join(strategiesDir, '**/*.ts'),
          join(seatStrategiesGlob, '**/*.ts'),
        ],
        exclude: [join(root, 'src/llm-usage')],
      },
      null,
      2,
    ),
  )
  console.log(`[protocol-check] ${name}: typecheck (src/ + protocols/${name}/strategies/)`)
  ok =
    run(join(root, 'node_modules/.bin/tsc'), [
      '-p',
      tsconfigPath,
      '--noEmit',
      '--pretty',
      'false',
    ]) && ok
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`[protocol-check] ${name}: eslint (protocol + seat strategies)`)
ok =
  run(join(root, 'node_modules/.bin/eslint'), [
    `protocols/${name}/strategies/**/*.ts`,
    `protocols/${name}/models/*/strategies/**/*.ts`,
    '--no-error-on-unmatched-pattern',
  ]) && ok

if (!ok) {
  console.error(`[protocol-check] ${name}: FAILED`)
  process.exit(1)
}
console.log(`[protocol-check] ${name}: OK`)
