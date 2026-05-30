'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Card } from './Card'
import { ProgressBar } from './ProgressBar'
import type { ActiveBatchSummary } from '@/lib/queries/batches'

async function fetchActive(): Promise<{ batches: ActiveBatchSummary[] }> {
  const r = await fetch('/api/batches/active', { cache: 'no-store' })
  if (!r.ok) throw new Error('failed to fetch /api/batches/active')
  return r.json()
}

export function ActiveBatchesTable() {
  const { data } = useQuery({
    queryKey: ['batches', 'active'],
    queryFn: fetchActive,
    refetchInterval: 3000,
  })
  const batches = data?.batches ?? []
  if (batches.length === 0) {
    return (
      <Card>
        <div className="text-muted text-sm">No active batches.</div>
      </Card>
    )
  }
  return (
    <Card className="p-0 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted text-left">
            <th className="font-medium px-3 py-2">batchUid</th>
            <th className="font-medium px-3 py-2">strategy</th>
            <th className="font-medium px-3 py-2 min-w-[240px]">progress</th>
            <th className="font-medium px-3 py-2">done</th>
            <th className="font-medium px-3 py-2">active</th>
            <th className="font-medium px-3 py-2">waiting</th>
            <th className="font-medium px-3 py-2">failed</th>
            <th className="font-medium px-3 py-2">state</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.batchUid} className="border-t border-border align-top">
              <td className="px-3 py-2 font-mono">
                <Link
                  href={`/batches/${encodeURIComponent(b.batchUid)}`}
                  className="text-link hover:underline"
                >
                  {b.batchUid}
                </Link>
              </td>
              <td className="px-3 py-2">{b.strategy}</td>
              <td className="px-3 py-2">
                <ProgressBar
                  total={b.totalMarkets}
                  completed={b.completedChildren}
                  active={b.activeChildren}
                  failed={b.failedChildren}
                />
              </td>
              <td className="px-3 py-2 tabular-nums">{b.completedChildren}</td>
              <td className="px-3 py-2 tabular-nums">{b.activeChildren}</td>
              <td className="px-3 py-2 tabular-nums">{b.waitingChildren}</td>
              <td className={`px-3 py-2 tabular-nums ${b.failedChildren > 0 ? 'text-bad' : ''}`}>
                {b.failedChildren}
              </td>
              <td className="px-3 py-2">
                <span className="inline-block px-2 py-0.5 rounded-full bg-border text-xs">
                  {b.parentState ?? '?'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
