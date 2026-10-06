import { buildParquetFile } from './parquetBuilder.js'
import type { ParquetJob } from './parquetBuilder.js'

// A killed recorder closes IPC. Stop conversion and leave its WAL intact for the next restart.
process.on('disconnect', () => process.exit(1))
if (!process.connected) process.exit(1)
process.once('message', (job: ParquetJob) => {
  void buildParquetFile(job).then(
    (ready) => process.send?.({ ready }, undefined, undefined, () => process.exit(0)),
    (error: unknown) =>
      process.send?.(
        { error: error instanceof Error ? error.message : String(error) },
        undefined,
        undefined,
        () => process.exit(1),
      ),
  )
})
