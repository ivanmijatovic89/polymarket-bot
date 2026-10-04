import { RecordersView } from '@/components/RecordersView'

export const dynamic = 'force-dynamic'

export default function RecordersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Recorders</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          BTC 5m and 15m capture, verified R2 uploads, and resolution tracking.
        </p>
      </div>
      <RecordersView />
    </div>
  )
}
