import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, access, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ApiClient } from './api.js'
import { dates, parseDate } from './catalog.js'
import { marketFamily, ensureDatasetFamily } from './family.js'
import { readJson, writeJson } from './files.js'
import { claimReader, pruneSnapshots } from './retention.js'
import { scheduledDate, updatePlan, updateDataset } from './update.js'
import { WalletBatches, fetchWallet } from './wallet-batches.js'
import { claimLock, SyncBusyError } from './sync.js'
import { loadIndex, type DaySnapshot, type DatasetIndex } from './storage.js'
import { leaderboard } from './query.js'

test('update fills older holes and refreshes exactly seven complete UTC days without double downloads', () => {
  const index: DatasetIndex = { version: 1, days: {} }
  for (const day of dates('2026-09-01', '2026-10-06'))
    index.days[day] = { missing_markets: [] } as unknown as DaySnapshot
  delete index.days['2026-09-08']
  delete index.days['2026-10-05']
  index.days['2026-10-01']!.missing_markets = ['missing-window']
  const plan = updatePlan(index, '2026-09-01', '2026-10-06')
  assert.deepEqual(plan.missing, ['2026-09-08', '2026-10-01', '2026-10-05'])
  assert.deepEqual(plan.refresh, [
    '2026-09-29',
    '2026-09-30',
    '2026-10-02',
    '2026-10-03',
    '2026-10-04',
  ])
  assert.equal(new Set([...plan.missing, ...plan.refresh]).size, 8)
  assert.equal([...plan.missing, ...plan.refresh].includes('2026-10-06'), false)
})

test('03:00 Belgrade schedule honors summer/winter offsets and login before the trigger', () => {
  assert.equal(scheduledDate(new Date('2026-10-06T00:59:00Z')), '2026-10-05')
  assert.equal(scheduledDate(new Date('2026-10-06T01:00:00Z')), '2026-10-06')
  assert.equal(scheduledDate(new Date('2026-12-06T01:59:00Z')), '2026-12-05')
  assert.equal(scheduledDate(new Date('2026-12-06T02:00:00Z')), '2026-12-06')
})

test('writer lock prevents overlap, recovers a dead owner, and refuses ambiguous ownership', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'research-lock-'))
  try {
    const release = await claimLock(root)
    await assert.rejects(claimLock(root), SyncBusyError)
    await release()
    await writeJson(path.join(root, 'sync.lock'), { pid: 2147483647, host: hostname() })
    const recovered = await claimLock(root)
    await assert.rejects(claimLock(root), SyncBusyError)
    await recovered()
    await writeJson(path.join(root, 'sync.lock'), { pid: process.pid, host: 'another-machine' })
    await assert.rejects(claimLock(root), /Cannot establish lock ownership/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('retention preserves live readers, historical evidence, pins, current and one previous generation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'research-retention-'))
  try {
    const directories: string[] = []
    for (let i = 0; i < 6; i++) {
      const directory = path.join('snapshots', '2026-06-01', randomUUID())
      directories.push(directory)
      await writeJson(path.join(root, directory, 'report.json'), {
        retention_managed: i > 0,
        finished_at: `2026-10-0${i + 1}T00:00:00Z`,
      })
      await writeFile(path.join(root, directory, 'facts'), String(i))
    }
    const index: DatasetIndex = {
      version: 1,
      days: { '2026-06-01': { date: '2026-06-01', directory: directories[5] } as DaySnapshot },
    }
    await writeJson(path.join(root, 'retention-pins.json'), [directories[1]])
    const release = await claimReader(root)
    assert.equal((await pruneSnapshots(root, index)).deferred_for_readers, true)
    await access(path.join(root, directories[2]!, 'facts'))
    release()
    const pruned = await pruneSnapshots(root, index)
    assert.deepEqual(pruned.removed.sort(), [directories[2], directories[3]].sort())
    for (const i of [0, 1, 4, 5]) await access(path.join(root, directories[i]!, 'facts'))
    assert.deepEqual((await pruneSnapshots(root, index)).removed, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('family identity prevents accidental market mixing and keeps future families disabled', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'research-family-'))
  try {
    assert.equal((await ensureDatasetFamily(root)).id, 'btc:15m')
    assert.throws(() => marketFamily('btc:5m'), /not enabled/)
    await writeJson(path.join(root, 'dataset.json'), { version: 1, market: 'eth:15m' })
    await assert.rejects(ensureDatasetFamily(root), /not enabled/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('combined wallet requests preserve occurrences, resume from disk, and fetch new participants', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'research-batches-'))
  const wallet = `0x${'a'.repeat(40)}`
  const other = `0x${'b'.repeat(40)}`
  const conditions = ['first', 'second']
  let clock = 1_000_000
  let requests = 0
  const client = new ApiClient({
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
    },
    fetch: async (input) => {
      requests++
      const url = new URL(String(input))
      const q = url.searchParams
      assert.equal(q.get('limit'), '1000')
      const selected = q.get('condition')!.split(',')
      const rows = selected.flatMap<Record<string, unknown>>((condition, i) =>
        url.pathname === '/v2/activity'
          ? Array.from({ length: 2 }, () => ({
              proxy_wallet: q.get('user'),
              condition_id: condition,
              token_id: 'up',
              transaction_hash: 'same-transaction',
              timestamp: 10 + i,
              side: 'BUY',
              size: '1',
              price: '0.5',
              type: 'TRADE',
              usdc_size: '0.5',
            }))
          : [
              {
                proxy_wallet: q.get('user'),
                condition_id: condition,
                token_id: 'up',
                current_size: '0',
                realized_pnl: '1',
                unrealized_pnl: '0',
                total_pnl: '1',
              },
            ],
      )
      if (url.pathname === '/v2/activity') {
        assert.equal(q.get('start'), '1')
        assert.equal(q.get('end'), '100')
        assert.equal(q.get('sort_direction'), 'ASC')
        return Response.json({
          data: q.has('cursor') ? rows.slice(1) : rows.slice(0, 1),
          pagination: { next_cursor: q.has('cursor') ? null : 'next' },
        })
      }
      assert.equal(q.get('status'), 'CLOSED')
      return Response.json({ data: rows, pagination: { next_cursor: null } })
    },
  })
  try {
    const seeds = conditions.map((condition) => ({ wallet, conditions: [condition] }))
    const queue = await WalletBatches.create(client, seeds, 100, path.join(root, 'combined'))
    const first = await queue.fetch(seeds[0]!, 100, path.join(root, 'day1'))
    const second = await queue.fetch(seeds[1]!, 100, path.join(root, 'day2'))
    assert.equal(
      requests,
      3,
      'one paginated activity walk and one positions request cover both days',
    )
    assert.equal(first.activities.length, 2, 'identical genuine occurrences are not deduplicated')
    assert.equal(second.activities.length, 2)
    assert.ok(first.activities.every((row) => row.condition_id === 'first'))
    const resumed = await WalletBatches.create(client, [], 100, path.join(root, 'combined'))
    assert.deepEqual(await resumed.fetch(seeds[0]!, 100, path.join(root, 'day1')), first)
    assert.equal(requests, 3, 'resumed combined queue uses complete persisted pages')
    const direct = await fetchWallet(client, seeds[0]!, 100, path.join(root, 'direct'))
    assert.deepEqual(direct, first, 'combined and independent daily facts match')
    const newcomer = await resumed.fetch(
      { wallet: other, conditions: ['first'] },
      100,
      path.join(root, 'new'),
    )
    assert.ok(newcomer.activities.every((row) => row.proxy_wallet === other))
    assert.equal(resumed.stats.fallback_daily_batches, 1)
    await assert.rejects(
      WalletBatches.create(client, [], 101, path.join(root, 'combined')),
      /cutoff mismatch/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('nightly update resumes a failed day, skips its published predecessor, and then catches up with a shared refresh', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'research-update-'))
  const wallets = Array.from(
    { length: 30 },
    (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`,
  )
  const condition = (start: number) => `0x${start.toString(16).padStart(64, '0')}`
  const epoch = (id: string) => parseInt(id.slice(2), 16)
  let missingCatalog = false
  let fail = true,
    requests = 0,
    clock = 1_000_000
  const client = new ApiClient({
    attempts: 1,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
    },
    fetch: async (input) => {
      requests++
      const url = new URL(String(input)),
        q = url.searchParams
      const selected = q.get('condition')?.split(',') ?? []
      if (url.pathname === '/markets')
        return Response.json(
          q
            .getAll('slug')
            .filter((slug) => !missingCatalog || Number(slug.split('-').at(-1)) % 86400 !== 85500)
            .map((slug) => {
              const start = Number(slug.split('-').at(-1)),
                id = condition(start)
              return {
                slug,
                conditionId: id,
                clobTokenIds: JSON.stringify([`up-${id}`, `down-${id}`]),
                outcomes: '["Up","Down"]',
                events: [{ id: start }],
              }
            }),
        )
      if (url.pathname.startsWith('/markets/slug/'))
        return Response.json({ error: 'not found' }, { status: 404 })
      const active = selected.filter((id) => epoch(id) % 86400 === 0)
      const trade = (id: string, wallet: string) => ({
        condition_id: id,
        proxy_wallet: wallet,
        token_id: `up-${id}`,
        transaction_hash: `tx-${id}-${wallet}`,
        timestamp: epoch(id),
        side: 'BUY',
        size: '1',
        price: '0.5',
        type: 'TRADE',
        usdc_size: '0.5',
      })
      let data: unknown
      if (url.pathname === '/v2/status') data = { serving: { lag_seconds: 0 } }
      else if (url.pathname === '/v2/resolutions')
        data = selected.map((id) => ({
          condition_id: id,
          status: 'resolved',
          payouts: [1000000, 0],
        }))
      else if (url.pathname === '/v2/trades') {
        if (fail && selected.some((id) => epoch(id) >= parseDate('2026-06-02')))
          throw new Error('Simulated network interruption')
        data = active.flatMap((id) => wallets.map((wallet) => trade(id, wallet)))
      } else if (url.pathname === '/v2/live-volume')
        data = {
          conditions: q
            .get('event_id')!
            .split(',')
            .map((id) => ({
              condition_id: condition(Number(id)),
              taker_volume: Number(id) % 86400 === 0 ? 30 : 0,
            })),
        }
      else if (url.pathname === '/v2/activity') data = active.map((id) => trade(id, q.get('user')!))
      else if (url.pathname === '/v2/positions')
        data =
          q.get('status') === 'CLOSED'
            ? []
            : active.flatMap((id) =>
                wallets.map((wallet) => ({
                  condition_id: id,
                  proxy_wallet: wallet,
                  token_id: `up-${id}`,
                  current_size: '1',
                  realized_pnl: '0',
                  unrealized_pnl: '0.5',
                  total_pnl: '0.5',
                  entry_fees_usdc: '0',
                })),
              )
      else throw new Error(`Unexpected endpoint: ${url.pathname}`)
      return Response.json({ data, pagination: { next_cursor: null } })
    },
  })
  const options = {
    root,
    from: '2026-06-01',
    now: new Date('2026-06-03T04:00:00Z'),
    concurrency: 4,
    requestsPerSecond: 32,
    minFreeGiB: 1,
    client,
    log: () => {},
  }
  try {
    await assert.rejects(updateDataset(options), /Simulated network interruption/)
    const first = (await loadIndex(root)).days['2026-06-01']!.generation
    const state = await readJson<{ id: string; status: string }>(
      path.join(root, 'update-state.json'),
    )
    assert.equal(state!.status, 'failed')
    fail = false
    const recovered = await updateDataset(options)
    assert.equal(recovered.status, 'complete')
    assert.equal((await loadIndex(root)).days['2026-06-01']!.generation, first)
    const resumed = await readJson<{ id: string }>(path.join(root, 'update-state.json'))
    assert.equal(resumed!.id, state!.id, 'resume keeps the original cutoff and queue identity')
    const before = requests
    assert.equal((await updateDataset({ ...options, scheduled: true })).status, 'already_completed')
    assert.equal(requests, before)
    await updateDataset({ ...options, now: new Date('2026-06-04T04:00:00Z') })
    const updated = await readJson<{
      status: string
      wallet_batches: { combined_batches: number; fallback_daily_batches: number }
    }>(path.join(root, 'update-state.json'))
    assert.equal(
      updated!.wallet_batches.combined_batches,
      30,
      'two daily 30-wallet queues combine into 30 requests per endpoint',
    )
    assert.equal(updated!.wallet_batches.fallback_daily_batches, 0)
    const ranking = (await leaderboard(root, '2026-06-01', '2026-06-04')) as {
      rows: { profit_usdc: string; markets: string; trades: string }[]
    }
    assert.equal(ranking.rows.length, 30)
    assert.equal(ranking.rows[0]!.profit_usdc, '1.500000')
    assert.equal(ranking.rows[0]!.markets, '3')
    assert.equal(ranking.rows[0]!.trades, '3', 'refresh does not duplicate the old days')
    const beforeMissing = await loadIndex(root)
    missingCatalog = true
    await assert.rejects(
      updateDataset({ ...options, now: new Date('2026-06-04T05:00:00Z') }),
      /Market windows missing/,
    )
    assert.deepEqual(
      await loadIndex(root),
      beforeMissing,
      'a missing catalog window must not replace good published data',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
