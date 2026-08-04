import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Typed runtime loader for the canonical machine catalog,
 * `dashboard/src/data/machines.json` — keys are machine ids from
 * `src/machines/identity.ts` (`getMachineId()`), values are per-machine
 * metadata. The JSON file is the single source of truth; this module is the
 * runtime (Node/tsx) view of it, shared by scripts, workers, and — per issue
 * #213 — Global Runtime machine resolution. The dashboard keeps its own
 * bundler import in `dashboard/src/lib/machineNames.ts` (client components
 * cannot use fs), typed against the same shape.
 */

export type MachineCatalogEntry = {
  name: string
  hardware: string[]
  cores?: number | null
  /** Default `--market-concurrency` for backtest workers on this box (see scripts/run-worker.sh). */
  cores_for_backtest?: number | null
  geekbench6Multi?: number | null
  geekbench6Source?: 'verified' | 'estimated' | 'unknown'
  priceUsd?: number
  parallelThroughput?: number
}

const CATALOG_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'dashboard',
  'src',
  'data',
  'machines.json',
)

let cachedCatalog: Record<string, MachineCatalogEntry> | null = null

/** The full catalog, read once per process. Throws if the JSON is missing/invalid. */
export function loadMachineCatalog(): Record<string, MachineCatalogEntry> {
  if (cachedCatalog) return cachedCatalog
  cachedCatalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as Record<
    string,
    MachineCatalogEntry
  >
  return cachedCatalog
}

/** Catalog entry for a machine id, or `undefined` when the machine is unregistered. */
export function getMachineCatalogEntry(machineId: string): MachineCatalogEntry | undefined {
  return loadMachineCatalog()[machineId]
}

/** Friendly name for a machine id, or the raw id when unknown. */
export function machineLabel(machineId: string): string {
  return getMachineCatalogEntry(machineId)?.name ?? machineId
}
