import {
  getRecorderV4DatasetCoverage,
  recorderV4DatasetRange,
} from '@/lib/queries/recorderV4Catalog'
import { StatCard } from '@/components/StatCard'
import { Badge } from '@/components/ui/badge'

export async function RecorderV4Datasets({
  timeframe,
  from,
  to,
}: {
  timeframe: '5m' | '15m'
  from?: string
  to?: string
}) {
  let data: Awaited<ReturnType<typeof getRecorderV4DatasetCoverage>>
  try {
    const range = recorderV4DatasetRange(from, to)
    data = await getRecorderV4DatasetCoverage(timeframe, range.fromMs, range.toMs)
  } catch (error) {
    return (
      <div className="rounded-xl border p-6 text-sm">
        Recorder V4 coverage unavailable:{' '}
        {error instanceof Error ? error.message : 'Could not read the archive catalog.'}
      </div>
    )
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Recorder V4 datasets</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Finalized BTC packages in the production archive. Orderbook eligibility includes official
          resolution. Strategies requiring external feeds apply additional checks before launch.
        </p>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <input type="hidden" name="source" value="recorder-v4" />
        <label className="text-xs">
          Timeframe
          <select
            name="timeframe"
            defaultValue={timeframe}
            className="ml-2 rounded border bg-background p-2"
          >
            <option value="5m">5m</option>
            <option value="15m">15m</option>
          </select>
        </label>
        <label className="text-xs">
          From (UTC)
          <input
            name="from"
            type="date"
            defaultValue={new Date(data.fromMs).toISOString().slice(0, 10)}
            className="ml-2 rounded border bg-background p-2"
          />
        </label>
        <label className="text-xs">
          To (UTC)
          <input
            name="to"
            type="date"
            defaultValue={new Date(data.toMs).toISOString().slice(0, 10)}
            className="ml-2 rounded border bg-background p-2"
          />
        </label>
        <button className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground">
          Apply
        </button>
      </form>
      <p className="text-xs text-muted-foreground">
        Last seven days by default; choose up to 31 days. The end date includes the full UTC day.
        Catalog metadata is cached for five minutes. This view reads manifests and resolution
        records, never event Parquet files.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Recordings"
          value={data.summary.candidates.toLocaleString()}
          hint={`BTC ${timeframe}`}
        />
        <StatCard
          label="Orderbook eligible"
          value={data.summary.eligible.toLocaleString()}
          hint="Resolved and complete required coverage"
        />
        <StatCard
          label="Excluded"
          value={data.summary.excluded.toLocaleString()}
          hint="Reasons shown for each recording"
        />
      </div>
      <div className="max-h-[640px] overflow-auto rounded-xl border">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-card">
            <tr>
              {[
                'Market / recording',
                'Events',
                'Size',
                'Feed gaps',
                'Resolution',
                'Orderbook eligibility',
              ].map((label) => (
                <th key={label} className="p-3">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={`${row.slug}/${row.recordingId}`} className="border-t">
                <td className="p-3 font-mono">
                  {row.slug}
                  <span className="mt-1 block text-[10px] text-muted-foreground">
                    {row.recordingId}
                  </span>
                </td>
                <td className="p-3">{row.events.toLocaleString()}</td>
                <td className="p-3">{(row.bytes / 1024 ** 2).toFixed(2)} MiB</td>
                <td className="p-3">{row.gaps}</td>
                <td className="p-3">{row.resolved ? 'Official result available' : 'Pending'}</td>
                <td className="p-3">
                  <Badge variant={row.eligible ? 'success' : 'warning'}>
                    {row.eligible ? 'Eligible' : 'Excluded'}
                  </Badge>
                  {row.reasons.map((reason) => (
                    <div key={reason} className="mt-1 text-muted-foreground">
                      {reason}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.rows.length && (
          <p className="p-6 text-sm text-muted-foreground">
            No committed V4 packages in this range.
          </p>
        )}
      </div>
    </div>
  )
}
