import '../config/env.js'
import {
  discoverCapturePackages,
  type CaptureSelectionFilters,
} from '../recorder-v4/replay/selection.js'
import { captureCatalogMetadata } from '../recorder-v4/replay/catalogMetadata.js'
import type { RecorderV4SelectionSource } from '../recorder-v4/replay/eligibility.js'
import type { ExternalFeedsRequestConfig } from '../strategy/plugins/ExternalFeedsRequestPlugin.js'

// Internal read-only child. Only the server sends saved/configured source identities over IPC.
if (!process.send) throw new Error('Recorder catalog overview requires an IPC parent')
// The parent has its own deadline, but a dashboard restart can remove it while
// this child still has an active metadata request. There are no writes to drain.
process.once('disconnect', () => process.exit(1))
process.once('SIGTERM', () => process.exit(143))
process.once('SIGINT', () => process.exit(130))
if (!process.connected) process.exit(1)
setTimeout(() => process.exit(1), 300_000).unref()
process.once(
  'message',
  async (request: {
    source: RecorderV4SelectionSource
    filters: CaptureSelectionFilters
    requiredFeeds: ExternalFeedsRequestConfig
    allowGaps: boolean
  }) => {
    try {
      const packages = await discoverCapturePackages(request.source, request.filters)
      const data = await captureCatalogMetadata(packages, request.requiredFeeds, request.allowGaps)
      if (request.source.kind === 'r2') {
        const { readCatalogStatus } = await import('../db/recorderV4Catalog.js')
        const state = await readCatalogStatus(request.source)
        if (state)
          data.catalogSync = {
            lastCompletedAtMs: state.lastCompletedAtMs,
            indexed: state.status.indexed,
            remaining: state.status.remaining,
            failures: state.status.failures.length,
          }
      }
      if (Buffer.byteLength(JSON.stringify(data)) > 32 * 1024 ** 2)
        throw new Error('Recorder catalog view exceeds 32 MiB; choose a narrower range.')
      process.send?.({ type: 'ready', data }, undefined, undefined, (error) => {
        process.exit(error ? 1 : 0)
      })
    } catch (error) {
      process.send?.(
        {
          type: 'failed',
          message: error instanceof Error ? error.message : 'Recorder catalog unavailable',
        },
        undefined,
        undefined,
        () => {
          process.exit(1)
        },
      )
      process.exitCode = 1
    }
  },
)
