/**
 * Shared target directory management (31 §4.5): one build at a time per host,
 * and the disk budget with least-recently-used eviction of profile
 * directories.
 */

import { randomBytes } from 'node:crypto'
import {
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './host.js'
import { BUILD_PROFILES, NATIVE_TARGET, type BuildProfile } from './policy.js'

/**
 * The profile directory to evict before the next build (31 §4.5): when the
 * target directory is above its budget, the least recently used profile
 * other than the one about to build. Ties break by profile name, so the
 * choice is deterministic. Null when nothing needs to go.
 */
export function chooseEviction(args: {
  usage: Array<{ profile: BuildProfile; lastUsedMs: number }>
  totalBytes: number
  budgetBytes: number
  building: BuildProfile
}): BuildProfile | null {
  if (args.totalBytes <= args.budgetBytes) return null
  const candidates = args.usage
    .filter((u) => u.profile !== args.building)
    .sort(
      (a, b) =>
        a.lastUsedMs - b.lastUsedMs || (a.profile < b.profile ? -1 : a.profile > b.profile ? 1 : 0),
    )
  return candidates[0]?.profile ?? null
}

/** Both directories cargo uses for a profile when `build.target` is set. */
export function profileDirs(targetDir: string, profile: BuildProfile): string[] {
  return [path.join(targetDir, NATIVE_TARGET, profile), path.join(targetDir, profile)]
}

function usageMarker(targetDir: string, profile: BuildProfile): string {
  return path.join(targetDir, '.pmb-profile-used', profile)
}

function diskUsageBytes(dir: string): number {
  const r = run('du', ['-sk', dir], { cwd: os.tmpdir(), env: { PATH: '/usr/bin:/bin', LANG: 'C' } })
  if (r.status !== 0) throw new Error(`du -sk ${dir} failed: ${r.stderr.trim()}`)
  const kb = Number.parseInt(r.stdout.trim().split(/\s+/)[0] ?? '', 10)
  if (!Number.isFinite(kb)) throw new Error(`cannot read du output: ${r.stdout}`)
  return kb * 1024
}

/**
 * Enforce the budget before a build and mark the profile as used. Returns
 * the evicted profile, if any.
 */
export function enforceTargetBudget(
  targetDir: string,
  building: BuildProfile,
  budgetBytes: number,
  log: (msg: string) => void,
): BuildProfile | null {
  mkdirSync(path.join(targetDir, '.pmb-profile-used'), { recursive: true })
  let evicted: BuildProfile | null = null
  const totalBytes = diskUsageBytes(targetDir)
  if (totalBytes > budgetBytes) {
    const usage = BUILD_PROFILES.filter((p) =>
      profileDirs(targetDir, p).some((d) => existsSync(d)),
    ).map((p) => {
      const marker = usageMarker(targetDir, p)
      return { profile: p, lastUsedMs: existsSync(marker) ? statSync(marker).mtimeMs : 0 }
    })
    evicted = chooseEviction({ usage, totalBytes, budgetBytes, building })
    if (evicted) {
      log(
        `[native-build] target directory ${targetDir} uses ${(totalBytes / 1024 ** 3).toFixed(1)} GiB > ${(budgetBytes / 1024 ** 3).toFixed(1)} GiB; deleting the least recently used profile ${evicted} (31 §4.5)`,
      )
      for (const d of profileDirs(targetDir, evicted)) rmSync(d, { recursive: true, force: true })
    }
  }
  const marker = usageMarker(targetDir, building)
  writeFileSync(marker, '')
  const now = new Date()
  utimesSync(marker, now, now)
  return evicted
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export type BuilderLockOptions = {
  /**
   * An empty or unparsable lock file is treated as held until it is older
   * than this. The builder itself never leaves one (the pid is published
   * atomically), so only a foreign writer or a crashed filesystem can.
   */
  graceMs?: number
  pollMs?: number
}

const DEFAULT_LOCK_GRACE_MS = 30_000
const DEFAULT_LOCK_POLL_MS = 500

/**
 * Publish `${pid}\n` at `lockPath` atomically: write a private temp file,
 * then link(2) it into place, which fails with EEXIST while a lock exists.
 * The lock therefore never exists without its pid (31 §4.5).
 */
function tryAcquire(lockPath: string): boolean {
  const tmp = `${lockPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  writeFileSync(tmp, `${process.pid}\n`, { flag: 'wx' })
  try {
    linkSync(tmp, lockPath)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw err
  } finally {
    unlinkSync(tmp)
  }
}

/** Current lock holder: pid (null when the content is not a pid) and age; null when no lock exists. */
function readLock(lockPath: string): { pid: number | null; ageMs: number; ino: number } | null {
  try {
    const st = statSync(lockPath)
    const text = readFileSync(lockPath, 'utf8').trim()
    const pid = /^[1-9][0-9]*$/.test(text) ? Number.parseInt(text, 10) : null
    return { pid, ageMs: Date.now() - st.mtimeMs, ino: st.ino }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/**
 * Remove a stale lock. Removal is serialized by a takeover directory
 * (mkdir is atomic), and the lock is re-read under it, so two waiters that
 * both saw the same dead holder cannot both remove a lock: the second one
 * sees the first one's live lock and keeps waiting.
 */
function removeStaleLock(
  lockPath: string,
  seen: { pid: number | null; ino: number },
  graceMs: number,
  log: (msg: string) => void,
): void {
  const takeover = `${lockPath}.takeover`
  try {
    mkdirSync(takeover)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    // A takeover directory older than the grace period was left by a crash.
    try {
      if (Date.now() - statSync(takeover).mtimeMs > graceMs) rmSync(takeover, { recursive: true })
    } catch {
      /* removed concurrently */
    }
    return
  }
  try {
    const now = readLock(lockPath)
    if (now === null || now.ino !== seen.ino || now.pid !== seen.pid) return
    log(`[native-build] removing a stale builder lock (pid ${seen.pid ?? 'unreadable'})`)
    unlinkSync(lockPath)
  } finally {
    rmSync(takeover, { recursive: true, force: true })
  }
}

/**
 * Run `fn` while holding the host-wide builder lock. Builds share one target
 * directory and cargo uplifts every bin to `<target>/<triple>/<profile>/<bin>`,
 * so two builders must not interleave a build and the copy of its output, and
 * budget eviction must not delete a profile directory another cargo uses
 * (31 §4.5: "the builder runs one build at a time per host"). A lock whose
 * holder is dead is taken over; an empty or unparsable lock counts as held
 * until it is older than the grace period.
 */
export function withBuilderLock<T>(
  lockPath: string,
  log: (msg: string) => void,
  fn: () => T,
  opts: BuilderLockOptions = {},
): T {
  const graceMs = opts.graceMs ?? DEFAULT_LOCK_GRACE_MS
  const pollMs = opts.pollMs ?? DEFAULT_LOCK_POLL_MS
  mkdirSync(path.dirname(lockPath), { recursive: true })
  let announced = false
  for (;;) {
    if (tryAcquire(lockPath)) break
    const held = readLock(lockPath)
    if (held === null) continue // released between our link and read
    const stale =
      held.pid === null ? held.ageMs > graceMs : held.pid !== process.pid && !processAlive(held.pid)
    if (held.pid === process.pid)
      throw new Error(`${lockPath} is already held by this process (nested builder lock)`)
    if (stale) {
      removeStaleLock(lockPath, held, graceMs, log)
      continue
    }
    if (!announced) {
      log(
        `[native-build] waiting for the builder lock held by ${held.pid === null ? 'an unreadable holder' : `pid ${held.pid}`} (${lockPath})`,
      )
      announced = true
    }
    sleepMs(pollMs)
  }
  try {
    return fn()
  } finally {
    const held = readLock(lockPath)
    if (held !== null && held.pid === process.pid) unlinkSync(lockPath)
  }
}

/**
 * Delete cargo's fingerprints of one package in one profile directory, so
 * the next cargo run recompiles (or re-lints) that package's own crates.
 *
 * The shared target directory (31 §4.5) serves every checkout of a package:
 * cargo keys a workspace member's units by name and paths relative to the
 * package root, and decides freshness by mtime. A second checkout of the
 * same package whose files are older than the first one's outputs would
 * otherwise be served the first checkout's binary (and its clippy result),
 * while the source hash is computed from the second checkout's files.
 * Dependencies are not affected: registry crates are pinned by checksum, and
 * engine crates are keyed by the engine root in the rendered rustflags.
 * Call under the builder lock.
 */
export function forgetPackageFingerprints(
  targetDir: string,
  triple: string,
  profile: string,
  packageName: string,
): number {
  const dir = path.join(targetDir, triple, profile, '.fingerprint')
  if (!existsSync(dir)) return 0
  const prefix = `${packageName}-`
  let n = 0
  for (const name of readdirSync(dir)) {
    if (name.startsWith(prefix) && /^[0-9a-f]{16}$/.test(name.slice(prefix.length))) {
      rmSync(path.join(dir, name), { recursive: true, force: true })
      n++
    }
  }
  return n
}
