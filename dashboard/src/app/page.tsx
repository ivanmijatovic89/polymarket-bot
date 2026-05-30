import { ActiveBatchesTable } from '@/components/ActiveBatchesTable'
import { QueueCountsView } from '@/components/QueueCounts'
import { RecentBatchesTable } from '@/components/RecentBatchesTable'
import { WorkersTable } from '@/components/WorkersTable'

export const dynamic = 'force-dynamic'

export default function OverviewPage() {
  return (
    <div className="max-w-[1600px]">
      <QueueCountsView />

      <h2 className="text-lg font-semibold mb-3">Workers</h2>
      <WorkersTable />

      <h2 className="text-lg font-semibold mt-8 mb-3">Active batches</h2>
      <ActiveBatchesTable />

      <h2 className="text-lg font-semibold mt-8 mb-3">Recent batches</h2>
      <RecentBatchesTable />
    </div>
  )
}
