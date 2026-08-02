'use client'

import { useQuery } from '@tanstack/react-query'
import { Clock, Cpu, CheckCircle2, AlertCircle, Layers, ListChecks } from 'lucide-react'
import { StatCard } from './StatCard'
import {
  fetchQueues,
  LIVE_DASHBOARD_REFETCH_MS,
  queuesQueryKey,
} from '@/lib/client/liveDashboardQueries'

export function QueueCountsView() {
  const { data } = useQuery({
    queryKey: queuesQueryKey,
    queryFn: fetchQueues,
    refetchInterval: LIVE_DASHBOARD_REFETCH_MS,
  })
  const m = data?.markets ?? {}
  const a = data?.aggregate ?? {}
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      <StatCard label="Waiting" value={m.waiting ?? 0} icon={Clock} tone="muted" />
      <StatCard
        label="Active"
        value={m.active ?? 0}
        icon={Cpu}
        tone={Number(m.active) > 0 ? 'warning' : 'default'}
      />
      <StatCard
        label="Completed"
        value={(m.completed ?? 0).toLocaleString()}
        icon={CheckCircle2}
        tone="success"
      />
      <StatCard
        label="Failed"
        value={m.failed ?? 0}
        icon={AlertCircle}
        tone={Number(m.failed) > 0 ? 'destructive' : 'default'}
      />
      <StatCard
        label="Aggregate (waiting)"
        value={a['waiting-children'] ?? 0}
        icon={Layers}
        tone="muted"
      />
      <StatCard
        label="Aggregate (done)"
        value={(a.completed ?? 0).toLocaleString()}
        icon={ListChecks}
        tone="success"
      />
    </div>
  )
}
