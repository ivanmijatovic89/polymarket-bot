'use client'

import { useQuery } from '@tanstack/react-query'
import { StatCard } from './Card'
import type { QueueCounts } from '@/lib/queries/queues'

async function fetchQueues(): Promise<QueueCounts> {
  const r = await fetch('/api/queues', { cache: 'no-store' })
  if (!r.ok) throw new Error('failed to fetch /api/queues')
  return r.json()
}

export function QueueCountsView() {
  const { data } = useQuery({
    queryKey: ['queues'],
    queryFn: fetchQueues,
    refetchInterval: 3000,
  })
  const m = data?.markets ?? {}
  const a = data?.aggregate ?? {}
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4 mb-8">
      <StatCard label="Markets — waiting" value={m.waiting ?? 0} />
      <StatCard label="Markets — active" value={m.active ?? 0} />
      <StatCard label="Markets — completed" value={m.completed ?? 0} />
      <StatCard label="Markets — failed" value={m.failed ?? 0} />
      <StatCard label="Aggregate — waiting-children" value={a['waiting-children'] ?? 0} />
      <StatCard label="Aggregate — completed" value={a.completed ?? 0} />
    </div>
  )
}
