import { setTimeout as sleep } from 'node:timers/promises'
import { loadCatalogDatabaseEnv, parseCatalogSyncArgs } from '../recorder-v4/catalog/config.js'
import { syncRecorderCatalog } from '../recorder-v4/catalog/sync.js'
import { catalogScopeId } from '../recorder-v4/catalog/identity.js'
import { loadCatalogConfig, parseCatalogArgs } from '../recorder-v4/storage/catalog.js'
import { R2BlobStore } from '../recorder-v4/storage/blobStore.js'
import { RecorderCliError } from '../recorder-v4/cliError.js'
import { CatalogProcessGuard } from '../recorder-v4/catalog/processGuard.js'
import type { CatalogRepository } from '../recorder-v4/catalog/types.js'

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help')) {
    console.log(`Recorder V4 MySQL catalog (R2 LIST/GET only; never changes capture).
Usage: npm run record:v4:catalog -- sync|status [options]
  --env-file FILE          Database + R2 configuration (default .env)
  --prefix PREFIX          Exact archive namespace (default RECORDER_R2_PREFIX or recorder-v4)
  --watch                  Continuous sync; retry failed imports after database/network recovery
  --max-files N            Bound imports/refreshes per pass (default 100)
  --interval-seconds N     Recent scan cadence, 30–300 seconds (default 60)
A full scan runs on startup and hourly. Recent scans cover the last 30 minutes.
One-shot sync performs a bounded full pass; a nonzero exit means incomplete or failed work.
Temporary verified event downloads are removed after indexing. No R2 objects are changed.`)
    return
  }
  const args = parseCatalogSyncArgs(argv)
  await loadCatalogDatabaseEnv(args.envFile)
  const config = await loadCatalogConfig(
    parseCatalogArgs([
      'list',
      '--env-file',
      args.envFile,
      ...(args.prefix ? ['--prefix', args.prefix] : []),
    ]),
  )
  const scope = { bucket: config.r2.bucket, prefix: config.filter.prefix }
  const { acquireDbAdvisoryLock, closeDb } = await import('../db/index.js')
  const { MysqlRecorderCatalog, readCatalogStatus } = await import('../db/recorderV4Catalog.js')
  const guard = new CatalogProcessGuard()
  const stop = () => guard.stop()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  const store = new R2BlobStore(config.r2)
  const closeStore = () => store.close()
  guard.signal.addEventListener('abort', closeStore, { once: true })
  let release: (() => Promise<void>) | null = null
  try {
    if (args.command === 'status') {
      console.log(JSON.stringify(await guard.database(() => readCatalogStatus(scope))))
      return
    }
    release = await guard.database(() =>
      acquireDbAdvisoryLock(`recorder-v4-catalog:${catalogScopeId(scope)}`, () => {
        console.error('[recorder-catalog] database lease lost; stopping until supervisor restart')
        guard.stop(true)
      }),
    )
    if (!release) throw new RecorderCliError('Another catalog sync process owns this archive scope')
    const mysql = new MysqlRecorderCatalog()
    const repository: CatalogRepository = {
      listKnown: (scope, fromMs) => guard.database(() => mysql.listKnown(scope, fromMs)),
      get: (id) => guard.database(() => mysql.get(id)),
      put: (recording) => guard.database(() => mysql.put(recording)),
      saveStatus: (status) => guard.database(() => mysql.saveStatus(status)),
    }
    let lastFullScan = 0
    while (!guard.signal.aborted) {
      try {
        const fullScan = Date.now() - lastFullScan >= 3_600_000
        const result = await syncRecorderCatalog({
          store,
          repository,
          scope,
          fullScan,
          maxFiles: args.maxFiles,
          signal: guard.signal,
          onProgress: (status) => console.log(JSON.stringify({ type: 'progress', ...status })),
        })
        console.log(JSON.stringify({ type: 'complete', ...result }))
        if (fullScan && !result.remaining && !result.failures.length) lastFullScan = Date.now()
        if (!args.watch) {
          if (result.remaining || result.failures.length) process.exitCode = 1
          break
        }
        await sleep(
          result.remaining && !result.failures.length ? 1000 : args.intervalMs,
          undefined,
          { signal: guard.signal },
        )
      } catch (error) {
        if (guard.signal.aborted) break
        console.error(
          `[recorder-catalog] sync failed (${error instanceof Error ? error.name : 'Error'}); capture is unaffected`,
        )
        if (!args.watch) {
          process.exitCode = 1
          break
        }
        await sleep(args.intervalMs, undefined, { signal: guard.signal }).catch(() => undefined)
      }
    }
  } finally {
    // Also bound lock release and pool shutdown after a startup error or signal.
    guard.stop()
    store.close()
    await release?.()
    await closeDb()
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
    guard.finished()
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof RecorderCliError
      ? `[recorder-catalog] ${error.message}`
      : '[recorder-catalog] startup failed; check database migration, explicit configuration, connectivity, and service permissions',
  )
  process.exitCode = 1
})
