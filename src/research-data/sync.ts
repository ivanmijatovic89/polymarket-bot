import { DuckDBInstance } from '@duckdb/node-api'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { mkdir, open, readdir, rm, stat, statfs } from 'node:fs/promises'
import path from 'node:path'
import { tradeKey } from './accounting.js'
import { ACCOUNTING_VERSION, coverageRow, groupRows, summarizeMarket } from './derived.js'
import { snapshotDigests } from './integrity.js'
import { ApiClient, parallelMap } from './api.js'
import { chunks, dates, discoverDay, parseDate, type Catalog } from './catalog.js'
import { readJson, writeJson } from './files.js'
import { abs, decimal, sum, units } from './decimal.js'
import {
  loadIndex,
  publish,
  TABLES,
  writeParquet,
  type DaySnapshot,
  type TableName,
} from './storage.js'
import {
  activityRow,
  feedRow,
  positionRow,
  type Activity,
  type ApiRow,
  type FeedRow,
  type Position,
} from './types.js'

export interface SyncOptions {
  root: string
  from: string
  to: string
  concurrency: number
  requestsPerSecond: number
  refresh?: boolean
  keepRaw?: boolean
  minFreeGiB?: number
  log?: (message: string) => void
  client?: ApiClient
}
interface RunState {
  generation: string
  asOf: number
  startedAt: string
}
interface WalletJob {
  wallet: string
  conditions: string[]
}
interface WalletResult extends WalletJob {
  activities: Activity[]
  positions: Position[]
}

async function directoryBytes(directory: string): Promise<number> {
  let bytes = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) bytes += await directoryBytes(file)
    else if (entry.isFile()) bytes += (await stat(file)).size
  }
  return bytes
}

export async function claimLock(root: string): Promise<() => Promise<void>> {
  await mkdir(root, { recursive: true })
  const file = path.join(root, 'sync.lock')
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(file, 'wx')
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString() }),
      )
      await handle.close()
      return () => rm(file, { force: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const owner = await readJson<{ pid: number; host: string }>(file)
      if (!owner || owner.host !== hostname() || !Number.isSafeInteger(owner.pid))
        throw new Error(`Cannot establish lock ownership: ${file}`)
      try {
        process.kill(owner.pid, 0)
      } catch (probeError) {
        if ((probeError as NodeJS.ErrnoException).code === 'ESRCH') {
          await rm(file)
          continue
        }
        throw probeError
      }
      throw new Error(`Research sync already running with PID ${owner.pid}`)
    }
  }
  throw new Error('Unable to claim sync lock')
}

export async function ensureDisk(root: string, minGiB: number): Promise<number> {
  const s = await statfs(root)
  const free = s.bavail * s.bsize
  if (free < minGiB * 1024 ** 3)
    throw new Error(
      `Only ${(free / 1024 ** 3).toFixed(2)} GiB free; ${minGiB} GiB reserve required. Checkpoints are retained.`,
    )
  return free
}

function groupByCondition<T extends { condition_id: string }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    let group = groups.get(row.condition_id)
    if (!group) {
      group = []
      groups.set(row.condition_id, group)
    }
    group.push(row)
  }
  return groups
}

export async function syncDataset(options: SyncOptions): Promise<DaySnapshot[]> {
  const days = dates(options.from, options.to)
  if (parseDate(options.to) > Date.now() / 1000)
    throw new Error('Sync complete UTC days only; --to cannot be in the future')
  const release = await claimLock(options.root)
  const log = options.log ?? console.error
  try {
    const output: DaySnapshot[] = []
    for (const [index, day] of days.entries()) {
      const existing = (await loadIndex(options.root)).days[day]
      if (existing && !options.refresh) {
        log(
          `[research] ${day} already published; use --refresh to recheck late activity and API corrections`,
        )
        output.push(existing)
        continue
      }
      await ensureDisk(options.root, options.minFreeGiB ?? 5)
      log(`[research] day ${index + 1}/${days.length}: ${day}`)
      output.push(await syncDay(options, day))
    }
    return output
  } finally {
    await release()
  }
}

async function syncDay(options: SyncOptions, day: string): Promise<DaySnapshot> {
  const log = options.log ?? console.error
  const work = path.join(options.root, 'work', day)
  const stateFile = path.join(work, 'state.json')
  let state = await readJson<RunState>(stateFile)
  const current = (await loadIndex(options.root)).days[day]
  // A local accounting rebuild can replace the active generation while the
  // last sync state still points at an older, published snapshot. Never resume
  // writes into any generation that already has a finished report.
  const finishedState =
    state &&
    (await readJson(path.join(options.root, 'snapshots', day, state.generation, 'report.json')))
  const resumed = Boolean(state && !finishedState && current?.generation !== state.generation)
  if (!state || current?.generation === state.generation || finishedState) {
    state = {
      generation: randomUUID(),
      asOf: Math.floor(Date.now() / 1000),
      startedAt: new Date().toISOString(),
    }
    await writeJson(stateFile, state)
  }
  const stage = path.join(work, state.generation)
  const cache = path.join(stage, 'pages')
  const client = options.client ?? new ApiClient({ requestsPerSecond: options.requestsPerSecond })
  const started = Date.now()
  const catalogFile = path.join(stage, 'catalog.json')
  const catalog = (await readJson<Catalog>(catalogFile)) ?? (await discoverDay(client, day))
  await writeJson(catalogFile, catalog)
  const freshness = await client.get('/v2/status')
  log(
    `[research] ${day}: ${catalog.markets.length}/96 catalog markets; ${catalog.missing.length} missing`,
  )
  let completedMarkets = 0
  const marketTrades = await parallelMap(catalog.markets, options.concurrency, async (market) => {
    const rows = (
      await client.walk(
        '/v2/trades',
        {
          condition: market.condition_id,
          taker_only: false,
          filter_type: 'TOKENS',
          filter_amount: '0.000001',
          limit: 1000,
        },
        cache,
      )
    ).map(feedRow)
    if (rows.some((r) => r.condition_id !== market.condition_id))
      throw new Error('Trade feed ignored condition filter')
    const takers = (
      await client.walk(
        '/v2/trades',
        {
          condition: market.condition_id,
          taker_only: true,
          filter_type: 'TOKENS',
          filter_amount: '0.000001',
          limit: 1000,
        },
        cache,
      )
    ).map(feedRow)
    const takerCounts = new Map<string, number>()
    for (const row of takers)
      takerCounts.set(tradeKey(row), (takerCounts.get(tradeKey(row)) ?? 0) + 1)
    for (const row of rows) {
      const key = tradeKey(row)
      const count = takerCounts.get(key) ?? 0
      row.is_taker = count > 0
      if (count > 0) takerCounts.set(key, count - 1)
    }
    if ([...takerCounts.values()].some((n) => n !== 0))
      throw new Error(`Taker feed is not a sub-multiset: ${market.slug}`)
    if (++completedMarkets % 12 === 0)
      log(
        `[research] ${day}: trades ${completedMarkets}/${catalog.markets.length}; requests=${client.stats.requests}`,
      )
    return rows
  })
  const trades: FeedRow[] = marketTrades.flat()
  const tradesByCondition = groupByCondition(trades)
  const volumeChecks: ApiRow[] = []
  for (const batch of chunks(catalog.markets, 20)) {
    if (batch.some((m) => !m.event_id))
      throw new Error('Missing Gamma event ID for volume verification')
    const volume = (await client.get('/v2/live-volume', {
      event_id: [...new Set(batch.map((m) => m.event_id))].join(','),
    })) as { data?: { conditions?: ApiRow[] } }
    if (!Array.isArray(volume.data?.conditions)) throw new Error('Invalid market volume response')
    for (const market of batch) {
      let row = volume.data.conditions.find((r) => r.condition_id === market.condition_id)
      let zeroEventResponse: unknown
      if (!row && !tradesByCondition.get(market.condition_id)?.length) {
        const single = (await client.get('/v2/live-volume', { event_id: market.event_id })) as {
          data?: { taker_volume_total?: unknown; conditions?: ApiRow[] }
        }
        if (
          Array.isArray(single.data?.conditions) &&
          units(single.data.taker_volume_total) === 0n &&
          single.data.conditions.every((r) => units(r.taker_volume) === 0n)
        ) {
          row = { taker_volume: '0' }
          zeroEventResponse = single
        }
      }
      if (!row) throw new Error(`Volume unavailable: ${market.slug}`)
      const expected = units(row.taker_volume)
      const actual = sum(
        (tradesByCondition.get(market.condition_id) ?? [])
          .filter((r) => r.is_taker)
          .map((r) => units(r.size)),
      )
      volumeChecks.push({
        slug: market.slug,
        expected_taker_shares: decimal(expected),
        downloaded_taker_shares: decimal(actual),
        difference: decimal(actual - expected),
        verification: zeroEventResponse ? 'empty_feeds_and_zero_event_total' : 'condition_volume',
        ...(zeroEventResponse ? { zero_event_response: zeroEventResponse } : {}),
      })
      if (abs(actual - expected) > 1n)
        throw new Error(
          `Trade volume mismatch ${market.slug}: downloaded=${decimal(actual)} API=${decimal(expected)}; cached pages retained for investigation`,
        )
    }
  }
  const participants = new Map<string, Set<string>>()
  for (const trade of trades) {
    const wallet = trade.proxy_wallet.toLowerCase()
    let conditions = participants.get(wallet)
    if (!conditions) {
      conditions = new Set()
      participants.set(wallet, conditions)
    }
    conditions.add(trade.condition_id)
  }
  const jobs: WalletJob[] = [...participants]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([wallet, conditions]) =>
      chunks([...conditions].sort(), 20).map((group) => ({ wallet, conditions: group })),
    )
  log(
    `[research] ${day}: ${trades.length} trades, ${participants.size} wallets, ${jobs.length} wallet batches`,
  )
  // The market OPEN superset matched 5,829 wallet-scoped rows across the full
  // initial 96-market benchmark. CLOSED still requires a wallet anchor: the
  // market CLOSED population omits many fully exited traders.
  const marketOpenPositions = (
    await parallelMap(catalog.markets, options.concurrency, async (market) => {
      const rows = (
        await client.walk(
          '/v2/positions',
          {
            condition: market.condition_id,
            status: 'OPEN',
            include_archived: true,
            filter_type: 'TOKENS',
            filter_amount: '0.000001',
            limit: 1000,
          },
          cache,
        )
      ).map(positionRow)
      if (rows.some((row) => row.condition_id !== market.condition_id))
        throw new Error('Market positions ignored condition filter')
      return rows.filter((row) =>
        participants.get(row.proxy_wallet.toLowerCase())?.has(row.condition_id),
      )
    })
  ).flat()
  let completedJobs = 0
  const walletResults = await parallelMap(
    jobs,
    options.concurrency,
    async (job): Promise<WalletResult> => {
      const params = { user: job.wallet, condition: job.conditions.join(','), limit: 1000 }
      const activities = (
        await client.walk(
          '/v2/activity',
          { ...params, start: 1, end: state!.asOf, sort_direction: 'ASC' },
          cache,
        )
      ).map(activityRow)
      const closed = (
        await client.walk('/v2/positions', { ...params, status: 'CLOSED' }, cache)
      ).map(positionRow)
      const positions = closed
      if (
        [...activities, ...positions].some(
          (row) =>
            row.proxy_wallet.toLowerCase() !== job.wallet ||
            !job.conditions.includes(row.condition_id),
        )
      ) {
        throw new Error('Wallet endpoint ignored its wallet/condition filters')
      }
      if (++completedJobs % 50 === 0 || completedJobs === jobs.length) {
        const elapsed = (Date.now() - started) / 1000
        log(
          `[research] ${day}: wallet batches ${completedJobs}/${jobs.length}; elapsed=${elapsed.toFixed(0)}s requests=${client.stats.requests} retries=${client.stats.retries}`,
        )
        await ensureDisk(options.root, options.minFreeGiB ?? 5)
      }
      return { ...job, activities, positions }
    },
  )
  const activities = walletResults.flatMap((result) => result.activities)
  const positions = [...marketOpenPositions, ...walletResults.flatMap((result) => result.positions)]
  const activitiesByCondition = groupByCondition(activities)
  const positionsByCondition = groupByCondition(positions)
  const fetched = new Map<string, Set<string>>()
  for (const result of walletResults) {
    for (const condition of result.conditions) {
      if (!fetched.has(condition)) fetched.set(condition, new Set())
      fetched.get(condition)!.add(result.wallet)
    }
  }
  const summaries = catalog.markets.flatMap((market) =>
    summarizeMarket(
      market,
      tradesByCondition.get(market.condition_id) ?? [],
      activitiesByCondition.get(market.condition_id) ?? [],
      positionsByCondition.get(market.condition_id) ?? [],
      fetched.get(market.condition_id) ?? new Set(),
    ),
  )
  const summariesByCondition = groupRows(summaries, (row) => row.condition_id)
  const marketsBySlug = new Map(catalog.markets.map((market) => [market.slug, market]))
  const coverage = catalog.expected.map((slug) => {
    const market = marketsBySlug.get(slug)
    return coverageRow(slug, market, summariesByCondition.get(market?.condition_id ?? '') ?? [])
  })
  const directory = path.join('snapshots', day, state.generation)
  const absolute = path.join(options.root, directory)
  const db = await DuckDBInstance.create(':memory:', { threads: '2', memory_limit: '512MB' })
  const connection = await db.connect()
  const stagedBytes = await directoryBytes(stage)
  let peakWorkingBytes = stagedBytes
  let bytes = 0
  try {
    const tables: Record<TableName, unknown[]> = {
      markets: catalog.markets,
      trades: trades.map((r, i) => ({ ...r, row_index: i, raw_json: JSON.stringify(r) })),
      activities: activities.map((r, i) => ({ ...r, row_index: i, raw_json: JSON.stringify(r) })),
      positions: positions.map((r) => ({ ...r, raw_json: JSON.stringify(r) })),
      wallet_markets: summaries,
      coverage,
    }
    for (const table of TABLES) {
      await ensureDisk(options.root, options.minFreeGiB ?? 5)
      bytes += await writeParquet(connection, table, tables[table], absolute, (currentBytes) => {
        peakWorkingBytes = Math.max(peakWorkingBytes, stagedBytes + bytes + currentBytes)
      })
    }
  } finally {
    connection.closeSync()
    db.closeSync()
  }
  const reportFile = path.join(directory, 'report.json')
  const snapshot: DaySnapshot = {
    date: day,
    directory,
    generation: state.generation,
    as_of: new Date(state.asOf * 1000).toISOString(),
    missing_markets: catalog.missing,
    complete_wallet_markets: summaries.filter((r) => r.quality === 'complete').length,
    unresolved_wallet_markets: summaries.filter((r) => r.quality === 'unresolved').length,
    pending_wallet_markets: summaries.filter((r) => r.quality === 'pending_resolution').length,
    parquet_bytes: bytes,
    report: reportFile,
  }
  const issueCounts: Record<string, number> = {}
  for (const row of summaries)
    for (const issue of row.issues) issueCounts[issue] = (issueCounts[issue] ?? 0) + 1
  const finalFreshness = await client.get('/v2/status')
  await writeJson(path.join(absolute, 'wallet-queries.json'), jobs)
  const files = await snapshotDigests(absolute)
  await writeJson(path.join(options.root, reportFile), {
    accounting_version: ACCOUNTING_VERSION,
    downloader_version: 3,
    requested_rps: options.requestsPerSecond,
    concurrency: options.concurrency,
    files,
    ...snapshot,
    source: 'Polymarket Data API v2 + Gamma',
    open_position_scope: 'market',
    closed_position_scope: 'wallet',
    started_at: state.startedAt,
    finished_at: new Date().toISOString(),
    elapsed_seconds: (Date.now() - started) / 1000,
    resumed_from_checkpoint: resumed,
    freshness,
    freshness_at_finish: finalFreshness,
    volume_checks: volumeChecks,
    staged_compressed_bytes: stagedBytes,
    measured_peak_working_bytes: peakWorkingBytes,
    market_count: catalog.markets.length,
    trade_rows: trades.length,
    activity_rows: activities.length,
    position_rows: positions.length,
    wallets: participants.size,
    wallet_batches: jobs.length,
    api: client.stats,
    issues: issueCounts,
  })
  await publish(options.root, snapshot)
  log(
    `[research] ${day} published: ${snapshot.complete_wallet_markets} complete, ${snapshot.unresolved_wallet_markets} unresolved wallet/markets; ${(bytes / 1024 ** 2).toFixed(1)} MiB`,
  )
  if (!options.keepRaw) await rm(cache, { recursive: true, force: true })
  return snapshot
}
