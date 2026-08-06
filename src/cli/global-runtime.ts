import '../config/env.js'
import { closeDb, isDbAdvisoryLockHeld } from '../db/index.js'
import { assertSafeBind, buildRuntimeApi } from '../global-runtime/api.js'
import { DrizzleRuntimeStore } from '../global-runtime/dbStore.js'
import { GlobalRuntime } from '../global-runtime/runtime.js'
import { getMachineCatalogEntry, machineLabel } from '../machines/catalog.js'
import { getMachineId } from '../machines/identity.js'

/** Lease name used by pre-#213 (single-daemon) builds. */
const LEGACY_GLOBAL_LEASE = 'polymarket-bot:global-runtime'

async function main(): Promise<void> {
  const machineId = getMachineId()
  if (!getMachineCatalogEntry(machineId)) {
    throw new Error(
      `machine ${machineId} is not registered in dashboard/src/data/machines.json — ` +
        'add it to the catalog before starting a Global Runtime daemon',
    )
  }
  // Pre-#213 daemons took ONE fleet-wide lease and recovered runs without a
  // machine filter, so one still running against this database would adopt
  // and terminate other machines' runs. Its lease name is the only reliable
  // signal that a stale-version daemon is live — refuse to join it.
  if (await isDbAdvisoryLockHeld(LEGACY_GLOBAL_LEASE)) {
    throw new Error(
      'a pre-#213 Global Runtime daemon still holds the fleet-wide lease against this database. ' +
        'Stop it (and update that machine) before starting per-machine daemons — the old code ' +
        "recovers other machines' runs. See docs/global-runtime/fleet.md.",
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
  // 0 is meaningful here: a non-blocking lease attempt (fail fast instead of
  // waiting out a stale holder), so this parser allows it.
  const leaseWaitSeconds = parseNonNegativeInteger(
    process.env.GLOBAL_RUNTIME_LEASE_WAIT_SECONDS,
    330,
  )
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

function parseNonNegativeInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`expected a non-negative integer, received ${raw}`)
  }
  return value
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
