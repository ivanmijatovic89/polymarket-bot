import { fork } from 'node:child_process'

import type { ReadyMarket } from './marketStore.js'
import type { ParquetJob } from './parquetBuilder.js'

/** The store serializes these jobs: one bounded, credential-free compression process at a time. */
export function runParquetJob(job: ParquetJob): Promise<ReadyMarket> {
  return new Promise((resolve, reject) => {
    const entry = new URL(
      import.meta.url.endsWith('.ts') ? './parquetWorker.ts' : './parquetWorker.js',
      import.meta.url,
    )
    const child = fork(entry, [], {
      execArgv: ['--max-old-space-size=512', '--import', import.meta.resolve('tsx')],
      env: { NODE_ENV: 'production', TZ: 'UTC' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    })
    let result: ReadyMarket | undefined
    let failure: string | undefined
    let diagnostic = ''
    child.stderr?.on('data', (bytes: Buffer) => {
      diagnostic = (diagnostic + bytes.toString()).slice(-4096)
    })
    child.on('message', (message: { ready?: ReadyMarket; error?: string }) => {
      result = message.ready
      failure = message.error
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0 && result) resolve(result)
      else
        reject(new Error(failure ?? `Parquet conversion failed (${signal ?? code}): ${diagnostic}`))
    })
    child.send(job, (error) => {
      if (!error) return
      child.kill('SIGTERM')
      reject(error)
    })
  })
}
