import '../config/env.js'
import { closeDb } from '../db/index.js'
import { assertSafeBind, buildRuntimeApi } from '../global-runtime/api.js'
import { DrizzleRuntimeStore } from '../global-runtime/dbStore.js'
import { GlobalRuntime } from '../global-runtime/runtime.js'
import { getMachineCatalogEntry, machineLabel } from '../machines/catalog.js'
import { getMachineId } from '../machines/identity.js'

async function main(): Promise<void> {
  const machineId = getMachineId()
  if (!getMachineCatalogEntry(machineId)) {
    throw new Error(
      `machine ${machineId} is not registered in dashboard/src/data/machines.json — ` +
        'add it to the catalog before starting a Global Runtime daemon',
    )
  }
  const host = process.env.GLOBAL_RUNTIME_HOST?.trim() || '127.0.0.1'
  const port = parsePositiveInteger(process.env.GLOBAL_RUNTIME_PORT, 3053)
  const token = process.env.GLOBAL_RUNTIME_TOKEN?.trim() || undefined
  assertSafeBind(host, token)
  const retrySeconds = parsePositiveInteger(
    process.env.GLOBAL_RUNTIME_RATE_LIMIT_RETRY_SECONDS,
    900,
  )
  const leaseWaitSeconds = parsePositiveInteger(process.env.GLOBAL_RUNTIME_LEASE_WAIT_SECONDS, 330)
  const runtime = new GlobalRuntime(new DrizzleRuntimeStore({ leaseWaitSeconds }), {
    logRoot: process.env.GLOBAL_RUNTIME_LOG_DIR || 'logs/global-runtime',
    rateLimitRetryMs: retrySeconds * 1000,
    onFatalError: (error) => {
      void shutdown('database lease lost', error)
    },
  })
  let ready = false
  const app = buildRuntimeApi(runtime, { isReady: () => ready, token })
  let closing = false

  async function shutdown(reason: string, fatalError?: unknown): Promise<void> {
    if (fatalError !== undefined) process.exitCode = 1
    if (closing) return
    closing = true
    ready = false
    console.log(`[global-runtime] ${reason}, stopping active sessions...`)
    await app.close().catch(() => undefined)
    await runtime.shutdown()
    await closeDb()
  }
  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))

  try {
    await app.listen({ host, port })
    if (leaseWaitSeconds > 0) {
      console.log(
        `[global-runtime] acquiring per-machine lease (waiting up to ${leaseWaitSeconds}s for a stale holder)...`,
      )
    }
    await runtime.initialize()
    if (closing) return
    ready = true
  } catch (error) {
    await app.close().catch(() => undefined)
    await runtime.shutdown()
    throw error
  }
  console.log(
    `[global-runtime] ${machineLabel(machineId)} (${machineId}) listening on http://${host}:${port}${token ? ' [bearer auth]' : ''}`,
  )
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`expected a positive integer, received ${raw}`)
  }
  return value
}

main().catch(async (error) => {
  console.error('[global-runtime] startup failed:', error)
  await closeDb().catch(() => undefined)
  process.exitCode = 1
})
