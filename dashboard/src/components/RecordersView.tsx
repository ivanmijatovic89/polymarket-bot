'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Radio, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Skeleton } from './ui/skeleton'
import type { RecorderEntry, RecordersReport } from '@/lib/queries/recorders'
import { RECORDER_OFFLINE_AFTER_MS } from '@bot/recorder-v4/statusTypes'
import type { OpeningReferenceSnapshot } from '@bot/trading/feeds/externalFeeds'

async function fetchRecorders(): Promise<RecordersReport> {
  const response = await fetch('/api/recorders', {
    cache: 'no-store',
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok)
    throw new Error('Recorder monitoring is unavailable. Status cannot be confirmed.')
  return response.json()
}

function bytes(value: number): string {
  return `${(value / 1024 ** 3).toFixed(2)} GiB`
}
function age(time: number | null, now: number): string {
  if (time === null) return 'No observation'
  const seconds = Math.max(0, Math.round((now - time) / 1000))
  return seconds < 60
    ? `${seconds}s ago`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m ago`
      : `${Math.floor(seconds / 3600)}h ago`
}
const feedNames: Record<string, string> = {
  polymarket: 'Polymarket books',
  binance_agg_trade: 'Binance trades',
  binance_book_ticker: 'Binance bid / ask',
  chainlink_spot: 'Chainlink spot',
  chainlink_twap: 'Chainlink TWAP',
  price_to_beat: 'Price to beat',
}

export function RecordersView() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['recorders'],
    queryFn: fetchRecorders,
    refetchInterval: 5_000,
    retry: false,
  })
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <p>Refreshes every 5 seconds. A heartbeat older than 30 seconds is offline.</p>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-2 hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
      {isError && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error.message} Any figures below are the last received report.
        </div>
      )}
      {isLoading && <Skeleton className="h-64 w-full" />}
      {data && data.recorders.length === 0 && !isError && (
        <Card>
          <CardContent className="py-10 text-center">
            <Radio className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
            <p className="font-medium">No recorders registered yet</p>
            <p className="mt-2 text-xs text-muted-foreground">
              A recorder appears here after its first dashboard heartbeat.
            </p>
          </CardContent>
        </Card>
      )}
      {data?.recorders.map((entry) => (
        <RecorderCard
          key={entry.recorderId}
          entry={entry}
          now={now}
          monitoringUnavailable={isError}
        />
      ))}
    </div>
  )
}

function RecorderCard({
  entry,
  now,
  monitoringUnavailable,
}: {
  entry: RecorderEntry
  now: number
  monitoringUnavailable: boolean
}) {
  const status = entry.status
  const online =
    !monitoringUnavailable &&
    entry.online &&
    !!status &&
    now - status.updatedAtMs <= RECORDER_OFFLINE_AFTER_MS
  const label = monitoringUnavailable
    ? 'Unknown'
    : !online
      ? 'Offline'
      : status?.state === 'recording'
        ? 'Recording'
        : (status?.state ?? 'Unknown')
  const tone = !online ? 'destructive' : status?.state === 'recording' ? 'success' : 'warning'
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">{entry.recorderId}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {status
                ? `${status.host} · Last heartbeat ${age(status.updatedAtMs, now)}`
                : entry.error}
            </p>
          </div>
          <Badge variant={tone}>{label}</Badge>
        </div>
      </CardHeader>
      {status && (
        <CardContent className="space-y-6">
          {(entry.error || status.reason) && (
            <p className="rounded-md bg-muted p-3 text-sm">{entry.error ?? status.reason}</p>
          )}
          <div className="grid grid-cols-2 gap-4 text-xs sm:grid-cols-4">
            <Metric
              label="Local spool"
              value={`${bytes(status.spool.bytes)} / ${bytes(status.spool.maxBytes)}`}
            />
            <Metric
              label="Free disk"
              value={`${bytes(status.spool.freeBytes)} · floor ${bytes(status.spool.minFreeBytes)}`}
            />
            <Metric
              label="Uploads pending"
              value={
                status.archive.enabled ? String(status.archive.pendingMarkets) : 'Archival disabled'
              }
            />
            <Metric label="Resolutions pending" value={String(status.resolution.pending)} />
            <Metric label="Last verified upload" value={age(status.archive.lastSuccessAtMs, now)} />
            <Metric label="Capture backlog" value={`${status.spool.pendingWrites} writes`} />
            <Metric
              label="Capture memory / CPU"
              value={`${bytes(status.metrics.rssBytes)} / ${status.metrics.cpuPercent.toFixed(1)}%`}
            />
            <Metric
              label="Event loop delay"
              value={`${status.metrics.eventLoopLagMs.toFixed(1)} ms`}
            />
          </div>
          {(status.archive.lastError || status.resolution.lastError) && (
            <div
              role="alert"
              className="space-y-1 rounded-md border border-destructive/30 p-3 text-xs text-destructive"
            >
              {status.archive.lastError && <p>Upload: {status.archive.lastError}</p>}
              {status.resolution.lastError && <p>Resolution: {status.resolution.lastError}</p>}
            </div>
          )}
          <section>
            <h2 className="mb-2 text-sm font-medium">Active and subscribed markets</h2>
            <div className="space-y-2">
              {status.markets.length === 0 && (
                <p className="text-xs text-muted-foreground">No markets in the last report.</p>
              )}
              {status.markets.map((market) => (
                <div
                  key={market.slug}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-xs"
                >
                  <div>
                    <span className="font-medium">BTC {market.timeframe}</span>
                    <p className="mt-1 break-all text-muted-foreground">{market.slug}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={online && market.active ? 'success' : 'secondary'}>
                      {online ? (market.active ? 'Capturing' : 'Subscribed') : 'Last reported'}
                    </Badge>
                    <Badge variant={market.booksReady ? 'secondary' : 'warning'}>
                      {market.booksReady ? 'Books ready' : 'Awaiting books'}
                    </Badge>
                    <Badge variant={market.gaps ? 'warning' : 'secondary'}>
                      {market.gaps ? `${market.gaps} gaps` : 'No observed gaps'}
                    </Badge>
                    <span className="self-center tabular-nums text-muted-foreground">
                      {market.rows.toLocaleString()} rows
                    </span>
                  </div>
                  <div className="w-full border-t pt-2">
                    <OpeningReference reference={market.openingReference} now={now} />
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-medium">Feeds</h2>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Feed</TableHead>
                    <TableHead>Connection</TableHead>
                    <TableHead>Last observation</TableHead>
                    <TableHead className="text-right">Messages</TableHead>
                    <TableHead className="text-right">Reconnects</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {status.feeds.map((feed) => (
                    <TableRow key={feed.feed}>
                      <TableCell>{feedNames[feed.feed] ?? feed.feed}</TableCell>
                      <TableCell className="text-xs">
                        {online ? feed.state : `Last: ${feed.state}`}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {age(feed.lastReceivedAtMs, now)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {feed.messages.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{feed.reconnects}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-medium">Recent market packages</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Coverage and resolution are separate. Backtests check gaps only in the feeds the
              strategy requires.
            </p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Market</TableHead>
                    <TableHead>Coverage</TableHead>
                    <TableHead>Resolution</TableHead>
                    <TableHead>R2 archive</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {status.recentMarkets.slice(0, 12).map((market) => (
                    <TableRow key={market.slug}>
                      <TableCell className="text-xs">
                        <span className="font-medium">BTC {market.timeframe}</span>
                        <p className="mt-1 max-w-56 break-all text-muted-foreground">
                          {market.slug}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={market.complete ? 'success' : 'warning'}>
                          {market.complete
                            ? 'No observed gaps'
                            : `${market.gaps} gaps / incomplete`}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{market.resolution}</TableCell>
                      <TableCell className="max-w-72 text-xs">
                        {market.manifestKey ? (
                          <details>
                            <summary className="cursor-pointer text-[color:var(--success)]">
                              Verified upload
                            </summary>
                            <code className="mt-2 block break-all text-muted-foreground">
                              {market.manifestKey}
                            </code>
                          </details>
                        ) : (
                          'Pending upload'
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {status.recentMarkets.length === 0 && (
              <p className="py-3 text-xs text-muted-foreground">
                No finalized markets in the last report.
              </p>
            )}
          </section>
        </CardContent>
      )}
    </Card>
  )
}

function OpeningReference({
  reference,
  now,
}: {
  reference: OpeningReferenceSnapshot | undefined
  now: number
}) {
  if (!reference)
    return <p className="text-muted-foreground">Opening TWAP: not reported by this recorder.</p>
  const labels: Record<OpeningReferenceSnapshot['comparison'], string> = {
    unavailable: 'Opening TWAP unavailable',
    'waiting-for-website': 'Awaiting website comparison',
    match: 'Matches website PTB',
    mismatch: 'Website PTB differs',
    'conflicting-twap': 'Conflicting opening TWAPs',
  }
  const { observation, website, conflict, comparison } = reference
  const conflicting = comparison === 'conflicting-twap'
  const conflictCount = reference.conflictCount ?? 0
  const price = (value: number): string =>
    value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium tabular-nums">
          Opening TWAP: {observation ? `$${price(observation.openPrice)}` : 'Unavailable'}
        </span>
        <Badge
          variant={conflicting ? 'destructive' : comparison === 'match' ? 'success' : 'warning'}
        >
          {labels[comparison]}
        </Badge>
        {conflictCount > 0 && (
          <Badge variant="warning">
            {conflictCount} TWAP {conflictCount === 1 ? 'conflict' : 'conflicts'} in this capture
            session
          </Badge>
        )}
      </div>
      {observation && (
        <p className="text-muted-foreground">
          Chainlink 60-second TWAP at market opening · Received {age(observation.receivedAtMs, now)}
        </p>
      )}
      <p className="text-muted-foreground">
        Website PTB:{' '}
        {website
          ? `$${price(website.openPrice)} · Received ${age(website.receivedAtMs, now)}`
          : 'Not observed'}
      </p>
      {comparison === 'mismatch' && (
        <p className="text-muted-foreground">
          Website PTB differs; TWAP mode keeps the selected Chainlink observation.
        </p>
      )}
      {conflicting && (
        <p className="text-destructive">
          Opening reference is uncertain. Normal backtests requiring it exclude this market.
        </p>
      )}
      {!conflicting && conflictCount > 0 && (
        <p className="text-destructive">
          A previous opening TWAP conflict excludes this market from ordinary TWAP backtests. The
          recovered value may be used in explicit outage replay.
        </p>
      )}
      {(observation || website || conflict) && (
        <details className="text-muted-foreground">
          <summary className="cursor-pointer">Observation details</summary>
          <div className="mt-2 space-y-1 break-all">
            {observation && (
              <>
                <p>
                  Source: {observation.source} · Source time:{' '}
                  {new Date(observation.sourceTimestampMs).toISOString()}
                </p>
                <p>
                  Received: {new Date(observation.receivedAtMs).toISOString()} · Event:{' '}
                  {observation.eventId}
                </p>
                <p>Full accuracy value: {observation.fullAccuracyValue}</p>
                <p>
                  Session: {observation.sessionId} · Connection: {observation.connectionId}
                </p>
              </>
            )}
            {website && (
              <p>
                Website received: {new Date(website.receivedAtMs).toISOString()} · Event:{' '}
                {website.eventId}
              </p>
            )}
            {conflict && (
              <p>
                Conflicting value: {conflict.fullAccuracyValue} · Received:{' '}
                {new Date(conflict.receivedAtMs).toISOString()} · Event: {conflict.eventId}
              </p>
            )}
          </div>
        </details>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium tabular-nums">{value}</p>
    </div>
  )
}
