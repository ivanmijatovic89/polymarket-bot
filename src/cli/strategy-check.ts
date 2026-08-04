/**
 * Typecheck + lint an EXTERNAL strategy repo with this checkout's toolchain:
 *
 *   npm run strategy:check -- --repo /path/to/external-repo
 *
 * The external repo needs no tsc/eslint of its own — same strict tsconfig and
 * ESLint rules as this repository (see scripts/protocol-check.mts for the
 * in-repo protocol equivalent). `strategy:publish` runs the typecheck part
 * automatically as a pre-flight.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { lintExternalRepo, typecheckExternalRepo } from '../strategy/artifacts/externalRepoCheck.js'

let repo: string | null = null
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]!
  if (arg === '--repo') repo = argv[++i] ?? null
  else if (arg.startsWith('--repo=')) repo = arg.slice('--repo='.length)
  else {
    console.error(`[strategy:check] unknown argument: ${arg}`)
    process.exit(2)
  }
}
if (!repo) {
  console.error('usage: npm run strategy:check -- --repo <dir>')
  process.exit(2)
}
const repoDir = path.resolve(repo)
if (!existsSync(repoDir)) {
  console.error(`[strategy:check] repo not found: ${repoDir}`)
  process.exit(2)
}

let ok = true
console.log(`[strategy:check] typecheck (engine src/ + ${repoDir})`)
ok = typecheckExternalRepo({ repoDir }) && ok
console.log(`[strategy:check] eslint (${repoDir})`)
ok = lintExternalRepo({ repoDir }) && ok

if (!ok) {
  console.error('[strategy:check] FAILED')
  process.exit(1)
}
console.log('[strategy:check] OK')
