import { readRemoteManifest } from '../recorder-v4/storage/archive.js'
import { R2BlobStore } from '../recorder-v4/storage/blobStore.js'
import { RecorderCliError } from '../recorder-v4/cliError.js'
import {
  CATALOG_HELP,
  downloadRecordedMarkets,
  listRecordedMarkets,
  loadCatalogConfig,
  parseCatalogArgs,
} from '../recorder-v4/storage/catalog.js'
import type { CatalogEntry } from '../recorder-v4/storage/catalog.js'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help')) {
    console.log(CATALOG_HELP)
    return
  }
  const args = parseCatalogArgs(argv)
  const config = await loadCatalogConfig(args)
  const store = new R2BlobStore(config.r2)
  try {
    const entries = config.manifestKey
      ? (async function* (): AsyncGenerator<CatalogEntry> {
          const manifestKey = config.manifestKey!
          yield { manifestKey, manifest: (await readRemoteManifest(store, manifestKey)).manifest }
        })()
      : listRecordedMarkets(store, config.filter)
    if (args.command === 'list') {
      for await (const entry of entries)
        console.log(
          JSON.stringify({
            slug: entry.manifest.market.slug,
            timeframe: entry.manifest.market.timeframe,
            startsAt: new Date(entry.manifest.market.startMs).toISOString(),
            complete: entry.manifest.coverage.complete,
            gaps: entry.manifest.coverage.gaps.length,
            rows: entry.manifest.events.rows,
            bytes: entry.manifest.events.bytes,
            manifestKey: entry.manifestKey,
          }),
        )
    } else {
      const result = await downloadRecordedMarkets(store, entries, args.output!, {
        onDownloaded: (entry, result) =>
          console.log(
            JSON.stringify({
              slug: entry.manifest.market.slug,
              manifestPath: result.manifestPath,
              parquetPath: result.parquetPath,
            }),
          ),
        onError: (entry) =>
          console.error(
            `[recorder-data] failed to verify/download market ${entry.manifest.market.slug}; existing valid cache is preserved`,
          ),
      })
      console.error(`[recorder-data] downloaded=${result.downloaded} failed=${result.failed}`)
      if (result.failed) process.exitCode = 1
    }
  } finally {
    store.close()
  }
}

main().catch((error: unknown) => {
  if (error instanceof RecorderCliError) {
    console.error(`[recorder-data] ${error.message}`)
    process.exitCode = 1
    return
  }
  // SDK errors may carry endpoint details; never print configuration or credential-bearing URLs.
  console.error(
    '[recorder-data] catalog operation failed; check arguments, explicit R2 configuration, connectivity, and archive integrity. Earlier successful downloads remain available.',
  )
  process.exitCode = 1
})
