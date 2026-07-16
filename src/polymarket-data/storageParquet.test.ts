import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'

test('Parquet facts replace atomically, preserve decimals, and dedupe activity overlap', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'polymarket-facts-'))
  process.env.POLYMARKET_DATA_STORAGE_DIR = root
  const facts = await import('./storage/parquetFacts.js')
  const paths = await import('./storage/paths.js')
  const migration = await import('./storage/migrateLayout.js')
  const wallet = '0x1111111111111111111111111111111111111111'
  const market = {
    id: 7,
    slug: 'btc-updown-15m-1780272000',
    symbol: 'btc',
    timeframe: '15m',
    marketStartMs: 1_780_272_000_000,
  }

  try {
    await facts.writeMarketTrades(market, [
      {
        wallet,
        side: 'BUY',
        outcomeIndex: 0,
        asset: 'yes',
        size: 12.345678,
        price: 0.456789,
        usdcSize: 5.639361,
        isTaker: true,
        tsMs: 1_780_272_000_000,
        txHash: '0xone',
      },
      {
        wallet,
        side: 'SELL',
        outcomeIndex: 1,
        asset: 'no',
        size: 1,
        price: 0.5,
        usdcSize: 0.5,
        isTaker: false,
        tsMs: 1_780_272_001_000,
        txHash: '0xtwo',
      },
    ])
    await facts.writeMarketTrades(market, [
      {
        wallet,
        side: 'BUY',
        outcomeIndex: 0,
        asset: 'yes',
        size: 12.345678,
        price: 0.456789,
        usdcSize: 5.639361,
        isTaker: true,
        tsMs: 1_780_272_000_000,
        txHash: '0xone',
      },
    ])
    await facts.writeMarketPositions(market, [
      {
        proxyWallet: wallet,
        asset: 'yes',
        conditionId: 'condition',
        outcomeIndex: 0,
        size: 12.345678,
        avgPrice: 0.456789,
        totalBought: 12.345678,
        realizedPnl: 1.234567,
        cashPnl: 1.234567,
      },
    ])
    const firstActivity = {
      marketId: 7,
      key: 'key-1',
      row: {
        proxyWallet: wallet,
        type: 'REDEEM',
        timestamp: 1_780_272_000,
        conditionId: 'condition',
        size: 2,
        usdcSize: 2,
      },
    }
    await facts.writeWalletActivity(wallet, [firstActivity])
    await facts.writeWalletActivity(wallet, [
      firstActivity,
      {
        ...firstActivity,
        key: 'key-2',
        row: { ...firstActivity.row, timestamp: 1_780_272_001, type: 'MERGE' },
      },
    ])

    const aggregate = (await facts.tradeAggregates()).get(7)
    assert.deepEqual(aggregate, { marketId: 7, rows: 1, wallets: 1, sharesVolume: 6.172839 })
    assert.deepEqual(await facts.marketParticipants(market), [wallet])
    const verification = await facts.marketVerification(market)
    assert.equal(verification.tradeRows, 1)
    assert.equal(verification.positions.length, 1)
    assert.equal(verification.orphanWallets, 0)
    assert.equal(
      paths.marketFactPath('trades', market),
      path.join(
        root,
        'staging/trades/symbol=btc/timeframe=15m/month=2026-06',
        `${market.slug}.parquet`,
      ),
    )
    assert.throws(
      () => paths.marketFactPath('trades', { ...market, slug: '../escape' }),
      /Invalid market slug/,
    )

    const stagedTrade = paths.marketFactPath('trades', market)
    const stagedPosition = paths.marketFactPath('positions', market)
    const legacyTrade = paths.legacyMarketFactPath('trades', market.id, root)
    const legacyPosition = paths.legacyMarketFactPath('positions', market.id, root)
    await mkdir(path.dirname(legacyTrade), { recursive: true })
    await mkdir(path.dirname(legacyPosition), { recursive: true })
    await rename(stagedTrade, legacyTrade)
    await rename(stagedPosition, legacyPosition)
    assert.deepEqual(await migration.migrateLegacyMarketFacts([market], root), {
      trades: 1,
      positions: 1,
    })
    await access(stagedTrade)
    await access(stagedPosition)
    await assert.rejects(access(legacyTrade), { code: 'ENOENT' })
    assert.deepEqual(await migration.migrateLegacyMarketFacts([market], root), {
      trades: 0,
      positions: 0,
    })
    assert.equal((await facts.marketVerification(market)).tradeRows, 1)

    const instance = await DuckDBInstance.create(':memory:')
    const connection = await instance.connect()
    try {
      const activityPath = paths.walletActivityPath(wallet).replaceAll("'", "''")
      const result = await connection.runAndReadAll(
        `SELECT count(*)::INTEGER AS n FROM read_parquet('${activityPath}')`,
      )
      assert.equal(result.getRowObjectsJS()[0]?.n, 2)
    } finally {
      connection.closeSync()
      instance.closeSync()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
