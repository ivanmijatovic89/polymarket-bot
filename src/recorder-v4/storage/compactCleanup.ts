import { readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { exists, syncDirectory } from './files.js'

const temporary =
  /^compact-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(jsonl|duckdb)\.tmp$/

/** Only after taking the spool lock, or for an already-finalized verified package. Never WALs. */
export async function cleanupCompactIntermediates(directory: string): Promise<void> {
  const stateFile = path.join(directory, 'state.json')
  if (!(await exists(stateFile))) return
  const state = JSON.parse(await readFile(stateFile, 'utf8')) as { schemaVersion?: unknown }
  if (state.schemaVersion !== 4) return
  let changed = false
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!temporary.test(entry.name) || entry.isSymbolicLink()) continue
    const spill = entry.name.endsWith('.duckdb.tmp')
    if (spill ? !entry.isDirectory() : !entry.isFile()) continue
    await rm(path.join(directory, entry.name), { recursive: spill })
    changed = true
  }
  if (changed) await syncDirectory(directory)
}

/** Called before the startup disk gate, when no V4 conversion child can still be alive. */
export async function cleanupSpoolIntermediates(spool: string): Promise<void> {
  for (const entry of await readdir(spool, { withFileTypes: true })) {
    if (entry.isDirectory()) await cleanupCompactIntermediates(path.join(spool, entry.name))
  }
}
