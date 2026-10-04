import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ApiClient } from './api.js'
import { normalizeMarket, parseDate } from './catalog.js'
import { units } from './decimal.js'
import { readJson, writeJson } from './files.js'
import { fileDigest } from './integrity.js'
import { coverageReport, leaderboard, querySql } from './query.js'
import { rebuildDataset } from './rebuild.js'
import { syncDataset } from './sync.js'
import type { ApiRow, FeedRow } from './types.js'
import { verifyDataset } from './verify.js'
import {
  validateVolumeEvidence,
  volumeCandidate,
  VOLUME_WARNING,
  type VolumeEvidence,
} from './volume.js'

const start = parseDate('2026-06-01')
const conditions = Array.from(
  { length: 96 },
  (_, i) => `0x${(i + 1).toString(16).padStart(64, '0')}`,
)
const wallet = (i: number) => `0x${String(i).padStart(40, '0')}`
const gamma = (index: number) => ({
  slug: `btc-updown-15m-${start + index * 900}`,
  conditionId: conditions[index],
  clobTokenIds: '["up","down"]',
  outcomes: '["Up","Down"]',
  events: [{ id: index + 1 }],
})
const market = normalizeMarket(gamma(0), { status: 'resolved', payouts: [1000000, 0] })
const trades: FeedRow[] = [0, 1, 2, 3].map((i) => ({
  proxy_wallet: wallet(i + 1),
  condition_id: conditions[0]!,
  token_id: i % 2 ? 'down' : 'up',
  side: 'BUY',
  price: 0.5,
  size: i < 2 ? '1.960783' : '30000',
  timestamp: i < 2 ? start - 100 : start,
  transaction_hash: i < 2 ? 'early' : 'later',
  is_taker: i % 2 === 0,
}))
const evidence = (): VolumeEvidence => ({
  version: 1,
  condition_id: market.condition_id,
  observed_at: '2026-10-04T00:00:00Z',
  page_size: 137,
  aggregate_shares: '30000',
  all_trades: structuredClone(trades),
  taker_trades: structuredClone(trades.filter((row) => row.is_taker)),
})
const summaries = trades.map((row) => ({
  wallet: row.proxy_wallet,
  condition_id: row.condition_id,
  quality: 'complete' as const,
}))

test('source-volume exception requires a small unique early fill, repeated multisets and reconciled counterparties', () => {
  assert.equal(
    validateVolumeEvidence(market, trades, units('30000'), evidence(), summaries).difference,
    '1.960783',
  )
  assert.equal(volumeCandidate(market, trades, units('29999.999999')).difference, '1.960784')
  assert.throws(() => volumeCandidate(market, trades, units('29999')), /mismatch/)
  assert.throws(
    () => volumeCandidate({ ...market, market_start: start - 100 }, trades, units('30000')),
    /mismatch/,
  )
  assert.throws(
    () => volumeCandidate({ ...market, resolved: false }, trades, units('30000')),
    /mismatch/,
  )
  assert.throws(() => volumeCandidate(market, trades.slice(0, 2), 1n), /mismatch/)
  const larger = structuredClone(trades)
  larger[0]!.size = larger[1]!.size = '11'
  assert.throws(() => volumeCandidate(market, larger, units('30000')), /mismatch/)
  const lowVolume = structuredClone(trades)
  lowVolume[2]!.size = lowVolume[3]!.size = '100'
  assert.throws(() => volumeCandidate(market, lowVolume, units('100')), /mismatch/)
  const tied = structuredClone(trades)
  tied[2]!.timestamp = start - 100
  assert.throws(() => volumeCandidate(market, tied, units('30000')), /mismatch/)
  const duplicate = evidence()
  duplicate.all_trades.push({ ...trades[0]! })
  assert.throws(
    () => validateVolumeEvidence(market, trades, units('30000'), duplicate, summaries),
    /corroboration/,
  )
  const changed = evidence()
  changed.taker_trades[0]!.size = '1.960784'
  assert.throws(
    () => validateVolumeEvidence(market, trades, units('30000'), changed, summaries),
    /corroboration/,
  )
  assert.throws(
    () => validateVolumeEvidence(market, trades, units('30000'), evidence(), summaries.slice(1)),
    /corroboration/,
  )
})

function fixture(changeRepeat = false, badCounterparty = false) {
  let now = 1_000_000
  let repeatRequests = 0
  const client = new ApiClient({
    requestsPerSecond: 100000,
    now: () => now,
    sleep: async (ms) => {
      now += ms
    },
    fetch: (async (input) => {
      const url = new URL(String(input)),
        q = url.searchParams
      const selected = q.get('condition')?.split(',') ?? []
      const active = selected.includes(conditions[0]!)
      const user = q.get('user')
      if (url.pathname === '/markets')
        return Response.json(
          q.getAll('slug').map((slug) => gamma((Number(slug.split('-').at(-1)) - start) / 900)),
        )
      if (url.pathname === '/v2/live-volume')
        return Response.json({
          data: {
            conditions: q
              .get('event_id')!
              .split(',')
              .map((id) => ({
                condition_id: conditions[Number(id) - 1],
                taker_volume: id === '1' ? 30000 : 0,
              })),
          },
        })
      let data: unknown = []
      if (url.pathname === '/v2/status') data = {}
      else if (url.pathname === '/v2/resolutions')
        data = selected.map((condition_id) => ({
          condition_id,
          status: 'resolved',
          payouts: [1000000, 0],
        }))
      else if (url.pathname === '/v2/trades') {
        data = active ? trades.filter((row) => q.get('taker_only') === 'false' || row.is_taker) : []
        if (q.get('limit') === '137') {
          repeatRequests++
          if (changeRepeat) data = (data as FeedRow[]).slice(1)
        }
      } else if (url.pathname === '/v2/activity')
        data = active
          ? trades
              .filter((row) => row.proxy_wallet === user)
              .map((row) => ({
                ...row,
                type: 'TRADE',
                usdc_size: Number(row.size) < 2 ? '0.980391' : '15000',
              }))
          : []
      else if (url.pathname === '/v2/positions')
        data =
          active && !user
            ? trades.map((row, i) => ({
                ...row,
                current_size: badCounterparty && i === 0 ? 0 : row.size,
                realized_pnl: 0,
                unrealized_pnl: [0.980392, -0.980391, 15000, -15000][i],
                total_pnl: [0.980392, -0.980391, 15000, -15000][i],
                entry_fees_usdc: 0,
              }))
            : []
      else throw new Error(`Unexpected endpoint ${url.pathname}`)
      return Response.json({ data, pagination: { next_cursor: null } })
    }) as typeof fetch,
  })
  return { client, repeats: () => repeatRequests }
}

test('corroborated volume warnings survive Parquet, offline verification and rebuild without excluding reconciled wallets', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'research-volume-'))
  const { client, repeats } = fixture()
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
    const [saved] = await syncDataset(options)
    assert.equal(repeats(), 2)
    assert.equal(saved!.complete_wallet_markets, 4)
    assert.equal(saved!.source_warnings?.length, 1)
    const verify = await verifyDataset(root, options.from, options.to)
    assert.equal(verify.valid, true, JSON.stringify(verify))
    assert.equal(verify.days[0]!.warnings.length, 1)
    assert.equal(verify.all_source_aggregates_reconciled, false)
    assert.equal(verify.all_wallet_accounting_complete, true)
    const ranking = (await leaderboard(root, options.from, options.to)) as {
      rows: { wallet: string }[]
      source_warnings: unknown[]
    }
    assert.equal(ranking.rows.length, 4)
    assert.ok(ranking.rows.some((row) => row.wallet === wallet(1)))
    assert.equal(ranking.source_warnings.length, 1)
    assert.equal(
      ((await coverageReport(root, options.from, options.to)) as { source_warnings: unknown[] })
        .source_warnings.length,
      1,
    )
    const flagged = await querySql(
      root,
      `SELECT slug FROM markets WHERE list_contains(source_warnings, '${VOLUME_WARNING}')`,
    )
    assert.equal(flagged.length, 1)
    const [rebuilt] = await rebuildDataset(root, options.from, options.to, 1)
    assert.equal((await verifyDataset(root, options.from, options.to)).valid, true)
    const file = path.join(root, rebuilt!.directory, 'volume-evidence.json')
    const proof = (await readJson<Record<string, VolumeEvidence>>(file))!
    proof[conditions[0]!]!.all_trades.pop()
    await writeJson(file, proof)
    let broken = await verifyDataset(root, options.from, options.to)
    assert.ok(broken.days[0]!.errors.some((error) => error.includes('Checksum mismatch')))
    const reportFile = path.join(root, rebuilt!.report)
    const report = (await readJson<ApiRow>(reportFile))!
    ;(report.files as ApiRow)['volume-evidence.json'] = await fileDigest(file)
    await writeJson(reportFile, report)
    broken = await verifyDataset(root, options.from, options.to)
    assert.equal(broken.valid, false)
    assert.ok(broken.days[0]!.errors.some((error) => error.includes('corroboration')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('changed repeat feeds or unresolved counterparties cannot publish a volume exception', async () => {
  for (const [changeRepeat, badCounterparty] of [
    [true, false],
    [false, true],
  ]) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'research-volume-reject-'))
    try {
      await assert.rejects(
        syncDataset({
          root,
          from: '2026-06-01',
          to: '2026-06-02',
          concurrency: 4,
          requestsPerSecond: 12,
          minFreeGiB: 1,
          client: fixture(changeRepeat, badCounterparty).client,
          log: () => {},
        }),
        /corroboration/,
      )
      assert.equal(await readJson(path.join(root, 'index.json')), null)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})
