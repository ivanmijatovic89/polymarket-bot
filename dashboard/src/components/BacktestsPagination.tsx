'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { backtestPageBounds, backtestPageNumbers } from '@/lib/backtestBrowse'
import { cn } from '@/lib/utils'

export function BacktestsPagination({
  total,
  page,
  pageCount,
  limit,
  disabled,
  onPageChange,
  position,
}: {
  total: number
  page: number
  pageCount: number
  limit: number
  disabled: boolean
  onPageChange: (page: number) => void
  position: 'top' | 'bottom'
}) {
  const { start, end } = backtestPageBounds(total, limit, page)
  const button =
    'inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md border px-2 text-xs outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40'
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs tabular-nums text-muted-foreground" role="status">
        {start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()} backtests
      </p>
      <nav
        aria-label={`Backtest pagination ${position}`}
        className="flex flex-wrap items-center gap-1"
      >
        <button
          type="button"
          className={button}
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Previous</span>
        </button>
        {backtestPageNumbers(page, pageCount).map((item, index) =>
          item === 'ellipsis' ? (
            <span
              key={`ellipsis-${index}`}
              className="px-1 text-xs text-muted-foreground"
              aria-hidden="true"
            >
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              className={cn(button, item === page && 'border-foreground/30 bg-accent font-medium')}
              aria-label={`Page ${item}`}
              aria-current={item === page ? 'page' : undefined}
              disabled={disabled || item === page}
              onClick={() => onPageChange(item)}
            >
              {item}
            </button>
          ),
        )}
        <button
          type="button"
          className={button}
          disabled={disabled || page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </nav>
    </div>
  )
}
