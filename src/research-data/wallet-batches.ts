import path from 'node:path'
import { ApiClient } from './api.js'
import { chunks } from './catalog.js'
import { readJson, writeJson } from './files.js'
import { activityRow, positionRow, type Activity, type Position } from './types.js'

export interface WalletJob {
  wallet: string
  conditions: string[]
}
export interface WalletRows {
  activities: Activity[]
  positions: Position[]
}

export async function fetchWallet(
  client: ApiClient,
  job: WalletJob,
  asOf: number,
  cache: string,
): Promise<WalletRows> {
  const params = { user: job.wallet, condition: job.conditions.join(','), limit: 1000 }
  const activities = (
    await client.walk(
      '/v2/activity',
      { ...params, start: 1, end: asOf, sort_direction: 'ASC' },
      cache,
    )
  ).map(activityRow)
  const positions = (
    await client.walk('/v2/positions', { ...params, status: 'CLOSED' }, cache)
  ).map(positionRow)
  if (
    [...activities, ...positions].some(
      (row) =>
        row.proxy_wallet.toLowerCase() !== job.wallet || !job.conditions.includes(row.condition_id),
    )
  )
    throw new Error('Wallet endpoint ignored its wallet/condition filters')
  return { activities, positions }
}

/** A bounded, disk-backed shared wallet queue. Missing/new participants use the ordinary fetch. */
export class WalletBatches {
  private readonly byPair = new Map<string, number>()
  private readonly running = new Map<number, Promise<WalletRows>>()
  private readonly recent = new Map<number, WalletRows>()
  readonly stats = { combined_batches: 0, covered_daily_batches: 0, fallback_daily_batches: 0 }

  private constructor(
    private readonly client: ApiClient,
    private readonly jobs: WalletJob[],
    readonly asOf: number,
    private readonly directory: string,
  ) {
    jobs.forEach((job, i) =>
      job.conditions.forEach((condition) => this.byPair.set(`${job.wallet}:${condition}`, i)),
    )
    this.stats.combined_batches = jobs.length
  }

  static async create(client: ApiClient, seeds: WalletJob[], asOf: number, directory: string) {
    const file = path.join(directory, 'plan.json')
    let plan = await readJson<{ asOf: number; jobs: WalletJob[] }>(file)
    if (plan && plan.asOf !== asOf) throw new Error('Combined wallet cache cutoff mismatch')
    if (!plan) {
      const wallets = new Map<string, Set<string>>()
      for (const seed of seeds) {
        const conditions = wallets.get(seed.wallet) ?? new Set<string>()
        for (const condition of seed.conditions) conditions.add(condition)
        wallets.set(seed.wallet, conditions)
      }
      const jobs = [...wallets]
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([wallet, conditions]) =>
          chunks([...conditions].sort(), 20).map((group) => ({ wallet, conditions: group })),
        )
      plan = { asOf, jobs }
      await writeJson(file, plan)
    }
    return new WalletBatches(client, plan.jobs, asOf, directory)
  }

  private async load(i: number): Promise<WalletRows> {
    const cached = this.recent.get(i)
    if (cached) {
      this.recent.delete(i)
      this.recent.set(i, cached)
      return cached
    }
    let task = this.running.get(i)
    if (!task) {
      task = fetchWallet(this.client, this.jobs[i]!, this.asOf, path.join(this.directory, 'pages'))
      this.running.set(i, task)
    }
    try {
      const rows = await task
      this.recent.set(i, rows)
      while (this.recent.size > 16) this.recent.delete(this.recent.keys().next().value!)
      return rows
    } finally {
      this.running.delete(i)
    }
  }

  async fetch(job: WalletJob, asOf: number, dailyCache: string): Promise<WalletRows> {
    const ids = job.conditions.map((condition) => this.byPair.get(`${job.wallet}:${condition}`))
    if (asOf !== this.asOf || ids.some((id) => id === undefined)) {
      this.stats.fallback_daily_batches++
      return fetchWallet(this.client, job, asOf, dailyCache)
    }
    this.stats.covered_daily_batches++
    const rows: WalletRows = { activities: [], positions: [] }
    // Sequential here: the outer daily wallet queue already bounds active requests.
    for (const id of new Set(ids)) {
      const batch = await this.load(id!)
      rows.activities.push(
        ...batch.activities.filter((row) => job.conditions.includes(row.condition_id)),
      )
      rows.positions.push(
        ...batch.positions.filter((row) => job.conditions.includes(row.condition_id)),
      )
    }
    rows.activities.sort((a, b) => a.timestamp - b.timestamp)
    return rows
  }
}
