'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Cpu, Server } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MachineGroup } from '@/lib/queries/workers'
import type { ActiveBatchSummary } from '@/lib/queries/batches'

async function fetchWorkers(): Promise<{
  machines: MachineGroup[]
  totals: { alive: number }
}> {
  const r = await fetch('/api/workers', { cache: 'no-store' })
  if (!r.ok) throw new Error('failed to fetch /api/workers')
  return r.json()
}

async function fetchActiveBatches(): Promise<{ batches: ActiveBatchSummary[] }> {
  const r = await fetch('/api/batches/active', { cache: 'no-store' })
  if (!r.ok) throw new Error('failed to fetch /api/batches/active')
  return r.json()
}

type Tone = 'active' | 'idle' | 'warning'

/**
 * Compact live indicator for the nav bar: machine count, alive worker count,
 * and progress across in-flight batches as `done / total`.
 *
 * `total` is the sum of `totalMarkets` over currently-active batches and `done`
 * the sum of finished (completed + failed) children. Because a batch leaves the
 * active set the moment it finalizes to MySQL, both numbers describe *live*
 * work only — finishing a whole batch drops its share out of both numerator and
 * denominator, and an empty active set renders as `idle`. Colour of the dot
 * carries the state: green (workers processing), amber (work outstanding but no
 * live workers to pick it up), muted (idle). Links to the Overview page.
 */
export function LiveStatusBadge({ className }: { className?: string }) {
  const { data: workers } = useQuery({
    queryKey: ['workers', 'nav-badge'],
    queryFn: fetchWorkers,
    refetchInterval: 5000,
  })
  const { data: batchData } = useQuery({
    queryKey: ['active-batches', 'nav-badge'],
    queryFn: fetchActiveBatches,
    refetchInterval: 5000,
  })

  const machineCount = workers?.machines.length ?? 0
  const aliveCount = workers?.totals.alive ?? 0

  const batches = batchData?.batches ?? []
  const total = batches.reduce((s, b) => s + b.totalMarkets, 0)
  const done = batches.reduce((s, b) => s + b.completedChildren + b.failedChildren, 0)
  const outstanding = Math.max(0, total - done)
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  const tone: Tone = outstanding > 0 ? (aliveCount > 0 ? 'active' : 'warning') : 'idle'

  const dotClass = cn(
    'h-2 w-2 rounded-full',
    tone === 'active' && 'bg-emerald-500 animate-pulse',
    tone === 'idle' && 'bg-muted-foreground/50',
    tone === 'warning' && 'bg-amber-500',
  )

  const progressLabel =
    tone === 'idle' ? 'idle' : `${done.toLocaleString()} / ${total.toLocaleString()} · ${pct}%`

  return (
    <Link
      href="/"
      title={
        tone === 'idle'
          ? `${machineCount} machine(s), ${aliveCount} alive worker(s) · no active batches`
          : `${machineCount} machine(s), ${aliveCount} alive worker(s) · ${batches.length} active batch(es), ${done.toLocaleString()} of ${total.toLocaleString()} markets done (${pct}%)`
      }
      className={cn(
        'flex items-center gap-2.5 rounded-full border px-3 py-1 text-xs transition-colors',
        tone === 'warning'
          ? 'border-amber-500/40 text-amber-500 hover:bg-amber-500/10'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent',
        className,
      )}
    >
      <span className="flex items-center gap-1 tabular-nums">
        <Server className="h-3.5 w-3.5" />
        {machineCount}
      </span>
      <span className="flex items-center gap-1 tabular-nums">
        <Cpu className="h-3.5 w-3.5" />
        {aliveCount}
      </span>
      <span className="h-3 w-px bg-border" />
      <span className="flex items-center gap-1.5 tabular-nums">
        <span className={dotClass} />
        {progressLabel}
      </span>
    </Link>
  )
}
