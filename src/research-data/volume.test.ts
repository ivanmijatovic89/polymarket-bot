import assert from 'node:assert/strict'
import { mkdtemp, rm, rename } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ApiClient } from './api.js'
import { createResearchDatabase } from './database.js'
import { sqlQuote } from '../utils/duckdb.js'
import { normalizeMarket, parseDate } from './catalog.js'
import { decimal, units } from './decimal.js'
import { readJson, writeJson } from './files.js'
import { fileDigest } from './integrity.js'
import { coverageReport, strictLeaderboard as leaderboard, querySql } from './query.js'
import { rebuildDataset } from './rebuild.js'
import { syncDataset } from './sync.js'
import type { ApiRow, FeedRow } from './types.js'
import { verifyDataset } from './verify.js'
import {
  validateVolumeEvidence,
  volumeCandidate,
  VOLUME_WARNING,
  UNRESOLVED_VOLUME,
  type VolumeEvidence,
} from './volume.js'

const start = parseDate('2026-06-01')
const conditions = Array.from(
  { length: 192 },
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

test('source-volume exception requires a unique early fill, repeated multisets and reconciled counterparties', () => {
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
  larger[0]!.size = larger[1]!.size = '40'
  assert.equal(volumeCandidate(market, larger, units('30000')).difference, '40.000000')
  const lowVolume = structuredClone(trades)
  lowVolume[2]!.size = lowVolume[3]!.size = '100'
  assert.equal(volumeCandidate(market, lowVolume, units('100')).difference, '1.960783')
  assert.throws(() => volumeCandidate(market, lowVolume, 0n), /mismatch/)
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

function openingBurst(): FeedRow[] {
  const rows = [
    ...Array.from({ length: 15 }, (_, i) =>
      [0, 1].map((side) => ({
        ...trades[side]!,
        proxy_wallet: wallet(i * 2 + side + 1),
        timestamp: start - 100 + Math.floor((i * 31) / 14),
        transaction_hash: `opening-${i}`,
      })),
    ).flat(),
    ...trades.slice(2).map((row, i) => ({ ...row, proxy_wallet: wallet(31 + i) })),
  ]
  const maker = rows[1]!
  rows.splice(
    1,
    1,
    { ...maker, size: '0.570783' },
    { ...maker, proxy_wallet: wallet(33), size: '1.390000' },
  )
  return rows
}

test('isolated opening bursts require every fill and counterparty without assuming tie order', () => {
  const rows = openingBurst()
  const proof = {
    ...evidence(),
    all_trades: rows,
    taker_trades: rows.filter((row) => row.is_taker),
  }
  const reconciled = rows.map((row) => ({
    wallet: row.proxy_wallet,
    condition_id: row.condition_id,
    quality: 'complete' as const,
  }))
  const candidate = validateVolumeEvidence(market, rows, units('30000'), proof, reconciled)
  assert.equal(candidate.taker_fill_count, 15)
  assert.equal(candidate.difference, '29.411745')
  assert.equal(candidate.wallets.length, 31)
  assert.deepEqual(volumeCandidate(market, [...rows].reverse(), units('30000')), candidate)
  // A matching subset inside the opening burst is not an acceptable explanation.
  assert.throws(() => volumeCandidate(market, rows, units('30001.960783')), /mismatch/)
  assert.throws(
    () =>
      validateVolumeEvidence(
        market,
        rows,
        units('30000'),
        proof,
        reconciled.filter((row) => row.wallet !== wallet(33)),
      ),
    /corroboration/,
  )
  const continuous = structuredClone(rows)
  for (const row of continuous.filter((row) => row.transaction_hash === 'opening-14'))
    row.timestamp = start - 41
  for (const row of continuous.filter((row) => row.transaction_hash === 'later'))
    row.timestamp = start - 39
  assert.throws(() => volumeCandidate(market, continuous, units('30000')), /mismatch/)
})

function fixture(
  changeRepeat = false,
  badCounterparty = false,
  sourceTrades = trades,
  sourceVolume = '30000',
) {
  const trades = sourceTrades
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
      const scopedTrades = trades.filter((row) => selected.includes(row.condition_id))
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
                taker_volume:
                  id === '1'
                    ? sourceVolume
                    : decimal(
                        trades
                          .filter(
                            (row) =>
                              row.condition_id === conditions[Number(id) - 1] && row.is_taker,
                          )
                          .reduce((total, row) => total + units(row.size), 0n),
                      ),
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
        data = scopedTrades.filter((row) => q.get('taker_only') === 'false' || row.is_taker)
        if (q.get('limit') === '137') {
          repeatRequests++
          if (changeRepeat) data = (data as FeedRow[]).slice(1)
        }
      } else if (url.pathname === '/v2/activity')
        data = scopedTrades
          .filter((row) => row.proxy_wallet === user)
          .map((row) => ({
            ...row,
            type: 'TRADE',
            usdc_size: decimal(units(row.size) / 2n),
          }))
      else if (url.pathname === '/v2/positions')
        data = !user
          ? scopedTrades.map((row, i) => ({
              ...row,
              current_size: badCounterparty && i === 0 ? 0 : row.size,
              realized_pnl: 0,
              unrealized_pnl: decimal(
                (row.token_id === 'up' ? units(row.size) : 0n) - units(row.size) / 2n,
              ),
              total_pnl: decimal(
                (row.token_id === 'up' ? units(row.size) : 0n) - units(row.size) / 2n,
              ),
              entry_fees_usdc: 0,
            }))
          : []
      else throw new Error(`Unexpected endpoint ${url.pathname}`)
      return Response.json({ data, pagination: { next_cursor: null } })
    }) as typeof fetch,
  })
  return { client, repeats: () => repeatRequests }
}

const lowerVolumeBurst = [
  ...Array.from({ length: 5 }, (_, i) =>
    [0, 1].map((side) => ({
      ...trades[side]!,
      proxy_wallet: wallet(i * 2 + side + 1),
      size: '5.882351',
      timestamp: start - 100 + (i % 2),
      transaction_hash: `opening-${i}`,
    })),
  ).flat(),
  ...trades.slice(2).map((row, i) => ({
    ...row,
    size: '26065.057158',
    proxy_wallet: wallet(11 + i),
  })),
]

// August 8: two early fills 177 seconds apart, followed by hours without trades.
const spacedOpening = [
  ...[0, 177].flatMap((offset, i) =>
    trades.slice(0, 2).map((row, side) => ({
      ...row,
      proxy_wallet: wallet(i * 2 + side + 1),
      size: '3.921567',
      timestamp: start - 85_000 + offset,
      transaction_hash: `spaced-${i}`,
    })),
  ),
  ...trades.slice(2).map((row, i) => ({ ...row, proxy_wallet: wallet(5 + i) })),
]

test('minute-separated opening fills require the full bounded burst and a later gap', () => {
  assert.equal(volumeCandidate(market, spacedOpening, units('30000')).difference, '7.843134')
  assert.throws(() => volumeCandidate(market, spacedOpening, units('30003.921567')), /mismatch/)
  const outside = structuredClone(spacedOpening)
  for (const row of outside.filter((r) => r.transaction_hash === 'spaced-1'))
    row.timestamp = start - 85_000 + 301
  assert.throws(() => volumeCandidate(market, outside, units('30000')), /mismatch/)
  const continuous = structuredClone(spacedOpening)
  for (const row of continuous.filter((r) => r.transaction_hash === 'later'))
    row.timestamp = start - 85_000 + 220
  assert.throws(() => volumeCandidate(market, continuous, units('30000')), /mismatch/)
})

for (const [openingFills, sourceTrades, sourceVolume, expectedWallets] of [
  [1, trades, '30000', 4],
  [15, openingBurst(), '30000', 33],
  // June 30's five fills are 0.113% of volume, yet its full ledger reconciles.
  [5, lowerVolumeBurst, '26065.057158', 12],
  [2, spacedOpening, '30000', 6],
] as const) {
  test(`corroborated ${openingFills}-fill volume warnings survive Parquet, offline verification and rebuild without excluding reconciled wallets`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'research-volume-'))
    const { client, repeats } = fixture(false, false, sourceTrades, sourceVolume)
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
      assert.equal(saved!.complete_wallet_markets, expectedWallets)
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
      assert.equal(ranking.rows.length, expectedWallets)
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
}

test('changed repeat feeds cannot publish even as an unresolved aggregate', async () => {
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
        client: fixture(true, false, lowerVolumeBurst, '26065.057158').client,
        log: () => {},
      }),
      /corroboration/,
    )
    assert.equal(await readJson(path.join(root, 'index.json')), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

for (const badCounterparty of [false, true]) {
  test(`unresolved aggregate preserves evidence, excludes whole wallets and permits later days (counterparty gap=${badCounterparty})`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'research-volume-unresolved-'))
    const sourceTrades = [
      ...trades,
      ...trades.slice(0, 2).map((row, i) => ({
        ...row,
        condition_id: conditions[1]!,
        proxy_wallet: i === 0 ? wallet(1) : wallet(9),
        size: '10',
        timestamp: start + 900,
        transaction_hash: 'unaffected-market',
      })),
    ]
    const options = {
      root,
      from: '2026-06-01',
      to: '2026-06-03',
      concurrency: 4,
      requestsPerSecond: 12,
      minFreeGiB: 1,
      log: () => {},
      client: fixture(false, badCounterparty, sourceTrades, badCounterparty ? '30000' : '30001')
        .client,
    }
    try {
      const saved = await syncDataset(options)
      assert.equal(saved.length, 2)
      assert.equal(saved[0]!.source_warnings?.[0]?.code, UNRESOLVED_VOLUME)
      assert.equal(saved[1]!.source_warnings?.length, 0)
      // Older unflagged generations omitted this column entirely.
      const legacyMarketFile = path.join(root, saved[1]!.directory, 'markets.parquet')
      const legacyDb = await createResearchDatabase()
      try {
        await legacyDb.connection.run(
          `COPY (SELECT * EXCLUDE(source_warnings) FROM read_parquet(${sqlQuote(legacyMarketFile)})) TO ${sqlQuote(legacyMarketFile + '.legacy')} (FORMAT PARQUET)`,
        )
      } finally {
        legacyDb.close()
      }
      await rename(legacyMarketFile + '.legacy', legacyMarketFile)
      const legacyReportFile = path.join(root, saved[1]!.report)
      const legacyReport = (await readJson<ApiRow>(legacyReportFile))!
      ;(legacyReport.files as ApiRow)['markets.parquet'] = await fileDigest(legacyMarketFile)
      await writeJson(legacyReportFile, legacyReport)
      const rows = (await querySql(
        root,
        `SELECT wallet, condition_id, quality, issues FROM wallet_markets ORDER BY condition_id,wallet`,
      )) as { wallet: string; condition_id: string; quality: string; issues: string[] }[]
      const flagged = rows.filter((row) => row.condition_id === conditions[0])
      assert.equal(flagged.length, 4)
      assert.ok(
        flagged.every(
          (row) => row.quality === 'unresolved' && row.issues.includes(UNRESOLVED_VOLUME),
        ),
      )
      // Wallet 1 has a separate complete market, but its entire cohort is excluded.
      if (!badCounterparty)
        assert.equal(
          rows.find((row) => row.wallet === wallet(1) && row.condition_id === conditions[1])
            ?.quality,
          'complete',
        )
      const ranking = (await leaderboard(root, options.from, options.to)) as {
        rows: { wallet: string }[]
      }
      assert.deepEqual(
        ranking.rows.map((row) => row.wallet),
        [wallet(9)],
      )
      const verification = await verifyDataset(root, options.from, options.to)
      assert.equal(verification.valid, true, JSON.stringify(verification))
      assert.equal(verification.all_source_aggregates_reconciled, false)
      assert.equal(verification.all_wallet_accounting_complete, false)
      const [rebuilt] = await rebuildDataset(root, options.from, '2026-06-02', 1)
      assert.equal(rebuilt!.unresolved_wallet_markets, saved[0]!.unresolved_wallet_markets)
      for (const file of ['trades.parquet', 'activities.parquet', 'positions.parquet'])
        assert.deepEqual(
          await fileDigest(path.join(root, saved[0]!.directory, file)),
          await fileDigest(path.join(root, rebuilt!.directory, file)),
        )
      await rebuildDataset(root, '2026-06-02', options.to, 1)
      assert.equal((await verifyDataset(root, options.from, options.to)).valid, true)
      const proofFile = path.join(root, rebuilt!.directory, 'volume-evidence.json')
      const proof = (await readJson<Record<string, VolumeEvidence>>(proofFile))!
      proof[conditions[0]!]!.taker_trades.pop()
      await writeJson(proofFile, proof)
      const reportFile = path.join(root, rebuilt!.report)
      const report = (await readJson<ApiRow>(reportFile))!
      ;(report.files as ApiRow)['volume-evidence.json'] = await fileDigest(proofFile)
      await writeJson(reportFile, report)
      assert.equal((await verifyDataset(root, options.from, options.to)).valid, false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}
