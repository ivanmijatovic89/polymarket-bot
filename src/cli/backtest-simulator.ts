import '../config/env.js'
import { closeDb } from '../db/index.js'
import { captureTrace } from '../backtest/simulator/captureTrace.js'

// Internal child entrypoint. The server supplies only a validated run, slug, and session directory.
const [run, slug, directory] = process.argv.slice(2)
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
  process.disconnect?.()
}
