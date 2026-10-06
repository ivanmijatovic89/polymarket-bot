import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { RecorderV4SelectionSource } from '@bot/recorder-v4/replay/eligibility'
import type { CaptureSelectionFilters } from '@bot/recorder-v4/replay/selection'
import type { ExternalFeedsRequestConfig } from '@bot/strategy/plugins/ExternalFeedsRequestPlugin'
import type { CaptureCatalogMetadata } from '@bot/recorder-v4/replay/catalogMetadata'

export function readRecorderV4CatalogWorker(
  source: RecorderV4SelectionSource,
  filters: CaptureSelectionFilters,
  requiredFeeds: ExternalFeedsRequestConfig,
  allowGaps: boolean,
): Promise<CaptureCatalogMetadata> {
  let root = process.cwd()
  while (!existsSync(path.join(root, 'src/cli/recorder-v4-catalog-overview.ts'))) {
    const parent = path.dirname(root)
    if (parent === root)
      throw new Error('Recorder catalog requires the repository source on this host.')
    root = parent
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', path.join(root, 'src/cli/recorder-v4-catalog-overview.ts')],
      {
        cwd: root,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      },
    )
    let settled = false
    const finish = (error?: Error, data?: CaptureCatalogMetadata) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        child.kill('SIGKILL')
        reject(error)
      } else resolve(data!)
    }
    const timer = setTimeout(
      () =>
        finish(
          new Error('Recorder catalog read exceeded five minutes. Choose a narrower date range.'),
        ),
      300_000,
    )
    timer.unref()
    child.on('error', (error) => finish(error))
    child.on(
      'message',
      (message: { type?: string; data?: CaptureCatalogMetadata; message?: string }) => {
        if (message.type === 'ready' && message.data) finish(undefined, message.data)
        else if (message.type === 'failed')
          finish(new Error(message.message ?? 'Recorder catalog unavailable'))
      },
    )
    child.once('close', (code) => {
      if (!settled) finish(new Error(`Recorder catalog process exited (${code ?? 'signal'}).`))
    })
    child.send({ source, filters, requiredFeeds, allowGaps }, (error) => {
      if (error) finish(error)
    })
  })
}
