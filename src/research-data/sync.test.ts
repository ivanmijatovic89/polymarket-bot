import assert from 'node:assert/strict'
import { appendFile, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ApiClient } from './api.js'
import { normalizeMarket, parseDate } from './catalog.js'
import { coverageReport, leaderboard, querySql } from './query.js'
import { openDataset } from './storage.js'
import { benchmarkDataset } from './benchmark.js'
import { rebuildDataset } from './rebuild.js'
import { verifyDataset } from './verify.js'
import { syncDataset } from './sync.js'

test('UTC market cohorts use the slug window, not Gamma creation date', () => {
  const market = normalizeMarket(
    {
      slug: 'btc-updown-15m-1780272000',
      conditionId: `0x${'a'.repeat(64)}`,
      clobTokenIds: '["up","down"]',
      outcomes: '["Up","Down"]',
      startDate: '2026-05-31T00:00:00Z',
    },
    { status: 'resolved', payouts: [1000000, 0] },
  )
  assert.equal(market.market_start, parseDate('2026-06-01'))
  assert.throws(() => parseDate('2026-02-30'))
})

test('full day sync, offline queries, no-op rerun and refresh publish consistent snapshots', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'research-sync-'))
  const buyers = `0x${'a'.repeat(40)}`
  const sellers = `0x${'b'.repeat(40)}`
  const start = parseDate('2026-06-01')
  const conditions = Array.from(
    { length: 96 },
    (_, i) => `0x${(i + 1).toString(16).padStart(64, '0')}`,
  )
  let version = 1
  let requests = 0
  const row = (
    condition: string,
    wallet: string,
    type: string,
    side = '',
    token = 'up',
    size = 10,
    cash = 4,
  ) => ({
    proxy_wallet: wallet,
    condition_id: condition,
    token_id: `${token}-${condition}`,
    transaction_hash: `tx-${condition}-${type}-${wallet}`,
    timestamp: start,
    side,
    size,
    price: cash / size,
    type,
    usdc_size: cash,
  })
  const pos = (condition: string, wallet: string, token: string, balance: number, pnl: number) => ({
    proxy_wallet: wallet,
    condition_id: condition,
    token_id: `${token}-${condition}`,
    current_size: balance,
    total_pnl: pnl,
    realized_pnl: pnl,
    unrealized_pnl: 0,
    entry_fees_usdc: 0,
  })
  const client = new ApiClient({
    requestsPerSecond: 100000,
    sleep: async () => {},
    fetch: (async (input) => {
      requests++
      const url = new URL(String(input))
      const q = url.searchParams
      const selected = q.get('condition')?.split(',') ?? []
      const user = q.get('user')
      let data: unknown = []
      if (url.pathname === '/markets') {
        return Response.json(
          q.getAll('slug').map((slug) => {
            const i = (Number(slug.split('-').at(-1)) - start) / 900
            const condition = conditions[i]!
            return {
              slug,
              conditionId: condition,
              clobTokenIds: JSON.stringify([`up-${condition}`, `down-${condition}`]),
              outcomes: '["Up","Down"]',
              events: [{ id: i + 1 }],
            }
          }),
        )
      }
      if (url.pathname === '/v2/resolutions')
        data = selected.map((condition) => ({
          condition_id: condition,
          status: 'resolved',
          payouts: [1000000, 0],
        }))
      else if (url.pathname === '/v2/status') data = { serving: { lag_seconds: 0 }, age_seconds: 0 }
      else if (url.pathname === '/v2/live-volume')
        data = {
          taker_volume_total:
            q
              .get('event_id')!
              .split(',')
              .filter((id) => version !== 3 || id !== '96').length * 10,
          conditions: q
            .get('event_id')!
            .split(',')
            .filter((id) => version !== 3 || id !== '96')
            .map((id) => ({ condition_id: conditions[Number(id) - 1], taker_volume: 10 })),
        }
      else if (url.pathname === '/v2/trades')
        data = selected
          .filter((condition) => version !== 3 || condition !== conditions[95])
          .flatMap((condition) => [
            row(condition, buyers, 'TRADE', 'BUY', 'up', 10, version === 1 ? 4 : 3),
            ...(q.get('taker_only') === 'false' ? [row(condition, sellers, 'TRADE', 'SELL')] : []),
          ])
      else if (url.pathname === '/v2/activity')
        data = selected.flatMap((condition) =>
          user === buyers
            ? [row(condition, buyers, 'TRADE', 'BUY', 'up', 10, version === 1 ? 4 : 3)]
            : [
                row(condition, sellers, 'SPLIT', '', '', 10, 10),
                row(condition, sellers, 'TRADE', 'SELL'),
                row(condition, sellers, 'REDEEM', '', 'down', 10, 0),
              ],
        )
      else if (url.pathname === '/v2/positions')
        data = selected.flatMap((condition) =>
          !user
            ? [pos(condition, buyers, 'up', 10, version === 1 ? 6 : 7)]
            : user === buyers
              ? q.get('status') === 'OPEN'
                ? [pos(condition, buyers, 'up', 10, version === 1 ? 6 : 7)]
                : []
              : q.get('status') === 'CLOSED'
                ? [pos(condition, sellers, 'up', 0, -1), pos(condition, sellers, 'down', 0, -5)]
                : [],
        )
      else throw new Error(`Unexpected endpoint ${url.pathname}`)
      return Response.json({ data, pagination: { next_cursor: null } })
    }) as typeof fetch,
  })
  const options = {
    root,
    from: '2026-06-01',
    to: '2026-06-02',
    concurrency: 4,
    requestsPerSecond: 12,
    minFreeGiB: 1,
    client,
    log: () => {},
  }
  try {
    const [snapshot] = await syncDataset(options)
    assert.equal(snapshot!.complete_wallet_markets, 192)
    assert.equal(snapshot!.unresolved_wallet_markets, 0)
    const verification = await verifyDataset(root, options.from, options.to)
    assert.equal(verification.valid, true, JSON.stringify(verification))
    assert.equal(verification.all_wallet_accounting_complete, true)
    const beforeQueries = requests
    const ranking = (await leaderboard(root, options.from, options.to)) as {
      rows: { wallet: string; economic_pnl_usdc: number }[]
    }
    assert.equal(ranking.rows[0]!.wallet, buyers)
    assert.equal(Number(ranking.rows[0]!.economic_pnl_usdc), 576)
    await coverageReport(root, options.from, options.to)
    const months = (await querySql(
      root,
      'SELECT cohort_complete, economic_pnl_usdc FROM wallet_months',
    )) as { cohort_complete: boolean; economic_pnl_usdc: unknown }[]
    assert.equal(months[0]!.cohort_complete, false, 'one day must not look like a complete June')
    assert.equal(months[0]!.economic_pnl_usdc, null)
    assert.equal(requests, beforeQueries, 'queries must never call the API')
    await syncDataset(options)
    assert.equal(requests, beforeQueries, 'published day is an idempotent no-op')
    await assert.rejects(leaderboard(root, '2026-06-01', '2026-07-01'), /Missing days/)
    const oldReader = await openDataset(root)
    version = 2
    const [updated] = await syncDataset({ ...options, refresh: true })
    assert.notEqual(updated!.generation, snapshot!.generation)
    const old = (
      await oldReader.connection.runAndReadAll(
        `SELECT sum(economic_pnl_usdc)::DOUBLE AS pnl FROM wallet_markets WHERE wallet='${buyers}'`,
      )
    ).getRowObjectsJson()
    assert.equal(old[0]!.pnl, 576, 'reader keeps its immutable generation through refresh')
    oldReader.close()
    const refreshed = (await leaderboard(root, options.from, options.to)) as {
      rows: { economic_pnl_usdc: number }[]
    }
    assert.equal(Number(refreshed.rows[0]!.economic_pnl_usdc), 672)
    const count = (await querySql(root, 'SELECT count(*)::INTEGER AS n FROM trades')) as {
      n: number
    }[]
    assert.equal(count[0]!.n, 192, 'refresh must replace active rows instead of doubling them')
    const benchmark = await benchmarkDataset(root, options.from, options.to, 122)
    assert.equal(benchmark.projection.eligible_fresh_days, 1)
    assert.equal(benchmark.local_queries.queries.length, 3)
    assert.ok(benchmark.projection.parquet_bytes!.mean > 0)
    const beforeRebuild = requests
    const [rebuilt] = await rebuildDataset(root, options.from, options.to, 1)
    assert.notEqual(rebuilt!.generation, updated!.generation)
    assert.equal(requests, beforeRebuild, 'accounting rebuild must be entirely offline')
    const rebuiltVerification = await verifyDataset(root, options.from, options.to)
    assert.equal(rebuiltVerification.valid, true, JSON.stringify(rebuiltVerification))
    const rebuiltRanking = (await leaderboard(root, options.from, options.to)) as {
      rows: { economic_pnl_usdc: number }[]
    }
    assert.equal(Number(rebuiltRanking.rows[0]!.economic_pnl_usdc), 672)
    const immutableRebuildReader = await openDataset(root)
    version = 3
    const [afterRebuild] = await syncDataset({ ...options, refresh: true })
    assert.notEqual(
      afterRebuild!.generation,
      updated!.generation,
      'refresh after rebuild must never overwrite the earlier published generation',
    )
    const stillOld = (
      await immutableRebuildReader.connection.runAndReadAll(
        'SELECT count(*)::INTEGER AS n FROM trades',
      )
    ).getRowObjectsJson()
    assert.equal(
      stillOld[0]!.n,
      192,
      'hard-linked source facts remain immutable after another refresh',
    )
    immutableRebuildReader.close()
    const zeroMarket = (await querySql(
      root,
      'SELECT found, trade_count FROM coverage ORDER BY market_start DESC LIMIT 1',
    )) as { found: boolean; trade_count: string }[]
    assert.equal(zeroMarket[0]!.found, true)
    assert.equal(Number(zeroMarket[0]!.trade_count), 0)
    const zeroVerified = await verifyDataset(root, options.from, options.to)
    assert.equal(zeroVerified.valid, true, JSON.stringify(zeroVerified))
    await appendFile(path.join(root, afterRebuild!.directory, 'wallet-queries.json'), ' ')
    const corrupt = await verifyDataset(root, options.from, options.to)
    assert.equal(corrupt.valid, false)
    assert.ok(corrupt.days[0]!.errors.some((error) => error.includes('Checksum mismatch')))
    await assert.rejects(
      rebuildDataset(root, options.from, options.to, 1),
      /Source integrity failed/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
