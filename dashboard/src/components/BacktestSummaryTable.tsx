import type { ReactNode } from 'react'
import { History, TrendingDown, TrendingUp } from 'lucide-react'
import { Card } from './ui/card'
import { Badge } from './ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { cn, formatPnl } from '@/lib/utils'
import { ParamsTooltip } from './ParamsTooltip'

/**
 * Subset of fields that describe a "backtest-like aggregate" — used by both
 * finalized backtest summaries and live-computed chunked segments.
 * Identity (id / batchUid / chunk index) is NOT in this shape — callers
 * supply that via `renderLeading`.
 */
export type BacktestSummary = {
  status?: 'completed' | 'partial' | 'failed'
  strategy?: string
  /** Strategy params — surfaced as a hover tooltip on the Strategy cell. */
  params?: Record<string, unknown> | null
  symbol?: string | null
  limit?: number | null
  inputMarketsTotal?: number | null
  marketsTotal: number
  marketsPlayed: number
  marketsSkipped: number
  failuresCount?: number
  pnlTotal: number
  winRatePct: number
  pnlAvgWin: number
  pnlAvgLose: number
  evPerMarketPlayed: number
  evPerMarketTotal: number
  streakMaxWin: number
  streakMaxLose: number
  streakMaxWinPnl: number
  streakMaxLosePnl: number
  qualitySystem: number | null
  qualityTrade: number | null
  totalFeesPaid: number
  tradesTotal: number
  tradesMaker: number
  tradesTaker: number
  /** Sum of per-market backtest compute time (ms). Null until backfilled. */
  durationTotalMs?: number | null
  /** Mean per-market compute time (ms). Null until backfilled. */
  durationAvgMs?: number | null
  /** Real elapsed wall-clock of the run (ms). Null until backfilled. */
  durationWallClockMs?: number | null
}

export type BacktestSummaryTableProps<T extends BacktestSummary> = {
  rows: T[]
  /** Optional columns rendered before the leading identity column. */
  prefixColumns?: {
    header: ReactNode
    render: (row: T, index: number) => ReactNode
    align?: 'left' | 'right'
  }[]
  /** First-column renderer — identity / label / link. */
  renderLeading: (row: T, index: number) => ReactNode
  /** Optional last-column renderer — actions (CMD button, arrow, etc.).
   * Omit to skip the actions column entirely. */
  renderActions?: (row: T, index: number) => ReactNode
  /** Header label of the leading column. Defaults to "Batch". */
  leadingHeader?: string
  /** Empty-state copy when `rows.length === 0`. */
  emptyTitle?: string
  emptyHint?: string
  /** Optional extra columns appended before the actions column. */
  extraColumns?: {
    header: ReactNode
    render: (row: T, index: number) => ReactNode
    align?: 'left' | 'right'
  }[]
  /** Optional pinned summary row at the bottom — useful for "totals across rows". */
  footerRow?: {
    row: T
    renderLeading: ReactNode
    /** What to render inside any extraColumns / actions cells of the footer.
     * Defaults to using the regular extraColumns.render(row, -1). */
    renderActions?: ReactNode
  }
}

function pair(a: number, b: number): string {
  return `${formatPnl(a)} / ${formatPnl(b)}`
}

function compactInt(n: number): string {
  if (n < 1000) return n.toLocaleString()
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}m`
}

/** Human-readable duration from milliseconds. */
function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

/**
 * Pure presentational table. No data fetching, no client-only hooks.
 * Feed it rows + identity/actions renderers; reuse anywhere.
 */
export function BacktestSummaryTable<T extends BacktestSummary>({
  rows,
  prefixColumns,
  renderLeading,
  renderActions,
  leadingHeader = 'Batch',
  emptyTitle = 'No backtests found',
  emptyHint = 'Past runs will appear here.',
  extraColumns,
  footerRow,
}: BacktestSummaryTableProps<T>) {
  function renderDataRow(
    b: T,
    i: number,
    isFooter: boolean,
    footerLeading?: ReactNode,
    footerActions?: ReactNode,
  ) {
    const pnlNum = b.pnlTotal
    const wr = `${b.winRatePct.toFixed(2)}%`
    const pnlTone = pnlNum >= 0 ? 'text-[color:var(--success)]' : 'text-destructive'
    const Trend = pnlNum >= 0 ? TrendingUp : TrendingDown
    const qS = b.qualitySystem
    const qT = b.qualityTrade
    // `inputMarketsTotal` is the original `--limit` and is NOT updated by
    // `--extend`, so on extended runs it's stale (smaller than the real total).
    // The true total = played + skipped = `marketsTotal`. Use the larger of the
    // two so the denominator is correct for extended runs while still exposing
    // genuinely-missing markets (input > persisted) via `notPersisted` below.
    const selectedMarketsTotal = Math.max(b.inputMarketsTotal ?? 0, b.marketsTotal)
    const notPersisted = (b.inputMarketsTotal ?? 0) > b.marketsTotal
    const quality =
      qS === null && qT === null
        ? '—'
        : `${qS === null ? '—' : qS.toFixed(2)} / ${qT === null ? '—' : qT.toFixed(2)}`
    const rowCls = isFooter
      ? 'border-t-2 border-foreground/20 bg-muted/30 font-medium hover:bg-muted/30'
      : ''
    return (
      <TableRow key={isFooter ? 'footer' : i} className={rowCls}>
        {prefixColumns?.map((c, j) => (
          <TableCell key={j} className={c.align === 'right' ? 'text-right' : undefined}>
            {isFooter ? null : c.render(b, i)}
          </TableCell>
        ))}
        <TableCell>{isFooter ? footerLeading : renderLeading(b, i)}</TableCell>
        <TableCell className="text-sm">
          <ParamsTooltip strategy={b.strategy ?? '—'} params={b.params} />
        </TableCell>
        {/* Markets → Total / Played / Skip sub-columns (grouped header) */}
        <TableCell className="text-right tabular-nums text-xs whitespace-nowrap">
          {selectedMarketsTotal}
          {notPersisted && (
            <div
              className="text-[10px] leading-tight text-destructive"
              title={
                b.failuresCount && b.failuresCount > 0
                  ? `${b.failuresCount} markets failed`
                  : `${(b.inputMarketsTotal ?? 0) - b.marketsTotal} markets not persisted`
              }
            >
              {b.failuresCount && b.failuresCount > 0
                ? `${b.failuresCount} failed`
                : `${(b.inputMarketsTotal ?? 0) - b.marketsTotal} missing`}
            </div>
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums text-xs whitespace-nowrap text-muted-foreground">
          {b.marketsPlayed}
        </TableCell>
        <TableCell className="text-right tabular-nums text-xs whitespace-nowrap text-muted-foreground">
          {b.marketsSkipped}
        </TableCell>
        <TableCell className="text-right tabular-nums text-xs whitespace-nowrap">
          {formatPnl(b.evPerMarketPlayed)}
          <span className="text-muted-foreground">
            {' / '}
            {formatPnl(b.evPerMarketTotal)}
          </span>
        </TableCell>
        <TableCell className="text-right tabular-nums text-xs whitespace-nowrap">
          {compactInt(b.tradesTotal)}
          {b.tradesMaker + b.tradesTaker > 0 && (
            <span className="ml-1 text-[11px] text-muted-foreground">
              · {compactInt(b.tradesMaker)}m/{compactInt(b.tradesTaker)}t
            </span>
          )}
        </TableCell>
        <TableCell className={cn('text-right tabular-nums font-medium', pnlTone)}>
          <span className="inline-flex items-center justify-end gap-1">
            <Trend className="h-3.5 w-3.5" />
            {formatPnl(pnlNum)}
          </span>
        </TableCell>
        <TableCell className="text-right tabular-nums">{wr}</TableCell>
        <TableCell className="text-right tabular-nums text-xs text-muted-foreground whitespace-nowrap">
          {pair(b.pnlAvgWin, b.pnlAvgLose)}
        </TableCell>
        <TableCell className="text-right tabular-nums text-xs text-muted-foreground whitespace-nowrap">
          <span className="text-[color:var(--success)]">
            {b.streakMaxWin}W&nbsp;{formatPnl(b.streakMaxWinPnl)}
          </span>
          {' / '}
          <span className="text-destructive">
            {b.streakMaxLose}L&nbsp;{formatPnl(b.streakMaxLosePnl)}
          </span>
        </TableCell>
        <TableCell className="text-right tabular-nums text-xs text-muted-foreground whitespace-nowrap">
          {quality}
        </TableCell>
        <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
          {b.totalFeesPaid.toFixed(2)}
        </TableCell>
        <TableCell>
          {b.symbol ? (
            <Badge variant="outline" className="uppercase">
              {b.symbol}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums text-xs text-muted-foreground whitespace-nowrap">
          {(() => {
            // Headline = wall-clock (real elapsed), matching the run detail
            // page's Execution card. Fall back to total CPU time if wall-clock
            // wasn't recorded. Subtitle = mean CPU time per market.
            const wall = b.durationWallClockMs
            const total = b.durationTotalMs
            const headline = wall ?? total
            if (headline == null) return <span className="text-muted-foreground/50">—</span>
            // Wall-clock far above summed CPU time ⇒ idle gaps (e.g. --extend).
            const spansGaps = wall != null && total != null && wall > total
            return (
              <>
                {formatDurationMs(headline)}
                {spansGaps && (
                  <span
                    className="ml-0.5 text-[color:var(--warning)]"
                    title="wall-clock includes idle gaps (extended run)"
                  >
                    *
                  </span>
                )}
                {b.durationAvgMs != null && (
                  <span className="ml-1 text-[11px] text-muted-foreground/70">
                    · {formatDurationMs(b.durationAvgMs)}/mkt
                  </span>
                )}
              </>
            )
          })()}
        </TableCell>
        {extraColumns?.map((c, j) => (
          <TableCell key={j} className={c.align === 'right' ? 'text-right' : undefined}>
            {c.render(b, i)}
          </TableCell>
        ))}
        {renderActions && (
          <TableCell className="whitespace-nowrap">
            {isFooter ? (footerActions ?? null) : renderActions(b, i)}
          </TableCell>
        )}
      </TableRow>
    )
  }

  if (rows.length === 0) {
    return (
      <Card className="px-6 py-12 text-center">
        <History className="mx-auto h-10 w-10 text-muted-foreground/40" />
        <h3 className="mt-3 text-sm font-medium">{emptyTitle}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{emptyHint}</p>
      </Card>
    )
  }
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-b-0 hover:bg-transparent">
              {prefixColumns?.map((c, i) => (
                <TableHead
                  key={i}
                  rowSpan={2}
                  className={c.align === 'right' ? 'text-right' : undefined}
                >
                  {c.header}
                </TableHead>
              ))}
              <TableHead rowSpan={2} className="min-w-[180px]">
                {leadingHeader}
              </TableHead>
              <TableHead rowSpan={2}>Strategy</TableHead>
              <TableHead colSpan={3} className="border-b border-border/60 text-center">
                Markets
              </TableHead>
              <TableHead rowSpan={2} className="text-right">
                EV/mkt
              </TableHead>
              <TableHead rowSpan={2} className="text-right">
                Trades
              </TableHead>
              <TableHead rowSpan={2} className="text-right">
                PnL
              </TableHead>
              <TableHead rowSpan={2} className="text-right">
                Win&nbsp;rate
              </TableHead>
              <TableHead rowSpan={2} className="text-right">
                Avg&nbsp;W/L
              </TableHead>
              <TableHead rowSpan={2} className="text-right">
                Streak
              </TableHead>
              <TableHead rowSpan={2} className="text-right">
                Quality
              </TableHead>
              <TableHead rowSpan={2} className="text-right">
                Fees
              </TableHead>
              <TableHead rowSpan={2}>Symbol</TableHead>
              <TableHead rowSpan={2} className="text-right">
                Duration
              </TableHead>
              {extraColumns?.map((c, i) => (
                <TableHead
                  key={i}
                  rowSpan={2}
                  className={c.align === 'right' ? 'text-right' : undefined}
                >
                  {c.header}
                </TableHead>
              ))}
              {renderActions && <TableHead rowSpan={2} />}
            </TableRow>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8 text-right font-normal normal-case tracking-normal">
                Total
              </TableHead>
              <TableHead className="h-8 text-right font-normal normal-case tracking-normal">
                Played
              </TableHead>
              <TableHead className="h-8 text-right font-normal normal-case tracking-normal">
                Skip
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((b, i) => renderDataRow(b, i, false))}
            {footerRow &&
              renderDataRow(
                footerRow.row,
                -1,
                true,
                footerRow.renderLeading,
                footerRow.renderActions,
              )}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}
