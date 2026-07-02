import type { ReactNode } from 'react'
import { History, TrendingDown, TrendingUp } from 'lucide-react'
import { Card } from './ui/card'
import { Badge } from './ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { cn, formatPnl } from '@/lib/utils'

/**
 * Subset of fields that describe a "backtest-like aggregate" — used by both
 * finalized backtest summaries and live-computed chunked segments.
 * Identity (id / batchUid / chunk index) is NOT in this shape — callers
 * supply that via `renderLeading`.
 */
export type BacktestSummary = {
  status?: 'completed' | 'partial' | 'failed'
  strategy?: string
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
}

export type BacktestSummaryTableProps<T extends BacktestSummary> = {
  rows: T[]
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

/**
 * Pure presentational table. No data fetching, no client-only hooks.
 * Feed it rows + identity/actions renderers; reuse anywhere.
 */
export function BacktestSummaryTable<T extends BacktestSummary>({
  rows,
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
    const selectedMarketsTotal = b.inputMarketsTotal ?? b.marketsTotal
    const quality =
      qS === null && qT === null
        ? '—'
        : `${qS === null ? '—' : qS.toFixed(2)} / ${qT === null ? '—' : qT.toFixed(2)}`
    const rowCls = isFooter
      ? 'border-t-2 border-foreground/20 bg-muted/30 font-medium hover:bg-muted/30'
      : ''
    return (
      <TableRow key={isFooter ? 'footer' : i} className={rowCls}>
        <TableCell>{isFooter ? footerLeading : renderLeading(b, i)}</TableCell>
        <TableCell className="text-sm">{b.strategy ?? '—'}</TableCell>
        <TableCell>
          {b.symbol ? (
            <Badge variant="outline" className="uppercase">
              {b.symbol}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums text-xs">
          {b.limit !== null && b.limit !== undefined ? (
            b.limit
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums text-xs whitespace-nowrap">
          {b.marketsPlayed}
          <span className="text-muted-foreground">/{selectedMarketsTotal}</span>
          {b.marketsSkipped > 0 && (
            <span className="ml-1 text-[11px] text-muted-foreground">· {b.marketsSkipped} skip</span>
          )}
          {selectedMarketsTotal > b.marketsTotal && (
            <span className="ml-1 text-[11px] text-destructive">
              ·{' '}
              {b.failuresCount && b.failuresCount > 0
                ? `${b.failuresCount} failed`
                : `${selectedMarketsTotal - b.marketsTotal} not persisted`}
            </span>
          )}
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
        {extraColumns?.map((c, j) => (
          <TableCell key={j} className={c.align === 'right' ? 'text-right' : undefined}>
            {c.render(b, i)}
          </TableCell>
        ))}
        {renderActions && (
          <TableCell className="whitespace-nowrap">
            {isFooter ? footerActions ?? null : renderActions(b, i)}
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
            <TableRow>
              <TableHead className="min-w-[180px]">{leadingHeader}</TableHead>
              <TableHead>Strategy</TableHead>
              <TableHead>Symbol</TableHead>
              <TableHead className="text-right">Limit</TableHead>
              <TableHead className="text-right">Markets</TableHead>
              <TableHead className="text-right">EV/mkt</TableHead>
              <TableHead className="text-right">Trades</TableHead>
              <TableHead className="text-right">PnL</TableHead>
              <TableHead className="text-right">Win&nbsp;rate</TableHead>
              <TableHead className="text-right">Avg&nbsp;W/L</TableHead>
              <TableHead className="text-right">Streak</TableHead>
              <TableHead className="text-right">Quality</TableHead>
              <TableHead className="text-right">Fees</TableHead>
              {extraColumns?.map((c, i) => (
                <TableHead key={i} className={c.align === 'right' ? 'text-right' : undefined}>
                  {c.header}
                </TableHead>
              ))}
              {renderActions && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((b, i) => renderDataRow(b, i, false))}
            {footerRow &&
              renderDataRow(footerRow.row, -1, true, footerRow.renderLeading, footerRow.renderActions)}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}
