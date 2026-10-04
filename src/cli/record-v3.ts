import { loadRecorderConfig, RECORDER_HELP } from '../recorder-v3/config.js'
import { runRecorder } from '../recorder-v3/daemon.js'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help')) {
    console.log(RECORDER_HELP)
    return
  }
  const config = await loadRecorderConfig(argv)
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    const status = await runRecorder(config, { signal: controller.signal })
    if (status.state === 'error') process.exitCode = 1
  } finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
}

main().catch(() => {
  // Configuration/startup errors must not accidentally print credential-bearing URLs.
  console.error(
    '[recorder] startup failed; check the explicit recorder configuration and spool permissions',
  )
  process.exitCode = 1
})
