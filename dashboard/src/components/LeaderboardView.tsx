'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { Skeleton } from './ui/skeleton'
import { Card } from './ui/card'
import { LeaderboardTable } from './LeaderboardTable'
import type { LeaderboardRange, LeaderboardRow } from '@/lib/queries/leaderboard'

const RANGES: { value: LeaderboardRange; label: string }[] = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: 'all', label: 'All time' },
]

async function fetchLeaderboard(
  range: LeaderboardRange,
): Promise<{ range: LeaderboardRange; rows: LeaderboardRow[] }> {
  const r = await fetch(`/api/leaderboard?range=${range}`, { cache: 'no-store' })
  if (!r.ok) throw new Error('failed to fetch /api/leaderboard')
  return r.json()
}

/**
 * Data-fetching wrapper around the presentational LeaderboardTable.
 * Adds a range toggle (24h / 7d / All) and TanStack Query polling.
 * Pages that just want the table without controls can import
 * `LeaderboardTable` directly.
 */
export function LeaderboardView({ defaultRange = 'all' as LeaderboardRange }) {
  const [range, setRange] = useState<LeaderboardRange>(defaultRange)
  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard', range],
    queryFn: () => fetchLeaderboard(range),
    refetchInterval: 10_000,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 text-sm">
        {RANGES.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => setRange(r.value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs transition-colors',
              range === r.value
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>
      {isLoading ? (
        <Card className="p-6">
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </Card>
      ) : (
        <LeaderboardTable rows={data?.rows ?? []} />
      )}
    </div>
  )
}
