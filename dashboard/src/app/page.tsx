import path from 'node:path'
import Link from 'next/link'
import { ArrowRight, Bot, Cpu, Gauge, History, Inbox, Server } from 'lucide-react'
import { ActiveBatchesTable } from '@/components/ActiveBatchesTable'
import { BacktestsTable } from '@/components/BacktestsTable'
import { LlmUsageView } from '@/components/LlmUsageView'
import { MissionControlView } from '@/components/MissionControlView'
import { SectionHeading } from '@/components/SectionHeading'
import { WorkersTable } from '@/components/WorkersTable'

export const dynamic = 'force-dynamic'

export default function OverviewPage() {
  const examplesRoot = path.resolve(process.cwd(), '..', 'examples', 'global-runtime')

  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Mission activity, backtest fleet, and LLM capacity in one place.
        </p>
      </div>

      <section>
        <SectionHeading
          title="Mission Control"
          subtitle="The three most recent mission loops."
          icon={Bot}
          action={
            <Link
              href="/mission-control"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Open Mission Control
              <ArrowRight className="h-3 w-3" />
            </Link>
          }
        />
        <MissionControlView examplesRoot={examplesRoot} limit={3} embedded />
      </section>

      <section>
        <SectionHeading
          title="Fleet"
          subtitle="Workers, in-flight batches, and the latest 20 completed runs."
          icon={Server}
          action={
            <Link
              href="/fleet"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Open Fleet
              <ArrowRight className="h-3 w-3" />
            </Link>
          }
        />

        <div className="mt-5 space-y-8">
          <div>
            <SectionHeading
              title="Workers"
              subtitle="Backtest worker daemons by name, with heartbeat and per-worker counters."
              icon={Cpu}
            />
            <WorkersTable />
          </div>

          <div>
            <SectionHeading
              title="Active batches"
              subtitle="Aggregate parent jobs that haven't finalized yet."
              icon={Inbox}
            />
            <ActiveBatchesTable />
          </div>

          <div>
            <SectionHeading
              title="Recent batches"
              subtitle="Last 20 finalized backtests, newest first."
              icon={History}
            />
            <BacktestsTable limit={20} stickyHeader />
          </div>
        </div>
      </section>

      <section>
        <SectionHeading
          title="LLM Usage"
          subtitle="Dense subscription rate-limit view across Claude Code and Codex accounts."
          icon={Gauge}
          action={
            <Link
              href="/llm-usage"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Open LLM Usage
              <ArrowRight className="h-3 w-3" />
            </Link>
          }
        />
        <LlmUsageView fixedViewMode="dense" />
      </section>
    </div>
  )
}
