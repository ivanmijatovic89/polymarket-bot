/**
 * `strategy:sync-lock -- --repo <package>` (31 §3 item 3): regenerate a
 * strategy package's Cargo.lock from the engine lock — copy
 * native/Cargo.lock, then let cargo prune it offline — so the package lock
 * stays a subset of the engine lock after an engine dependency change.
 *
 *   npm run strategy:sync-lock -- --repo native/strategies
 */

import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { isRustStrategyPackage } from './cli.js'
import { bootstrapToolEnv, ENGINE_ROOT, run } from './host.js'
import { ENGINE_LOCK_REL } from './policy.js'
import { lockSubsetViolations, parseCargoLock } from './toml.js'

export class SyncLockError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncLockError'
  }
}

function writeAtomic(target: string, text: string): void {
  const tmp = `${target}.${process.pid}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, target)
}

export function syncLock(
  packageDir: string,
  engineRoot: string = ENGINE_ROOT,
): { packages: number; changed: boolean } {
  const packageRoot = realpathSync(path.resolve(packageDir))
  if (!isRustStrategyPackage(packageRoot)) {
    throw new SyncLockError(
      `${packageRoot} is not a Rust strategy package (Cargo.toml with [package.metadata.pmb])`,
    )
  }
  const lockPath = path.join(packageRoot, 'Cargo.lock')
  const before = existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : null
  const engineLockText = readFileSync(path.join(engineRoot, ENGINE_LOCK_REL), 'utf8')
  const engineLock = parseCargoLock(engineLockText)
  const restore = (): void => {
    if (before === null)
      writeAtomic(lockPath, engineLockText) // keep a lock for diagnosis
    else writeAtomic(lockPath, before)
  }
  writeAtomic(lockPath, engineLockText)
  // `cargo metadata` without --locked rewrites the lock against the package's
  // graph, keeping the locked versions and dropping unused entries; --offline
  // keeps it from resolving anything new from the network (31 §3 item 2).
  const r = run('cargo', ['metadata', '--format-version', '1', '--offline'], {
    cwd: packageRoot,
    env: bootstrapToolEnv(),
  })
  if (r.status !== 0) {
    restore()
    throw new SyncLockError(
      `cargo metadata --offline failed in ${packageRoot}:\n${r.stderr.trim()}`,
    )
  }
  const after = readFileSync(lockPath, 'utf8')
  const violations = lockSubsetViolations(parseCargoLock(after), engineLock)
  if (violations.length > 0) {
    restore()
    throw new SyncLockError(
      `the pruned lock is not a subset of native/Cargo.lock:\n  ${violations.join('\n  ')}`,
    )
  }
  return { packages: parseCargoLock(after).length, changed: after !== before }
}
