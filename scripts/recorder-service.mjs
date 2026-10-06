import { spawn } from 'node:child_process'
import { BoundedLog } from './lib/bounded-log.mjs'

// This entry point uses only Node built-ins, including while recorder dependencies are broken.
const args = process.argv.slice(2)
if (args[0] !== '--log-file' || !args[1] || args[2] !== '--' || args.length < 4) {
  console.error(
    'Usage: node scripts/recorder-service.mjs --log-file /absolute/recorder.log -- <node arguments>',
  )
  process.exitCode = 2
} else {
  let log
  let child
  let failed = false
  const fail = () => {
    if (failed) return
    failed = true
    process.exitCode = 1
    console.error(
      '[recorder-service] logging or child startup failed; inspect service permissions and disk space',
    )
    child?.kill('SIGTERM')
  }
  try {
    log = new BoundedLog(args[1])
    child = spawn(process.execPath, args.slice(3), { stdio: ['ignore', 'pipe', 'pipe'] })
    const write = (chunk) => {
      try {
        log.write(chunk)
      } catch {
        fail()
      }
    }
    child.stdout.on('data', write)
    child.stderr.on('data', write)
    child.on('error', fail)
    const interrupt = () => child.kill('SIGINT')
    const terminate = () => child.kill('SIGTERM')
    process.on('SIGINT', interrupt)
    process.on('SIGTERM', terminate)
    child.once('close', (code, signal) => {
      process.off('SIGINT', interrupt)
      process.off('SIGTERM', terminate)
      try {
        log.close()
      } catch {
        failed = true
      }
      process.exitCode = failed
        ? 1
        : (code ?? (signal === 'SIGTERM' || signal === 'SIGINT' ? 0 : 1))
    })
  } catch {
    fail()
    log?.close()
  }
}
