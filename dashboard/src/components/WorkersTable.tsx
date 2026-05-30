'use client'

import { useQuery } from '@tanstack/react-query'
import { Card } from './Card'
import type { WorkerStats } from '@/lib/queries/workers'

async function fetchWorkers(): Promise<{ workers: WorkerStats[] }> {
  const r = await fetch('/api/workers', { cache: 'no-store' })
  if (!r.ok) throw new Error('failed to fetch /api/workers')
  return r.json()
}

export function WorkersTable() {
  const { data } = useQuery({
    queryKey: ['workers'],
    queryFn: fetchWorkers,
    refetchInterval: 3000,
  })
  const workers = data?.workers ?? []
  if (workers.length === 0) {
    return (
      <Card>
        <div className="text-muted text-sm">
          No workers have reported in yet. Start one with{' '}
          <code className="font-mono">npm run backtest:worker</code>.
        </div>
      </Card>
    )
  }
  return (
    <Card className="p-0 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted text-left">
            <th className="font-medium px-3 py-2">name</th>
            <th className="font-medium px-3 py-2">state</th>
            <th className="font-medium px-3 py-2">processed</th>
            <th className="font-medium px-3 py-2">events</th>
            <th className="font-medium px-3 py-2">last market</th>
            <th className="font-medium px-3 py-2">last hb</th>
          </tr>
        </thead>
        <tbody>
          {workers.map((w) => (
            <tr key={w.name} className="border-t border-border">
              <td className="px-3 py-2 font-mono">{w.name}</td>
              <td className={`px-3 py-2 ${w.alive ? 'text-good' : 'text-bad'}`}>
                {w.alive ? '● alive' : '○ stale'}
              </td>
              <td className="px-3 py-2 tabular-nums">{w.processedTotal.toLocaleString()}</td>
              <td className="px-3 py-2 tabular-nums">{w.eventsTotal.toLocaleString()}</td>
              <td className="px-3 py-2 font-mono text-xs">{w.lastMarket ?? ''}</td>
              <td className="px-3 py-2 text-muted">
                {w.heartbeatAgeMs !== null ? `${Math.round(w.heartbeatAgeMs / 1000)}s` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
