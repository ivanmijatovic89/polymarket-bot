import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import mysql from 'mysql2/promise'
import { closeDb } from '../../db/index.js'
import {
  MysqlRecorderCatalog,
  queryCatalogRecordings,
  readCatalogStatus,
} from '../../db/recorderV4Catalog.js'
import { discoverCapturePackages, inspectCapturePackage } from '../replay/selection.js'
import { recording, resolved, scope } from './fixtures.js'
import type { CatalogSyncStatus } from './types.js'

// Opt-in real MySQL test. Never run DDL against an application database.
test(
  'MySQL migration, JSON roundtrip, transactional updates, discovery and stale-catalog guard',
  {
    skip: process.env.CATALOG_TEST_MYSQL !== '1',
  },
  async (t) => {
    const database = process.env.DATABASE_NAME ?? ''
    assert.match(database, /^recorder_v4_catalog_test(?:_[a-z0-9]+)?$/)
    const connection = await mysql.createConnection({
      host: process.env.DATABASE_HOST ?? '127.0.0.1',
      port: Number(process.env.DATABASE_PORT ?? 3306),
      user: process.env.DATABASE_USERNAME ?? 'root',
      password: process.env.DATABASE_PASSWORD ?? '',
      database,
    })
    t.after(async () => {
      await closeDb()
      await connection.execute('DROP TABLE IF EXISTS recorder_v4_recordings')
      await connection.execute('DROP TABLE IF EXISTS recorder_v4_catalog_syncs')
      await connection.end()
    })
    const [tables] = await connection.query('SHOW TABLES')
    assert.deepEqual(tables, [], 'integration database must be empty')
    const migration = await readFile(
      new URL('../../../drizzle/0040_recorder_v4_mysql_catalog.sql', import.meta.url),
      'utf8',
    )
    for (const statement of migration.split('--> statement-breakpoint'))
      if (statement.trim()) await connection.execute(statement)
    const repository = new MysqlRecorderCatalog()
    const r = recording()
    await assert.rejects(queryCatalogRecordings(scope), /not initialized/)
    await Promise.all([repository.put(r), repository.put(r)])
    assert.equal((await repository.listKnown(scope)).length, 1)
    const row = (await repository.get(r.id))!
    assert.deepEqual(row.manifest, r.manifest)
    assert.deepEqual(row.referenceEvidence, r.referenceEvidence)
    await repository.put({
      ...r,
      latestResolution: resolved(r),
      resolutionKeysSha256: 'a'.repeat(64),
    })
    await repository.put(r) // An older concurrent retry cannot regress resolution.
    assert.equal((await repository.get(r.id))!.latestResolution?.status, 'resolved')
    await repository.put((await repository.get(r.id))!) // JSON key ordering changes in MySQL are harmless.
    await assert.rejects(
      repository.put({ ...r, referenceEvidence: { websiteObserved: false, openingReasons: [] } }),
      /conflicts/,
    )
    const status: CatalogSyncStatus = {
      ...scope,
      startedAtMs: Date.now(),
      finishedAtMs: Date.now(),
      fullScan: true,
      discovered: 1,
      indexed: 1,
      refreshed: 0,
      remaining: 1,
      failures: [],
    }
    await repository.saveStatus(status)
    await assert.rejects(queryCatalogRecordings(scope), /not initialized/)
    await repository.saveStatus({ ...status, remaining: 0 })
    assert.ok((await readCatalogStatus(scope))?.initializedAtMs)
    assert.equal((await queryCatalogRecordings(scope, { timeframe: '15m' })).length, 0)
    assert.equal(
      (await queryCatalogRecordings(scope, { excludeSlugs: [r.manifest.market.slug] })).length,
      0,
    )
    // No R2 credentials are set: discovery + admission must use MySQL only.
    const packages = await discoverCapturePackages({ kind: 'r2', ...scope }, { timeframe: '5m' })
    assert.equal(packages.length, 1)
    assert.equal(packages[0]!.manifestUrl, `r2://${scope.bucket}/${r.manifestKey}`)
    assert.deepEqual(
      await inspectCapturePackage(packages[0]!, { polymarketPriceToBeat: { enabled: true } }),
      [],
    )
    assert.equal(packages[0]!.marketResolution.outcome, 'UP')
    await connection.execute('UPDATE recorder_v4_catalog_syncs SET last_completed_at_ms = 1')
    await assert.rejects(queryCatalogRecordings(scope), /stale/)
  },
)
