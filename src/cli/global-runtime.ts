import '../config/env.js'
import { closeDb } from '../db/index.js'
import { buildRuntimeApi } from '../global-runtime/api.js'
import { DrizzleRuntimeStore } from '../global-runtime/dbStore.js'
import { GlobalRuntime } from '../global-runtime/runtime.js'

async function main(): Promise<void> {
  const host = process.env.GLOBAL_RUNTIME_HOST?.trim() || '127.0.0.1'
  const port = parsePositiveInteger(process.env.GLOBAL_RUNTIME_PORT, 3053)
  const retrySeconds = parsePositiveInteger(
    process.env.GLOBAL_RUNTIME_RATE_LIMIT_RETRY_SECONDS,
    900,
  )
  const runtime = new GlobalRuntime(new DrizzleRuntimeStore(), {
    logRoot: process.env.GLOBAL_RUNTIME_LOG_DIR || 'logs/global-runtime',
    rateLimitRetryMs: retrySeconds * 1000,
  })
  await runtime.initialize()
  const app = buildRuntimeApi(runtime)
  let closing = false

  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return
    closing = true
    console.log(`[global-runtime] ${signal} received, stopping active sessions...`)
    await app.close().catch(() => undefined)
    await runtime.shutdown()
    await closeDb()
  }
  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))

  await app.listen({ host, port })
  console.log(`[global-runtime] listening on http://${host}:${port}`)
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
