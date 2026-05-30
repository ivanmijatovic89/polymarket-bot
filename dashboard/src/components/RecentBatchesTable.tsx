'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Card } from './Card'
import type { HistoricalBatch } from '@/lib/queries/batches'

async function fetchHistory(): Promise<{ batches: HistoricalBatch[] }> {
  const r = await fetch('/api/batches/history?limit=20', { cache: 'no-store' })
  if (!r.ok) throw new Error('failed to fetch /api/batches/history')
  return r.json()
}

export function RecentBatchesTable() {
  const { data } = useQuery({
    queryKey: ['batches', 'history'],
    queryFn: fetchHistory,
    refetchInterval: 10000,
  })
  const batches = data?.batches ?? []
  if (batches.length === 0) {
    return (
      <Card>
        <div className="text-muted text-sm">No completed batches yet.</div>
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
            <th className="font-medium px-3 py-2">comment</th>
            <th className="font-medium px-3 py-2">pnl</th>
            <th className="font-medium px-3 py-2">win rate</th>
            <th className="font-medium px-3 py-2">created</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b, i) => {
            const bs = b.batchStats as Record<string, unknown>
            const pnlNum = typeof bs.pnlTotal === 'number' ? (bs.pnlTotal as number) : null
            const pnl = pnlNum !== null ? pnlNum.toFixed(2) : ''
            const wr = typeof bs.winRatePctStr === 'string' ? `${bs.winRatePctStr}%` : ''
            const pnlClass = pnlNum === null ? '' : pnlNum < 0 ? 'text-bad' : 'text-good'
            const uid = b.batchUid ?? ''
            return (
              <tr key={`${uid}-${i}`} className="border-t border-border">
                <td className="px-3 py-2 font-mono">
                  {uid ? (
                    <Link
                      href={`/batches/${encodeURIComponent(uid)}`}
                      className="text-link hover:underline"
                    >
                      {uid}
                    </Link>
                  ) : (
                    ''
                  )}
                </td>
                <td className="px-3 py-2">{b.strategy}</td>
                <td className="px-3 py-2 text-muted">{b.comment ?? ''}</td>
                <td className={`px-3 py-2 tabular-nums ${pnlClass}`}>{pnl}</td>
                <td className="px-3 py-2 tabular-nums">{wr}</td>
                <td className="px-3 py-2 text-muted">
                  {b.createdAt ? new Date(b.createdAt).toLocaleString() : ''}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Card>
  )
}
