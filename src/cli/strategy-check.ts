/**
 * Typecheck + lint an EXTERNAL strategy repo with this checkout's toolchain:
 *
 *   npm run strategy:check -- --repo /path/to/external-repo
 *
 * The external repo needs no tsc/eslint of its own — same strict tsconfig and
 * ESLint rules as this repository (see scripts/protocol-check.mts for the
 * in-repo protocol equivalent). `strategy:publish` runs the typecheck part
 * automatically as a pre-flight.
 *
 * For a Rust strategy package (31 §7.1) the same command runs the native
 * gates: package rules and lock subset, cargo fmt, clippy with the engine's
 * config, and builder builds of every bin (src/strategy/artifacts/native/).
 * `--ci` runs the engine-CI subset of 31 §7.6 (gates 1-4 and 6 on a host
 * build, any host); `--qos default` runs an unthrottled interactive build.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { lintExternalRepo, typecheckExternalRepo } from '../strategy/artifacts/externalRepoCheck.js'
import { isNativeCheckInvocation, runNativeCheckCli } from '../strategy/artifacts/native/cli.js'

// Rust strategy packages (a Cargo.toml with [package.metadata.pmb]) run the
// gates of 31 §7.1 instead; the TS checks below are unchanged.
if (isNativeCheckInvocation(process.argv.slice(2))) {
  process.exit(runNativeCheckCli(process.argv.slice(2)))
}

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
