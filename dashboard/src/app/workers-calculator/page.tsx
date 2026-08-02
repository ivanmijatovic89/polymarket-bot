import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { WorkersCalculatorView } from '@/components/WorkersCalculatorView'

export default function WorkersCalculatorPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/fleet"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3 w-3" />
          Fleet
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">Workers Calculator</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Compare Hetzner burst servers to your machines by parallel throughput (1 worker per core),
          and see which device is the best value per dollar.
        </p>
      </div>
      <WorkersCalculatorView />
    </div>
  )
}
