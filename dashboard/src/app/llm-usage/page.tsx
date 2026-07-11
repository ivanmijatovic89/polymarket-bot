import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { LlmUsageView } from '@/components/LlmUsageView'

export default function LlmUsagePage() {
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
        <h1 className="mt-2 text-xl font-semibold tracking-tight">LLM Usage</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Subscription rate-limit windows per Claude Code / Codex account, read from the logins on
          this machine. Checking usage consumes nothing.
        </p>
      </div>
      <LlmUsageView />
    </div>
  )
}
