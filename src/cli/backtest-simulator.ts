import '../config/env.js'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { closeDb } from '../db/index.js'
import { captureTrace } from '../backtest/simulator/captureTrace.js'
import { simulatorDirectoryBytes } from '../backtest/simulator/storage.js'

// Internal child entrypoint. The server supplies only a validated run, slug, and session directory.
const [run, slug, directory] = process.argv.slice(2)
const inputDirectory = directory ? path.join(directory, 'input') : undefined
let terminating = false
function terminate(message: string, code = 1): void {
  if (terminating) return
  terminating = true
  const exit = () => {
    // This is the session's download area, never an original local dataset.
    try {
      if (inputDirectory) rmSync(inputDirectory, { recursive: true, force: true })
    } finally {
      process.exit(code)
    }
  }
  // Flush diagnostics when possible, but a dead parent cannot delay shutdown.
  setTimeout(exit, 100).unref()
  if (process.send && process.connected) {
    try {
      process.send({ type: 'failed', message }, undefined, undefined, exit)
    } catch {
      exit()
    }
  } else {
    console.error(message)
    exit()
  }
}
const onDisconnect = () => terminate('Dashboard disconnected during simulator preparation.')
const onTerm = () => terminate('Simulator preparation canceled.', 143)
const onInterrupt = () => terminate('Simulator preparation interrupted.', 130)
process.once('disconnect', onDisconnect)
process.once('SIGTERM', onTerm)
process.once('SIGINT', onInterrupt)
// Independent guards still operate if the dashboard crashes and loses its own timers.
const deadline = setTimeout(
  () => terminate('Replay exceeded the five-minute preparation limit.'),
  300_000,
)
deadline.unref()
const storageGuard = setInterval(() => {
  try {
    if (inputDirectory && simulatorDirectoryBytes(inputDirectory) > 2 * 1024 ** 3)
      terminate('Simulator download exceeded the 2 GiB per-session input limit.')
  } catch {
    terminate('Could not check simulator download storage.')
  }
}, 5000)
storageGuard.unref()
if (process.send && !process.connected) onDisconnect()
try {
  if (!slug || !directory) throw new Error('Expected run id, market slug and output directory')
  const manifest = await captureTrace(Number(run), slug, directory, (ticks) => {
    process.send?.({ type: 'progress', ticks })
  })
  process.send?.({ type: 'ready', ticks: manifest.ticks })
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.send?.({ type: 'failed', message })
  if (!process.send) console.error(message)
  process.exitCode = 1
} finally {
  await closeDb()
  clearTimeout(deadline)
  clearInterval(storageGuard)
  process.removeListener('disconnect', onDisconnect)
  process.removeListener('SIGTERM', onTerm)
  process.removeListener('SIGINT', onInterrupt)
  process.disconnect?.()
}
