import { loadRecorderConfig, RECORDER_HELP } from '../recorder-v4/config.js'
import { runRecorder } from '../recorder-v4/daemon.js'
import { RecorderCliError } from '../recorder-v4/cliError.js'

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

main().catch((error: unknown) => {
  if (error instanceof RecorderCliError) {
    console.error(error.message)
    process.exitCode = 1
    return
  }
  // Configuration/startup errors must not accidentally print credential-bearing URLs.
  console.error(
    '[recorder] startup failed; check the explicit recorder configuration and spool permissions',
  )
  process.exitCode = 1
})
