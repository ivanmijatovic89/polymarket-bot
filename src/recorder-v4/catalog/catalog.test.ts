import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { syncRecorderCatalog, catalogScanPrefixes } from './sync.js'
import { catalogKeyIdentity, validateCatalogRecording, resolutionKeysHash } from './identity.js'
import { catalogCapturePackage } from './packages.js'
import { inspectCapturePackage, selectEligibleCapturePackages } from '../replay/selection.js'
import { inspectRecorderV4Metadata } from '../replay/catalogMetadata.js'
import { catalogRow, mergeCatalogRecording } from '../../db/recorderV4Catalog.js'
import { parseCatalogSyncArgs } from './config.js'
import {
  MemoryArchive,
  MemoryCatalog,
  scope,
  recording,
  resolved,
  publish,
  publishResolution,
} from './fixtures.js'

async function temporary(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'v4-catalog-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
test('imports verified packages once, cleans temporary downloads, updates resolution without downloading events again', async (t) => {
  const root = await temporary(t),
    temporaryRoot = path.join(root, 'downloads')
  const store = new MemoryArchive(),
    repository = new MemoryCatalog()
  const r = await publish(store, root)
  const objects = new Map(store.objects)
  const options = { store, repository, scope, fullScan: true, temporaryRoot }
  assert.equal((await syncRecorderCatalog(options)).indexed, 1)
  assert.deepEqual(await readdir(temporaryRoot), [])
  const indexed = (await repository.get(r.id))!
  assert.equal(indexed.referenceEvidence.websiteObserved, true)
  assert.ok(indexed.referenceEvidence.openingReasons.length)
  assert.deepEqual(store.objects, objects)
  store.gets = []
  assert.equal((await syncRecorderCatalog(options)).indexed, 0)
  assert.deepEqual(store.gets, [])
  const key = publishResolution(store, r, resolved(r))
  assert.equal((await syncRecorderCatalog(options)).refreshed, 1)
  assert.deepEqual(store.gets, [key])
  assert.equal(catalogCapturePackage((await repository.get(r.id))!).marketResolution.outcome, 'UP')
})
test('corrupt event bytes never enter MySQL; failures are retryable and leave no event files', async (t) => {
  const root = await temporary(t),
    temporaryRoot = path.join(root, 'downloads')
  const store = new MemoryArchive(),
    repository = new MemoryCatalog()
  const r = await publish(store, root)
  const original = store.objects.get(r.manifest.events.key)!
  store.objects.set(r.manifest.events.key, Buffer.from('corrupt'))
  const options = { store, repository, scope, fullScan: true, temporaryRoot }
  assert.equal((await syncRecorderCatalog(options)).failures.length, 1)
  assert.equal(repository.rows.size, 0)
  assert.deepEqual(await readdir(temporaryRoot), [])
  store.objects.set(r.manifest.events.key, original)
  assert.equal((await syncRecorderCatalog(options)).indexed, 1)
})
test('database failure before a scan makes no R2 requests; failed row writes are retried', async (t) => {
  const root = await temporary(t),
    store = new MemoryArchive(),
    repository = new MemoryCatalog()
  await publish(store, root)
  const save = repository.saveStatus.bind(repository)
  repository.saveStatus = async () => {
    throw new Error('database unavailable')
  }
  const options = {
    store,
    repository,
    scope,
    fullScan: true,
    temporaryRoot: path.join(root, 'downloads'),
  }
  await assert.rejects(syncRecorderCatalog(options), /database unavailable/)
  assert.deepEqual(store.gets, [])
  assert.deepEqual(store.lists, [])
  repository.saveStatus = save
  const put = repository.put.bind(repository)
  repository.put = async () => {
    throw new Error('database unavailable')
  }
  assert.equal((await syncRecorderCatalog(options)).failures.length, 1)
  assert.deepEqual(await readdir(options.temporaryRoot), [])
  repository.put = put
  assert.equal((await syncRecorderCatalog(options)).indexed, 1)
})
test('bounded passes resume without re-downloading imported objects and exclude validation namespaces', async (t) => {
  const root = await temporary(t),
    store = new MemoryArchive(),
    repository = new MemoryCatalog()
  const r = await publish(store, root)
  await publish(store, root, r.manifest.market.startMs + 300_000, 'second')
  store.objects.set(
    `recorder-v4/validation/${r.manifestKey.slice('recorder-v4/'.length)}`,
    Buffer.from('{}'),
  )
  const options = {
    store,
    repository,
    scope,
    fullScan: true,
    maxFiles: 1,
    temporaryRoot: path.join(root, 'downloads'),
  }
  const first = await syncRecorderCatalog(options)
  assert.equal(first.discovered, 2)
  assert.equal(first.remaining, 1)
  const next = await syncRecorderCatalog(options)
  assert.equal(next.indexed, 1)
  assert.equal(next.remaining, 0)
  assert.equal(repository.rows.size, 2)
})
test('MySQL admission uses verified metadata without opening the missing event path or contacting R2', async () => {
  const r = recording()
  r.latestResolution = resolved(r)
  const pkg = catalogCapturePackage(r)
  const config = { polymarketPriceToBeat: { enabled: true } }
  assert.deepEqual(await inspectCapturePackage(pkg, config), [])
  assert.equal((await inspectRecorderV4Metadata([pkg], config)).summary.eligible, 1)
  const selected = await selectEligibleCapturePackages({
    packages: [pkg, catalogCapturePackage({ ...r })],
    requiredFeeds: config,
  })
  assert.equal(selected.summary.eligible, 0)
  assert.equal(selected.summary.exclusions.ambiguous_recording, 2)
  pkg.catalogEvidence!.manifestSha256 = '0'.repeat(64)
  await assert.rejects(inspectCapturePackage(pkg, config), /does not match/)
})
test('database facts distinguish website PTB, opening TWAP, gaps and outcome without modifying market metadata', async () => {
  const r = recording()
  r.referenceEvidence = { websiteObserved: false, openingReasons: [] }
  r.latestResolution = resolved(r)
  const row = catalogRow(r)
  assert.equal(row.websitePtbObserved, false)
  assert.equal(row.openingTwapAvailable, true)
  assert.equal(row.outcome, 'UP')
  const pkg = catalogCapturePackage(r)
  assert.ok(
    (await inspectCapturePackage(pkg, { polymarketPriceToBeat: { enabled: true } })).some((x) =>
      x.startsWith('price_to_beat:'),
    ),
  )
  assert.deepEqual(
    await inspectCapturePackage(pkg, {
      polymarketPriceToBeat: { enabled: true, source: 'chainlink-opening-twap' },
    }),
    [],
  )
  assert.equal('priceToBeat' in pkg.marketMeta, false)
  assert.equal('finalPrice' in pkg.marketMeta, false)
})
test('immutable row checks and monotonic resolution updates tolerate MySQL JSON key order', () => {
  const r = recording(),
    incoming = structuredClone(r)
  incoming.latestResolution = resolved(r)
  const saved = mergeCatalogRecording(r, incoming)
  assert.equal(mergeCatalogRecording(saved, r), saved)
  const reversed = {
    ...saved,
    latestResolution: Object.fromEntries(
      Object.entries(saved.latestResolution!).reverse(),
    ) as typeof saved.latestResolution,
  }
  assert.deepEqual(mergeCatalogRecording(saved, reversed), reversed)
  assert.throws(
    () => mergeCatalogRecording(saved, { ...saved, manifestSha256: '0'.repeat(64) }),
    /Immutable/,
  )
  assert.throws(
    () => validateCatalogRecording({ ...saved, manifestSha256: '0'.repeat(64) }),
    /checksum/,
  )
  assert.throws(() => validateCatalogRecording({ ...saved, bucket: 'different' }), /identity/)
  assert.equal(resolutionKeysHash(['b', 'a']), resolutionKeysHash(['a', 'b']))
})
test('scan scopes and CLI arguments are bounded and explicit', () => {
  const r = recording()
  assert.equal(catalogKeyIdentity(r.manifestKey, scope.prefix)?.kind, 'manifest')
  assert.equal(catalogKeyIdentity('recorder-v4-validation/' + r.manifestKey, scope.prefix), null)
  const prefixes = catalogScanPrefixes(scope, false, r.manifest.market.startMs)
  assert.ok(prefixes.length < 15)
  assert.ok(
    prefixes.every((prefix) => prefix.startsWith('recorder-v4/btc/') && prefix.endsWith('/')),
  )
  assert.equal(parseCatalogSyncArgs(['sync', '--watch']).watch, true)
  assert.throws(() => parseCatalogSyncArgs(['status', '--watch']), /requires sync/)
  assert.throws(() => parseCatalogSyncArgs(['sync', '--max-files', '-1']), /Invalid/)
})
