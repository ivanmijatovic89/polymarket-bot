/**
 * Shared target directory management (31 §4.5): one build at a time per host,
 * and the disk budget with least-recently-used eviction of profile
 * directories.
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
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

/**
 * Run `fn` while holding the host-wide builder lock. Builds share one target
 * directory and cargo uplifts every bin to `<target>/<triple>/<profile>/<bin>`,
 * so two builders must not interleave a build and the copy of its output.
 * A lock left by a dead process is taken over.
 */
export function withBuilderLock<T>(lockPath: string, log: (msg: string) => void, fn: () => T): T {
  mkdirSync(path.dirname(lockPath), { recursive: true })
  let announced = false
  for (;;) {
    try {
      const fd = openSync(lockPath, 'wx')
      writeFileSync(fd, `${process.pid}\n`)
      closeSync(fd)
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      let holder = Number.NaN
      try {
        holder = Number.parseInt(readFileSync(lockPath, 'utf8').trim(), 10)
      } catch {
        continue // released between our open and read
      }
      if (!Number.isInteger(holder) || !processAlive(holder)) {
        log(
          `[native-build] removing a stale builder lock (pid ${Number.isNaN(holder) ? '?' : holder})`,
        )
        try {
          unlinkSync(lockPath)
        } catch {
          /* another builder took it over first */
        }
        continue
      }
      if (!announced) {
        log(`[native-build] waiting for the builder lock held by pid ${holder} (${lockPath})`)
        announced = true
      }
      sleepMs(500)
    }
  }
  try {
    return fn()
  } finally {
    try {
      if (readFileSync(lockPath, 'utf8').trim() === String(process.pid)) unlinkSync(lockPath)
    } catch {
      /* already gone */
    }
  }
}
