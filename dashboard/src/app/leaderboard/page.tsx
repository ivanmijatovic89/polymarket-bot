import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { LeaderboardView } from '@/components/LeaderboardView'

export const dynamic = 'force-dynamic'

export default function LeaderboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3 w-3" />
          Fleet
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">Leaderboard</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Per-machine totals aggregated from <code className="font-mono">backtest_run_markets</code>.
          Throughput is events ÷ summed market duration.
        </p>
      </div>
      <LeaderboardView />
    </div>
  )
}
