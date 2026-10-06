import { randomUUID } from 'node:crypto'
import { open, rename } from 'node:fs/promises'
import path from 'node:path'

import { atomicWrite, digestFile, exists, syncDirectory } from './files.js'
import { readJournals } from './journalReader.js'
import { marketManifestSchema, type MarketManifest } from './manifest.js'
import type { PackageState, ReadyMarket } from './marketStore.js'
import { writeCapturedEvents } from './compactWriter.js'
import type { MarketCoverage } from '../types.js'

export type ParquetJob = {
  directory: string
  state: PackageState
  coverage: MarketCoverage
  prefix: string
  rowGroupSize: number
}

/** Runs only in the isolated conversion child; capture never does compression work. */
export async function buildParquetFile(job: ParquetJob): Promise<ReadyMarket> {
  const { directory, state, coverage } = job
  const file = path.join(directory, `events-${randomUUID()}.parquet.tmp`)
  const { rows, firstSequence, lastSequence } = await writeCapturedEvents(
    file,
    readJournals(directory),
    {
      marketSlug: state.market.slug,
      rowGroupSize: job.rowGroupSize,
    },
  )
  const handle = await open(file, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  const digest = await digestFile(file)
  const destination = path.join(directory, 'events.parquet')
  if (await exists(destination)) {
    // A crash can leave a fully written, unpublished previous build. Preserve it for diagnosis.
    await rename(destination, path.join(directory, `unpublished-${randomUUID()}.parquet`))
  }
  await rename(file, destination)
  await syncDirectory(directory)
  const manifest: MarketManifest = {
    schemaVersion: 4,
    archiveLayout: 'symbol-timeframe',
    recordingId: state.recordingId,
    market: state.market,
    coverage,
    createdAtMs: state.createdAtMs,
    finalizedAtMs: Date.now(),
    events: {
      ...digest,
      key: `${job.prefix}/${state.market.symbol}/${state.market.timeframe}/${state.market.slug}/${state.recordingId}/events-${digest.sha256}.parquet`,
      rows,
      firstSequence,
      lastSequence,
    },
  }
  marketManifestSchema.parse(manifest)
  await atomicWrite(path.join(directory, 'manifest.json'), JSON.stringify(manifest))
  return { directory, manifest }
}
