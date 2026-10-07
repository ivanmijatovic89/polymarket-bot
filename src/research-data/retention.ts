import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import path from 'node:path'
import { readJson } from './files.js'
import type { DatasetIndex } from './storage.js'

async function entries(directory: string) {
  return readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
}

/** Register BEFORE reading index.json. Retention keeps all generations while a reader is live. */
export async function claimReader(root: string): Promise<() => void> {
  const directory = path.join(root, 'readers')
  await mkdir(directory, { recursive: true })
  const file = path.join(directory, `${randomUUID()}.json`)
  await writeFile(file, JSON.stringify({ pid: process.pid, host: hostname() }), { flag: 'wx' })
  return () => rmSync(file, { force: true })
}

async function hasReaders(root: string): Promise<boolean> {
  for (const entry of await entries(path.join(root, 'readers'))) {
    if (!entry.isFile()) continue
    const file = path.join(root, 'readers', entry.name)
    let reader: { pid: number; host: string } | null
    try {
      reader = await readJson(file)
    } catch {
      return true // A reader can be between exclusive creation and writing its identity.
    }
    if (!reader) continue
    if (reader.host !== hostname() || !Number.isSafeInteger(reader.pid) || reader.pid <= 0)
      return true
    try {
      process.kill(reader.pid, 0)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return true
      await rm(file, { force: true })
    }
  }
  return false
}

/** Caller holds the writer lock. Historical generations and explicitly pinned snapshots stay. */
export async function pruneSnapshots(root: string, index: DatasetIndex) {
  if (await hasReaders(root)) return { deferred_for_readers: true, removed: [] as string[] }
  const pins = new Set((await readJson<string[]>(path.join(root, 'retention-pins.json'))) ?? [])
  const removed: string[] = []
  for (const snapshot of Object.values(index.days)) {
    const candidates: { directory: string; finished: string }[] = []
    for (const entry of await entries(path.join(root, 'snapshots', snapshot.date))) {
      if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue
      const directory = path.join('snapshots', snapshot.date, entry.name)
      if (directory === snapshot.directory || pins.has(directory)) continue
      const report = await readJson<{ retention_managed?: boolean; finished_at?: string }>(
        path.join(root, directory, 'report.json'),
      )
      // Existing research/audit evidence predates managed retention and is never removed here.
      if (report?.retention_managed && report.finished_at)
        candidates.push({ directory, finished: report.finished_at })
    }
    candidates.sort((a, b) => b.finished.localeCompare(a.finished))
    for (const candidate of candidates.slice(1)) {
      await rm(path.join(root, candidate.directory), { recursive: true })
      const generation = path.basename(candidate.directory)
      await rm(path.join(root, 'work', snapshot.date, generation), { recursive: true, force: true })
      removed.push(candidate.directory)
    }
  }
  return { deferred_for_readers: false, removed }
}

/** Discard only abandoned update-owned staging, never manual/audit page caches. */
export async function pruneManagedWork(root: string, index: DatasetIndex) {
  const removed: string[] = []
  for (const snapshot of Object.values(index.days)) {
    const work = path.join(root, 'work', snapshot.date)
    const state = await readJson<{ generation: string }>(path.join(work, 'state.json'))
    for (const entry of await entries(work)) {
      if (
        !entry.isDirectory() ||
        !/^[a-f0-9-]{36}$/.test(entry.name) ||
        entry.name === state?.generation
      )
        continue
      const directory = path.join(work, entry.name)
      if (
        !(await readJson<{ managed: boolean }>(path.join(directory, 'managed-update.json')))
          ?.managed
      )
        continue
      await rm(directory, { recursive: true })
      const snapshotDirectory = path.join('snapshots', snapshot.date, entry.name)
      if (
        snapshotDirectory !== snapshot.directory &&
        !(await readJson(path.join(root, snapshotDirectory, 'report.json')))
      )
        await rm(path.join(root, snapshotDirectory), { recursive: true, force: true })
      removed.push(path.relative(root, directory))
    }
  }
  return removed
}
