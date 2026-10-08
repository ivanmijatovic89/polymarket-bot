import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { main } from '../cli/research-data.js'
import { assertDatasetRoot, datasetFamily, ensureDatasetFamily, marketFamily } from './family.js'
import { writeJson } from './files.js'
import { prepareUpdateConfig } from './installation.js'
import { createResearchDatabase } from './database.js'
import { querySql } from './query.js'
import { writeParquet, loadIndex, TABLES, type DatasetIndex } from './storage.js'

test('collection parents fail visibly without initializing data or reporting an empty dataset', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'research-collection-'))
  try {
    await writeJson(path.join(root, 'collection.json'), { version: 1, layout: 'symbol/timeframe' })
    for (const operation of [
      () => assertDatasetRoot(root),
      () => datasetFamily(root),
      () => ensureDatasetFamily(root),
      () => main(['status', '--root', root]),
      () => main(['sync', '--root', root, '--from', '2026-06-01', '--to', '2026-06-02']),
      () =>
        prepareUpdateConfig(path.join(root, 'runtime'), {
          root,
          from: '2026-06-01',
          market: 'btc:15m',
        }),
    ])
      await assert.rejects(operation, /Research collection root:.*btc[/\\]15m/)
    for (const name of ['dataset.json', 'index.json', 'sync.lock', 'runtime'])
      await assert.rejects(stat(path.join(root, name)), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('moving a dataset below symbol/timeframe preserves relative indexes and exact Parquet queries', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'research-layout-'))
  const oldRoot = path.join(parent, 'legacy')
  const collection = path.join(parent, 'collection')
  const newRoot = path.join(collection, 'btc', '15m')
  const directory = 'snapshots/2026-06-01/00000000-0000-0000-0000-000000000001'
  try {
    await ensureDatasetFamily(oldRoot)
    const database = await createResearchDatabase()
    try {
      for (const table of TABLES)
        await writeParquet(
          database.connection,
          table,
          table === 'wallet_markets'
            ? [
                {
                  wallet: '0xabc',
                  condition_id: 'condition',
                  slug: 'btc-updown-15m-1780272000',
                  market_start: 1780272000,
                  trade_count: 2,
                  economic_pnl_usdc: '1.234567',
                  quality: 'unresolved',
                },
              ]
            : [],
          path.join(oldRoot, directory),
        )
    } finally {
      database.close()
    }
    const index: DatasetIndex = {
      version: 1,
      days: {
        '2026-06-01': {
          date: '2026-06-01',
          directory,
          generation: path.basename(directory),
          as_of: '2026-10-01T00:00:00Z',
          missing_markets: [],
          complete_wallet_markets: 0,
          unresolved_wallet_markets: 1,
          pending_wallet_markets: 0,
          parquet_bytes: 0,
          report: `${directory}/report.json`,
        },
      },
    }
    await writeJson(path.join(oldRoot, 'index.json'), index)
    const query = 'SELECT wallet, economic_pnl_usdc FROM wallet_markets ORDER BY wallet'
    const before = await querySql(oldRoot, query)
    const parquet = path.join(directory, 'wallet_markets.parquet')
    const bytes = await readFile(path.join(oldRoot, parquet))
    const inode = (await stat(path.join(oldRoot, parquet))).ino
    await mkdir(path.dirname(newRoot), { recursive: true })
    await rename(oldRoot, newRoot)
    await writeJson(path.join(collection, 'collection.json'), {
      version: 1,
      layout: 'symbol/timeframe',
    })
    assert.equal((await datasetFamily(newRoot)).id, 'btc:15m')
    assert.deepEqual(await loadIndex(newRoot), index)
    assert.deepEqual(await querySql(newRoot, query), before)
    assert.deepEqual(await readFile(path.join(newRoot, parquet)), bytes)
    assert.equal((await stat(path.join(newRoot, parquet))).ino, inode)
    for (const family of ['btc:5m', 'eth:5m', 'eth:15m'])
      assert.throws(() => marketFamily(family), /not enabled/)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})
