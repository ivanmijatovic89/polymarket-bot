import { Cpu, Inbox, History } from 'lucide-react'
import { ActiveBatchesTable } from '@/components/ActiveBatchesTable'
import { QueueCountsView } from '@/components/QueueCounts'
import { RecentBatchesTable } from '@/components/RecentBatchesTable'
import { SectionHeading } from '@/components/SectionHeading'
import { WorkersTable } from '@/components/WorkersTable'

export const dynamic = 'force-dynamic'

export default function OverviewPage() {
  return (
    <div className="space-y-10">
      <section>
        <SectionHeading
          title="Queues"
          subtitle="Live counts from BullMQ — market and aggregate queues."
        />
        <QueueCountsView />
      </section>

      <section>
        <SectionHeading
          title="Workers"
          subtitle="Backtest worker daemons by name, with heartbeat and per-worker counters."
          icon={Cpu}
        />
        <WorkersTable />
      </section>

      <section>
        <SectionHeading
          title="Active batches"
          subtitle="Aggregate parent jobs that haven't finalized yet."
          icon={Inbox}
        />
        <ActiveBatchesTable />
      </section>

      <section>
        <SectionHeading
          title="Recent batches"
          subtitle="Last 20 finalized backtests, newest first."
          icon={History}
        />
        <RecentBatchesTable />
      </section>
    </div>
  )
}
