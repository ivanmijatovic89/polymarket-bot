import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { dates, parseDate } from './catalog.js'
import { leaderboard, querySql, walletReport } from './query.js'
import { openDataset, publish, TABLES, writeParquet, type TableName } from './storage.js'
import type { WalletMarket } from './types.js'

const steady = `0x${'a'.repeat(40)}`
const incomplete = `0x${'b'.repeat(40)}`
const late = `0x${'c'.repeat(40)}`
const condition = (start: number) => `0x${start.toString(16).padStart(64, '0')}`

interface Sample {
  day: string
  wallet: string
  pnl: string
  incomplete?: boolean
  window?: number
}
const samples: Sample[] = [
  { day: '2026-06-01', wallet: steady, pnl: '10' },
  { day: '2026-06-02', wallet: steady, pnl: '-3' },
  { day: '2026-06-01', wallet: incomplete, pnl: '100' },
  { day: '2026-06-02', wallet: incomplete, pnl: '-500', incomplete: true },
  { day: '2026-06-30', wallet: late, pnl: '2', window: 95 },
  { day: '2026-07-01', wallet: steady, pnl: '4' },
  { day: '2026-07-31', wallet: steady, pnl: '1' },
  { day: '2026-07-01', wallet: incomplete, pnl: '8' },
]

test('monthly research requires the whole calendar and excludes the entire incomplete wallet cohort', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'research-months-'))
  const writer = await openDataset(root)
  // Synthetic Parquet isolates query rules from ingestion/accounting, which
  // have separate integration tests. No source API is involved in this fixture.
  const seedDay = async (day: string, found = 96) => {
    const generation = `windows-${found}`
    const directory = path.join('snapshots', day, generation)
    const start = parseDate(day)
    const selected = samples.filter((sample) => sample.day === day)
    const walletRows: WalletMarket[] = selected.map((sample) => {
      const marketStart = start + (sample.window ?? 0) * 900
      const issues = sample.incomplete ? ['api_pnl_unreconciled'] : []
      return {
        wallet: sample.wallet,
        condition_id: condition(marketStart),
        slug: `btc-updown-15m-${marketStart}`,
        market_start: marketStart,
        trade_count: 1,
        activity_count: sample.wallet === late ? 2 : 1,
        buy_usdc:
          sample.wallet === late ? '1' : sample.pnl.startsWith('-') ? sample.pnl.slice(1) : '0',
        sell_usdc: sample.wallet === late || sample.pnl.startsWith('-') ? '0' : sample.pnl,
        split_usdc: '0',
        merge_usdc: '0',
        redeem_usdc: sample.wallet === late ? '3' : '0',
        cash_pnl_usdc: sample.pnl,
        unredeemed_value_usdc: '0',
        economic_pnl_usdc: sample.pnl,
        rewards_usdc: '0',
        pnl_with_rewards_usdc: sample.pnl,
        api_position_pnl_usdc: sample.incomplete ? '0' : sample.pnl,
        api_pnl_difference_usdc: sample.incomplete ? sample.pnl : '0',
        modeled_api_pnl_usdc: null,
        api_pnl_status: sample.incomplete ? 'different' : 'match',
        quality: sample.incomplete ? 'unresolved' : 'complete',
        issues,
        notes: [],
      }
    })
    const markets = Array.from({ length: found }, (_, window) => {
      const marketStart = start + window * 900
      return {
        slug: `btc-updown-15m-${marketStart}`,
        condition_id: condition(marketStart),
        event_id: String(marketStart),
        symbol: 'btc',
        timeframe: '15m',
        market_start: marketStart,
        market_end: marketStart + 900,
        token_ids: ['up', 'down'],
        outcomes: ['Up', 'Down'],
        payouts: ['1000000', '0'],
        resolved: true,
        raw_json: '{}',
        resolution_json: '{}',
      }
    })
    const coverage = Array.from({ length: 96 }, (_, window) => {
      const marketStart = start + window * 900
      const pairs = walletRows.filter((row) => row.market_start === marketStart)
      return {
        slug: `btc-updown-15m-${marketStart}`,
        condition_id: window < found ? condition(marketStart) : null,
        market_start: marketStart,
        found: window < found,
        trade_count: pairs.length,
        wallet_count: pairs.length,
        complete_wallets: pairs.filter((row) => row.quality === 'complete').length,
        unresolved_wallets: pairs.filter((row) => row.quality === 'unresolved').length,
        pending_wallets: 0,
      }
    })
    const lateRow = walletRows.find((row) => row.wallet === late)
    const activities = lateRow
      ? [
          { type: 'TRADE', side: 'BUY', timestamp: lateRow.market_start - 60, usdc_size: '1' },
          { type: 'REDEEM', side: '', timestamp: parseDate('2026-07-02'), usdc_size: '3' },
        ].map((row, row_index) => ({
          ...row,
          row_index,
          proxy_wallet: late,
          condition_id: lateRow.condition_id,
          token_id: 'up',
          transaction_hash: `fixture-${row_index}`,
          size: '3',
          price: row.type === 'TRADE' ? '0.333333333333333333' : '1',
          raw_json: '{}',
        }))
      : []
    const tables: Record<TableName, unknown[]> = {
      markets,
      coverage,
      wallet_markets: walletRows,
      activities,
      trades: [],
      positions: [],
    }
    let bytes = 0
    for (const table of TABLES)
      bytes += await writeParquet(
        writer.connection,
        table,
        tables[table],
        path.join(root, directory),
      )
    await publish(root, {
      date: day,
      directory,
      generation,
      as_of: '2026-10-04T00:00:00.000Z',
      missing_markets: coverage.filter((row) => !row.found).map((row) => row.slug),
      complete_wallet_markets: walletRows.filter((row) => row.quality === 'complete').length,
      unresolved_wallet_markets: walletRows.filter((row) => row.quality === 'unresolved').length,
      pending_wallet_markets: 0,
      parquet_bytes: bytes,
      report: path.join(directory, 'report.json'),
    })
  }
  const months = async () =>
    (await querySql(
      root,
      'SELECT wallet, month, cohort_complete, incomplete_markets, economic_pnl_usdc FROM wallet_months ORDER BY month, wallet',
    )) as {
      wallet: string
      month: string
      cohort_complete: boolean
      incomplete_markets: string
      economic_pnl_usdc: string | null
    }[]
  const ranking = async (from: string, to: string) =>
    (await leaderboard(root, from, to)) as {
      coverage: { excluded_wallets: string }
      rows: { wallet: string; economic_pnl_usdc: string }[]
    }
  try {
    for (const day of dates('2026-06-01', '2026-07-31')) await seedDay(day)
    const partial = await months()
    assert.equal(
      partial.find((row) => row.wallet === steady && row.month === '2026-06')!.economic_pnl_usdc,
      '7.000000',
    )
    assert.equal(
      partial.find((row) => row.wallet === incomplete && row.month === '2026-06')!
        .economic_pnl_usdc,
      null,
    )
    assert.ok(
      partial
        .filter((row) => row.month === '2026-07')
        .every((row) => !row.cohort_complete && row.economic_pnl_usdc === null),
    )
    await assert.rejects(ranking('2026-07-01', '2026-08-01'), /Missing days: 2026-07-31/)

    await seedDay('2026-07-31', 95)
    assert.ok(
      (await months())
        .filter((row) => row.month === '2026-07')
        .every((row) => !row.cohort_complete && row.economic_pnl_usdc === null),
    )
    await assert.rejects(ranking('2026-07-01', '2026-08-01'), /missing market windows: 1/)

    await seedDay('2026-07-31')
    const complete = await months()
    assert.ok(complete.every((row) => row.cohort_complete))
    assert.equal(
      complete.find((row) => row.wallet === steady && row.month === '2026-07')!.economic_pnl_usdc,
      '5.000000',
    )
    const june = await ranking('2026-06-01', '2026-07-01')
    assert.deepEqual(
      june.rows.map((row) => [row.wallet, row.economic_pnl_usdc]),
      [
        [steady, '7.000000'],
        [late, '2.000000'],
      ],
    )
    assert.equal(
      june.coverage.excluded_wallets,
      '1',
      'do not rank the incomplete wallet using only its +100 market',
    )
    const july = await ranking('2026-07-01', '2026-08-01')
    assert.deepEqual(
      july.rows.map((row) => [row.wallet, row.economic_pnl_usdc]),
      [
        [incomplete, '8.000000'],
        [steady, '5.000000'],
      ],
    )
    const both = await ranking('2026-06-01', '2026-08-01')
    assert.deepEqual(
      both.rows.map((row) => [row.wallet, row.economic_pnl_usdc]),
      [
        [steady, '12.000000'],
        [late, '2.000000'],
      ],
    )
    const report = (await walletReport(root, late, '2026-06-01', '2026-07-01')) as {
      activities: { type: string; timestamp: string }[]
    }
    assert.deepEqual(
      report.activities.map((row) => row.type),
      ['TRADE', 'REDEEM'],
    )
    assert.equal(
      Number(report.activities[1]!.timestamp),
      parseDate('2026-07-02'),
      'a later redemption belongs to its June market cohort',
    )
  } finally {
    writer.close()
    await rm(root, { recursive: true, force: true })
  }
})
