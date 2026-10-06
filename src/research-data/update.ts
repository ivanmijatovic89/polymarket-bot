import { randomUUID } from 'node:crypto'
import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { ApiClient } from './api.js'
import { dates, parseDate } from './catalog.js'
import { DEFAULT_FAMILY, ensureDatasetFamily, type MarketFamilyId } from './family.js'
import { readJson, writeJson } from './files.js'
import { loadIndex, type DatasetIndex } from './storage.js'
import { claimLock, syncSelectedDays, type SyncOptions } from './sync.js'
import { pruneManagedWork, pruneSnapshots } from './retention.js'
import { WalletBatches, type WalletJob } from './wallet-batches.js'

export interface UpdateConfig {
  version: 1
  root: string
  from: string
  market: MarketFamilyId
  concurrency: number
  requestsPerSecond: number
  minFreeGiB: number
}
interface UpdateState {
  version: 1
  id: string
  status: 'running' | 'failed' | 'complete'
  from: string
  to: string
  asOf: number
  scheduleDate: string
  startedAt: string
  missing: string[]
  refresh: string[]
  completed: Record<string, string>
  error?: string
  finishedAt?: string
}

export function updatePlan(index: DatasetIndex, from: string, to: string) {
  const required = dates(from, to)
  const recent = required.slice(-7)
  return {
    missing: required.filter(
      (day) => !index.days[day] || index.days[day]!.missing_markets.length > 0,
    ),
    refresh: recent.filter(
      (day) => Boolean(index.days[day]) && !index.days[day]!.missing_markets.length,
    ),
  }
}

export function scheduledDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Belgrade',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (key: string) => parts.find((part) => part.type === key)!.value
  const date = `${get('year')}-${get('month')}-${get('day')}`
  return Number(get('hour')) >= 3
    ? date
    : new Date((parseDate(date) - 86400) * 1000).toISOString().slice(0, 10)
}

export async function readUpdateConfig(file: string): Promise<UpdateConfig> {
  const config = await readJson<UpdateConfig>(file)
  if (!config || config.version !== 1 || !path.isAbsolute(config.root))
    throw new Error('Invalid update configuration: expected version 1 and absolute root')
  parseDate(config.from)
  for (const [key, min, max] of [
    ['concurrency', 1, 24],
    ['requestsPerSecond', 1, 60],
    ['minFreeGiB', 1, 1000],
  ] as const)
    if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max)
      throw new Error(`Invalid update configuration: ${key}`)
  return config
}

/** One invocation, no polling loop. Launchd supplies the daily trigger. */
export async function updateDataset(
  options: Omit<SyncOptions, 'to'> & { now?: Date; scheduled?: boolean; combineWallets?: boolean },
) {
  const now = options.now ?? new Date()
  const to = now.toISOString().slice(0, 10)
  const scheduleDate = scheduledDate(now)
  const stateFile = path.join(options.root, 'update-state.json')
  const release = await claimLock(options.root)
  const started = Date.now()
  let state: UpdateState | null = null
  const log = options.log ?? console.error
  try {
    await ensureDatasetFamily(options.root, options.market ?? DEFAULT_FAMILY)
    const previous = await readJson<UpdateState>(stateFile)
    if (
      options.scheduled &&
      previous?.status === 'complete' &&
      previous.from === options.from &&
      previous.scheduleDate >= scheduleDate
    )
      return { status: 'already_completed', schedule_date: scheduleDate }
    let index = await loadIndex(options.root)
    // An interrupted same-day update retains its cutoff and combined-page cache.
    state =
      previous &&
      previous.status !== 'complete' &&
      previous.from === options.from &&
      previous.to === to
        ? { ...previous, status: 'running' }
        : {
            version: 1,
            id: randomUUID(),
            status: 'running',
            from: options.from,
            to,
            asOf: Math.floor(now.getTime() / 1000),
            scheduleDate,
            startedAt: now.toISOString(),
            ...updatePlan(index, options.from, to),
            completed: {},
          }
    delete state.error
    await writeJson(stateFile, state)
    const client = options.client ?? new ApiClient({ requestsPerSecond: options.requestsPerSecond })
    const run = {
      ...options,
      to,
      client,
      asOf: state.asOf,
      refresh: true,
      retentionManaged: true,
      requireCompleteMarkets: true,
    }
    const completeDay = async (day: string, walletBatches?: WalletBatches) => {
      const existing = (await loadIndex(options.root)).days[day]
      if (state!.completed[day] && existing?.generation === state!.completed[day]) return
      const [snapshot] = await syncSelectedDays(
        { ...run, ...(walletBatches ? { walletBatches } : {}) },
        [day],
      )
      if (snapshot!.missing_markets.length)
        throw new Error(
          `Missing market windows remain on ${day}: ${snapshot!.missing_markets.length}`,
        )
      state!.completed[day] = snapshot!.generation
      await writeJson(stateFile, state)
    }
    for (const day of state.missing) await completeDay(day)
    index = await loadIndex(options.root)
    const directory = path.join(options.root, 'work', 'updates', state.id)
    let walletBatches: WalletBatches | undefined
    if (options.combineWallets !== false && state.refresh.length) {
      const seeds: WalletJob[] = []
      for (const day of state.refresh) {
        const jobs = await readJson<WalletJob[]>(
          path.join(options.root, index.days[day]!.directory, 'wallet-queries.json'),
        )
        if (!jobs) throw new Error(`Wallet query provenance missing for ${day}`)
        seeds.push(...jobs)
      }
      walletBatches = await WalletBatches.create(client, seeds, state.asOf, directory)
      log(
        `[research] combined wallet queue: ${seeds.length} daily batches -> ${walletBatches.stats.combined_batches} shared batches`,
      )
    }
    for (const day of state.refresh) await completeDay(day, walletBatches)
    const retention = await pruneSnapshots(options.root, await loadIndex(options.root))
    const removedStaging = await pruneManagedWork(options.root, await loadIndex(options.root))
    // Cleanup can take noticeable time for a full week of cursor pages. Keep the
    // run active, and include it in elapsed time, until those files are removed.
    // Original API row payloads remain in Parquet.
    await rm(path.join(options.root, 'work', 'updates'), { recursive: true, force: true })
    state.status = 'complete'
    state.finishedAt = new Date().toISOString()
    const report = {
      ...state,
      market: options.market ?? DEFAULT_FAMILY,
      concurrency: options.concurrency,
      requested_rps: options.requestsPerSecond,
      node_version: process.version,
      elapsed_seconds_this_attempt: (Date.now() - started) / 1000,
      resumed: previous?.id === state.id,
      api: client.stats,
      wallet_batches: walletBatches?.stats,
      retention,
      removed_staging: removedStaging,
    }
    await writeJson(path.join(options.root, 'logs', 'updates', `${state.id}.json`), report)
    await writeJson(stateFile, report)
    const logs = path.join(options.root, 'logs', 'updates')
    const history = await Promise.all(
      (await readdir(logs))
        .filter((file) => /^[a-f0-9-]{36}\.json$/.test(file))
        .map(async (file) => ({
          file,
          report: await readJson<UpdateState>(path.join(logs, file)),
        })),
    )
    history.sort((a, b) => (b.report?.finishedAt ?? '').localeCompare(a.report?.finishedAt ?? ''))
    for (const old of history.slice(30)) await rm(path.join(logs, old.file))
    return report
  } catch (error) {
    if (state) {
      state.status = 'failed'
      state.error = String(error)
      await writeJson(stateFile, state)
    }
    throw error
  } finally {
    await release()
  }
}
