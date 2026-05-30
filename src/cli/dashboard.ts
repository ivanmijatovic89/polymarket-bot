import '../config/env.js'
import Fastify from 'fastify'
import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { FastifyAdapter } from '@bull-board/fastify'
import { requireEnv } from '../config/env.js'
import {
  closeRedisConnection,
  getAggregateQueue,
  getMarketQueue,
  getRedisConnection,
} from '../backtest/queue.js'
import { registerDashboardRoutes } from '../backtest/dashboardRoutes.js'

async function main(): Promise<void> {
  requireEnv(['REDIS_URL'])
  const port = Number(process.env.DASHBOARD_PORT ?? 3001)
  const host = process.env.DASHBOARD_HOST ?? '127.0.0.1'

  // Sanity-check Redis up front so we fail fast on a misconfigured machine.
  try {
    await getRedisConnection().ping()
  } catch (err) {
    console.error('[dashboard] Redis ping failed:', err)
    process.exit(2)
  }

  const app = Fastify({ logger: false })

  // Bull Board: raw queue/job inspection at /admin/queues.
  const bullBoardAdapter = new FastifyAdapter()
  bullBoardAdapter.setBasePath('/admin/queues')
  createBullBoard({
    queues: [new BullMQAdapter(getMarketQueue()), new BullMQAdapter(getAggregateQueue())],
    serverAdapter: bullBoardAdapter,
  })
  await app.register(bullBoardAdapter.registerPlugin(), { prefix: '/admin/queues' })

  // Custom routes (workers, batches, overview HTML).
  await registerDashboardRoutes(app)

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[dashboard] ${signal} received, shutting down...`)
    try {
      await app.close()
    } catch {
      /* ignore */
    }
    await closeRedisConnection()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  await app.listen({ host, port })
  console.log(`[dashboard] http://${host}:${port}`)
  console.log(`[dashboard]   overview          /`)
  console.log(`[dashboard]   bull board (raw)  /admin/queues`)
}

main().catch((err) => {
  console.error('[dashboard] startup failed:', err)
  process.exit(1)
})
