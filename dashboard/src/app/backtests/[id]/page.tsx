import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { BacktestRunDetailView } from '@/components/BacktestRunDetailView'

export const dynamic = 'force-dynamic'

export default async function BacktestRunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: idRaw } = await params
  const id = Number(idRaw)
  if (!Number.isInteger(id) || id < 1) notFound()

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/backtests"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3 w-3" />
          Backtests
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">
          Backtest run <span className="font-mono text-base text-muted-foreground">#{id}</span>
        </h1>
      </div>
      <BacktestRunDetailView id={id} />
    </div>
  )
}
