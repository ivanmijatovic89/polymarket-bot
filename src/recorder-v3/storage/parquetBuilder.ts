import * as parquet from '@dsnp/parquetjs'
import { randomUUID } from 'node:crypto'
import { open, rename } from 'node:fs/promises'
import path from 'node:path'

import { atomicWrite, digestFile, exists, syncDirectory } from './files.js'
import { readJournals } from './journalReader.js'
import { marketManifestSchema, type MarketManifest } from './manifest.js'
import type { PackageState, ReadyMarket } from './marketStore.js'
import { capturedEventSchema, eventToRow } from './parquet.js'
import type { MarketCoverage } from '../types.js'

export type ParquetJob = {
  directory: string
  state: PackageState
  coverage: MarketCoverage
  prefix: string
  rowGroupSize: number
  rowGroupBytes: number
}

/** Runs only in the isolated conversion child; capture never does compression work. */
export async function buildParquetFile(job: ParquetJob): Promise<ReadyMarket> {
  const { directory, state, coverage } = job
  const file = path.join(directory, `events-${randomUUID()}.parquet.tmp`)
  const writer = await parquet.ParquetWriter.openFile(capturedEventSchema, file)
  const rowGroupSize = job.rowGroupSize ?? 512
  writer.setRowGroupSize(rowGroupSize)
  writer.setMetadata('recorder_schema_version', '3')
  writer.setMetadata('market_slug', state.market.slug)
  let rows = 0
  let firstSequence: string | null = null
  let lastSequence: string | null = null
  let groupRows = 0
  let groupBytes = 0
  try {
    for await (const event of readJournals(directory)) {
      if (lastSequence !== null && BigInt(event.sequence) <= BigInt(lastSequence))
        throw new Error('Journal event ordering is invalid')
      groupRows++
      groupBytes +=
        Buffer.byteLength(event.rawJson) + Buffer.byteLength(event.detailsJson ?? '') + 512
      const flush =
        groupRows >= rowGroupSize || groupBytes >= (job.rowGroupBytes ?? 4 * 1024 * 1024)
      if (flush) writer.setRowGroupSize(groupRows)
      await writer.appendRow(eventToRow(event))
      if (flush) {
        groupRows = 0
        groupBytes = 0
        writer.setRowGroupSize(rowGroupSize)
      }
      firstSequence ??= event.sequence
      lastSequence = event.sequence
      rows++
    }
  } finally {
    await writer.close()
  }
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
    schemaVersion: 3,
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
