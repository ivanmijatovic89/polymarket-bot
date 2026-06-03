import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { Suspense } from 'react'
import { BacktestsBrowser } from './BacktestsBrowser'

export const dynamic = 'force-dynamic'

export default function BacktestsPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3 w-3" />
          Overview
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">Backtests</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Browse finalized batches. Use the filters to narrow by strategy, symbol, or status.
        </p>
      </div>
      <Suspense fallback={null}>
        <BacktestsBrowser />
      </Suspense>
    </div>
  )
}
