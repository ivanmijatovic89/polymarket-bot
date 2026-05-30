import { getAggregateQueue, getMarketQueue } from '../queue'

export type QueueCounts = {
  markets: Record<string, number>
  aggregate: Record<string, number>
}

export async function queueCounts(): Promise<QueueCounts> {
  const market = getMarketQueue()
  const agg = getAggregateQueue()
  const [m, a] = await Promise.all([
    market.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'waiting-children'),
    agg.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'waiting-children'),
  ])
  return { markets: m, aggregate: a }
}
