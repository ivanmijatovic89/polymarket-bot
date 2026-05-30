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

/**
 * Standalone Bull Board UI for inspecting BullMQ queues/jobs.
 *
 * Lives at /admin/queues on its own port (default 3003). The Next.js
 * dashboard at :3001 links here for raw queue inspection. We keep this
 * as a separate proc because Bull Board ships as a Fastify/Express plugin
 * that doesn't fit cleanly inside the Next.js App Router.
 */
async function main(): Promise<void> {
  requireEnv(['REDIS_URL'])
  const port = Number(process.env.BULL_BOARD_PORT ?? 3003)
  const host = process.env.BULL_BOARD_HOST ?? '127.0.0.1'

  try {
    await getRedisConnection().ping()
  } catch (err) {
    console.error('[bull-board] Redis ping failed:', err)
    process.exit(2)
  }

  const app = Fastify({ logger: false })
  const adapter = new FastifyAdapter()
  adapter.setBasePath('/admin/queues')
  createBullBoard({
    queues: [new BullMQAdapter(getMarketQueue()), new BullMQAdapter(getAggregateQueue())],
    serverAdapter: adapter,
  })
  await app.register(adapter.registerPlugin(), { prefix: '/admin/queues' })

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[bull-board] ${signal} received, shutting down...`)
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
  console.log(`[bull-board] http://${host}:${port}/admin/queues`)
}

main().catch((err) => {
  console.error('[bull-board] startup failed:', err)
  process.exit(1)
})
