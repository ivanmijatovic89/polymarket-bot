'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, StatCard } from './Card'
import { ProgressBar } from './ProgressBar'

type ActiveResponse = {
  batchUid: string
  active: true
  parentState: string
  strategy: string
  comment: string | null
  totalMarkets: number
  waitingChildren: number
  activeChildren: number
  completedChildren: number
  failedChildren: number
  failedChildrenValues: Record<string, unknown>
}

type CompletedResponse = {
  batchUid: string
  active: false
  batch: {
    strategy: string
    comment: string | null
    batchStats: Record<string, unknown>
    marketStats: Array<{
      slug: string | null
      finalOutcome: string | number | null
      pnl: number
      tradeCount: number
      execution?: {
        workerName: string
        durationMs: number
        eventsProcessed: number
      }
    }> | null
    chunkedBatchStats: Record<string, unknown> | null
    failedMarkets: Array<{
      idx: number | null
      slug: string | null
      reason: string
    }> | null
  }
}

type BatchResponse = ActiveResponse | CompletedResponse | { error: string }

async function fetchBatch(uid: string): Promise<BatchResponse> {
  const r = await fetch(`/api/batches/${encodeURIComponent(uid)}`, { cache: 'no-store' })
  if (r.status === 404) return { error: 'batch not found' }
  if (!r.ok) throw new Error(`failed to fetch /api/batches/${uid}`)
  return r.json()
}

export function BatchDetailView({ batchUid }: { batchUid: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['batches', batchUid],
    queryFn: () => fetchBatch(batchUid),
    refetchInterval: (q) => {
      const d = q.state.data as BatchResponse | undefined
      return d && 'active' in d && d.active ? 3000 : false
    },
  })

  if (isLoading) {
    return (
      <Card>
        <div className="text-muted text-sm">Loading…</div>
      </Card>
    )
  }
  if (!data || 'error' in data) {
    return (
      <Card>
        <div className="text-muted text-sm">
          No batch found with batchUid <code className="font-mono">{batchUid}</code>. Either it
          never existed, or it&apos;s still in the queue and the dashboard can&apos;t see the row
          yet.
        </div>
      </Card>
    )
  }

  if (data.active) return <ActiveDetail data={data} />
  return <CompletedDetail data={data} />
}

function ActiveDetail({ data }: { data: ActiveResponse }) {
  const failedEntries = Object.entries(data.failedChildrenValues ?? {})
  return (
    <>
      <Card>
        <div className="text-muted text-xs uppercase tracking-wider">Status</div>
        <div className="flex items-center gap-3 mt-2">
          <span className="inline-block px-2 py-0.5 rounded-full bg-border text-xs">
            {data.parentState}
          </span>
          <span className="font-semibold">{data.strategy}</span>
        </div>
        {data.comment && <p className="text-muted text-sm mt-1">{data.comment}</p>}
        <div className="my-4">
          <ProgressBar
            total={data.totalMarkets}
            completed={data.completedChildren}
            active={data.activeChildren}
            failed={data.failedChildren}
          />
        </div>
        <table className="w-full text-sm mt-4">
          <thead>
            <tr className="text-muted text-left">
              <th className="font-medium px-3 py-2">completed</th>
              <th className="font-medium px-3 py-2">active</th>
              <th className="font-medium px-3 py-2">waiting</th>
              <th className="font-medium px-3 py-2">failed</th>
              <th className="font-medium px-3 py-2">total</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border">
              <td className="px-3 py-2 tabular-nums">{data.completedChildren}</td>
              <td className="px-3 py-2 tabular-nums">{data.activeChildren}</td>
              <td className="px-3 py-2 tabular-nums">{data.waitingChildren}</td>
              <td className={`px-3 py-2 tabular-nums ${data.failedChildren > 0 ? 'text-bad' : ''}`}>
                {data.failedChildren}
              </td>
              <td className="px-3 py-2 tabular-nums">{data.totalMarkets}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      {failedEntries.length > 0 && (
        <>
          <h3 className="text-base font-semibold mt-6 mb-2">
            Failed children ({data.failedChildren}
            {data.failedChildren > failedEntries.length ? `, showing ${failedEntries.length}` : ''})
          </h3>
          <Card className="p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted text-left">
                  <th className="font-medium px-3 py-2">jobId</th>
                  <th className="font-medium px-3 py-2">reason</th>
                </tr>
              </thead>
              <tbody>
                {failedEntries.map(([jobId, reason]) => (
                  <tr key={jobId} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">{jobId}</td>
                    <td className="px-3 py-2 text-bad">{String(reason).slice(0, 200)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  )
}

function CompletedDetail({ data }: { data: CompletedResponse }) {
  const { batch } = data
  const bs = batch.batchStats
  const pnlNum = typeof bs.pnlTotal === 'number' ? (bs.pnlTotal as number) : null
  const pnl = pnlNum !== null ? pnlNum.toFixed(2) : ''
  const pnlClass = pnlNum === null ? '' : pnlNum < 0 ? 'text-bad' : 'text-good'
  const wr = typeof bs.winRatePctStr === 'string' ? `${bs.winRatePctStr}%` : ''
  const trades = typeof bs.tradesTotal === 'number' ? String(bs.tradesTotal) : ''
  const totalMarkets = typeof bs.marketsTotal === 'number' ? String(bs.marketsTotal) : ''
  const played = typeof bs.marketsPlayed === 'number' ? String(bs.marketsPlayed) : ''

  const marketStats = batch.marketStats ?? []
  const failed = batch.failedMarkets ?? []
  const cbs = batch.chunkedBatchStats
  const segmentsHead = cbs && (cbs as { segments?: unknown }).segments
  const segmentsList = Array.isArray(segmentsHead)
    ? (segmentsHead[0] as { window?: unknown; segments?: unknown[] })
    : null
  const segments =
    segmentsList && Array.isArray(segmentsList.segments)
      ? (segmentsList.segments as Array<Record<string, unknown>>)
      : Array.isArray(segmentsHead)
        ? (segmentsHead as Array<Record<string, unknown>>)
        : []

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4 mb-6">
        <StatCard label="Strategy" value={<span className="text-base">{batch.strategy}</span>} />
        <StatCard label="Comment" value={<span className="text-sm">{batch.comment ?? ''}</span>} />
        <StatCard label="PnL total" value={<span className={`text-3xl ${pnlClass}`}>{pnl}</span>} />
        <StatCard label="Win rate" value={wr} />
        <StatCard label="Markets played" value={`${played} / ${totalMarkets}`} />
        <StatCard label="Total trades" value={trades} />
      </div>

      {segments.length > 0 && (
        <>
          <h3 className="text-base font-semibold mt-6 mb-2">
            Chunked segments (window {String(segmentsList?.window ?? '?')})
          </h3>
          <Card className="p-0 overflow-hidden mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted text-left">
                  <th className="font-medium px-3 py-2">idx range</th>
                  <th className="font-medium px-3 py-2">pnl</th>
                  <th className="font-medium px-3 py-2">win rate</th>
                  <th className="font-medium px-3 py-2">trades</th>
                </tr>
              </thead>
              <tbody>
                {segments.map((s, i) => {
                  const sp = typeof s.pnlTotal === 'number' ? (s.pnlTotal as number) : null
                  const cls = sp === null ? '' : sp < 0 ? 'text-bad' : 'text-good'
                  return (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2 font-mono">
                        {String(s.from ?? '')}–{String(s.to ?? '')}
                      </td>
                      <td className={`px-3 py-2 tabular-nums ${cls}`}>
                        {sp !== null ? sp.toFixed(2) : ''}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {typeof s.winRatePctStr === 'string' ? `${s.winRatePctStr}%` : ''}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{String(s.tradesTotal ?? '')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}

      <h3 className="text-base font-semibold mt-6 mb-1">Per-market ({marketStats.length})</h3>
      <p className="text-muted text-[11px] mb-2">
        Rows where duration &gt; 10s are flagged in red.
      </p>
      <Card className="p-0 overflow-auto max-h-[600px]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card">
            <tr className="text-muted text-left">
              <th className="font-medium px-3 py-2">idx</th>
              <th className="font-medium px-3 py-2">slug</th>
              <th className="font-medium px-3 py-2">outcome</th>
              <th className="font-medium px-3 py-2">pnl</th>
              <th className="font-medium px-3 py-2">trades</th>
              <th className="font-medium px-3 py-2">worker</th>
              <th className="font-medium px-3 py-2">duration</th>
              <th className="font-medium px-3 py-2">events</th>
            </tr>
          </thead>
          <tbody>
            {marketStats.map((m, i) => {
              const exec = m.execution
              const slow = exec && exec.durationMs > 10_000
              const pnlClass = m.pnl > 0 ? 'text-good' : m.pnl < 0 ? 'text-bad' : ''
              return (
                <tr key={i} className="border-t border-border">
                  <td className="px-3 py-2 tabular-nums">{i}</td>
                  <td className="px-3 py-2 font-mono text-xs">{m.slug ?? ''}</td>
                  <td className="px-3 py-2">{String(m.finalOutcome ?? '')}</td>
                  <td className={`px-3 py-2 tabular-nums ${pnlClass}`}>{m.pnl.toFixed(2)}</td>
                  <td className="px-3 py-2 tabular-nums">{m.tradeCount}</td>
                  <td className="px-3 py-2 text-xs">{exec?.workerName ?? ''}</td>
                  <td className={`px-3 py-2 tabular-nums ${slow ? 'text-bad' : ''}`}>
                    {exec ? `${exec.durationMs} ms` : ''}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {exec ? exec.eventsProcessed.toLocaleString() : ''}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>

      {failed.length > 0 && (
        <>
          <h3 className="text-base font-semibold mt-6 mb-2">Failed markets ({failed.length})</h3>
          <Card className="p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted text-left">
                  <th className="font-medium px-3 py-2">idx</th>
                  <th className="font-medium px-3 py-2">slug</th>
                  <th className="font-medium px-3 py-2">reason</th>
                </tr>
              </thead>
              <tbody>
                {failed.slice(0, 100).map((f, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-2 tabular-nums">{f.idx ?? ''}</td>
                    <td className="px-3 py-2 font-mono text-xs">{f.slug ?? ''}</td>
                    <td className="px-3 py-2 text-bad">{f.reason.slice(0, 200)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  )
}
