import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { HealthView } from '@/components/HealthView'

export const dynamic = 'force-dynamic'

export default function HealthPage() {
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
        <h1 className="mt-2 text-xl font-semibold tracking-tight">Health</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Live status of the dashboard&apos;s upstream dependencies — Redis, MySQL, BullMQ queues,
          and worker daemons.
        </p>
      </div>
      <HealthView />
    </div>
  )
}
