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

function compactInt(n: number): string {
  if (n < 1000) return n.toLocaleString()
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}m`
}

/**
 * Fixed-width, right-aligned numeric slot. Composite cells (Markets, EV/mkt,
 * Trades, Avg W/L, Streak, Quality) pack several sub-values; rendering each in
 * a `ch`-sized slot inside a `font-mono` cell makes every sub-value land at the
 * same x-offset across rows, so the column scans cleanly top-to-bottom instead
 * of the numbers drifting with content width. `ch` == one monospace character.
 */
function Slot({ children, ch, className }: { children: ReactNode; ch: number; className?: string }) {
  return (
    <span className={cn('inline-block text-right', className)} style={{ width: `${ch}ch` }}>
      {children}
    </span>
  )
}

/** Muted, tight separator between slots (mono → same width per row). Kept
 * narrow (small margins, no full spaces) so a cell reads as one grouped value
 * rather than several loose columns. */
function Sep({ char = '·' }: { char?: string }) {
  return <span className="mx-0.5 text-muted-foreground/50">{char}</span>
}

/** Small lower-case second line under a column header naming its sub-values,
 * in the same order as the cell's slots. */
function Hint({ children }: { children: ReactNode }) {
  return (
    <span className="block text-[9px] font-normal normal-case leading-tight tracking-normal text-muted-foreground/70">
      {children}
    </span>
  )
}

/** Two right-aligned numeric slots joined by a slash — the shared shape of the
 * EV/mkt, Avg W/L and Quality cells. Slots are sized snug to the column's real
 * max so small values don't float far from the slash. */
function PairCell({
  a,
  b,
  ch = 6,
  className,
}: {
  a: string
  b: string
  ch?: number
  className?: string
}) {
  return (
    <span className={cn('font-mono text-xs tabular-nums', className)}>
      <Slot ch={ch}>{a}</Slot>
      <Sep char="/" />
      <Slot ch={ch} className="text-muted-foreground">
        {b}
      </Slot>
    </span>
  )
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
        <TableCell className="text-right whitespace-nowrap font-mono text-xs tabular-nums">
          {notPersisted && (
            <span
              className="mr-2 text-destructive"
              title={
                b.failuresCount && b.failuresCount > 0
                  ? `${b.failuresCount} markets failed`
                  : `${(b.inputMarketsTotal ?? 0) - b.marketsTotal} markets not persisted`
              }
            >
              {b.failuresCount && b.failuresCount > 0
                ? `${b.failuresCount} failed`
                : `${(b.inputMarketsTotal ?? 0) - b.marketsTotal} missing`}
            </span>
          )}
          <Slot ch={5}>{selectedMarketsTotal}</Slot>
          <Sep />
          <Slot ch={5} className="text-muted-foreground">
            {b.marketsPlayed}
          </Slot>
          <Sep />
          <Slot ch={5} className="text-muted-foreground">
            {b.marketsSkipped}
          </Slot>
        </TableCell>
        <TableCell className="text-right whitespace-nowrap">
          <PairCell a={formatPnl(b.evPerMarketPlayed)} b={formatPnl(b.evPerMarketTotal)} />
        </TableCell>
        <TableCell className="text-right whitespace-nowrap font-mono text-xs tabular-nums">
          <Slot ch={5}>{compactInt(b.tradesTotal)}</Slot>
          {b.tradesMaker + b.tradesTaker > 0 && (
            <>
              <Sep />
              <Slot ch={9} className="text-muted-foreground">
                {`${compactInt(b.tradesMaker)}m/${compactInt(b.tradesTaker)}t`}
              </Slot>
            </>
          )}
        </TableCell>
        <TableCell className={cn('text-right font-mono text-xs tabular-nums font-medium', pnlTone)}>
          <span className="inline-flex items-center justify-end gap-1">
            <Trend className="h-3.5 w-3.5 shrink-0" />
            <Slot ch={8}>{formatPnl(pnlNum)}</Slot>
          </span>
        </TableCell>
        <TableCell className="text-right font-mono text-xs tabular-nums">{wr}</TableCell>
        <TableCell className="text-right whitespace-nowrap text-muted-foreground">
          <PairCell a={formatPnl(b.pnlAvgWin)} b={formatPnl(b.pnlAvgLose)} />
        </TableCell>
        <TableCell className="text-right whitespace-nowrap font-mono text-xs tabular-nums">
          <Slot ch={3} className="text-[color:var(--success)]">
            {b.streakMaxWin}W
          </Slot>
          <Slot ch={7} className="text-[color:var(--success)]">
            {formatPnl(b.streakMaxWinPnl)}
          </Slot>
          <Sep char="/" />
          <Slot ch={3} className="text-destructive">
            {b.streakMaxLose}L
          </Slot>
          <Slot ch={7} className="text-destructive">
            {formatPnl(b.streakMaxLosePnl)}
          </Slot>
        </TableCell>
        <TableCell className="text-right whitespace-nowrap text-muted-foreground">
          <PairCell
            a={qS === null ? '—' : qS.toFixed(2)}
            b={qT === null ? '—' : qT.toFixed(2)}
            ch={5}
          />
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
            <TableRow>
              {prefixColumns?.map((c, i) => (
                <TableHead key={i} className={c.align === 'right' ? 'text-right' : undefined}>
                  {c.header}
                </TableHead>
              ))}
              <TableHead className="min-w-[180px]">{leadingHeader}</TableHead>
              <TableHead>Strategy</TableHead>
              <TableHead className="text-right">
                Markets
                <Hint>total · played · skip</Hint>
              </TableHead>
              <TableHead className="text-right">
                EV/mkt
                <Hint>played / total</Hint>
              </TableHead>
              <TableHead className="text-right">
                Trades
                <Hint>total · maker/taker</Hint>
              </TableHead>
              <TableHead className="text-right">PnL</TableHead>
              <TableHead className="text-right">Win&nbsp;rate</TableHead>
              <TableHead className="text-right">
                Avg&nbsp;W/L
                <Hint>win / lose</Hint>
              </TableHead>
              <TableHead className="text-right">
                Streak
                <Hint>win / lose</Hint>
              </TableHead>
              <TableHead className="text-right">
                Quality
                <Hint>sys / trade</Hint>
              </TableHead>
              <TableHead className="text-right">Fees</TableHead>
              <TableHead>Symbol</TableHead>
              <TableHead className="text-right">Duration</TableHead>
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
