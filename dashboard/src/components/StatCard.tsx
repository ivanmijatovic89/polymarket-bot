import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'default',
  hint,
}: {
  label: string
  value: React.ReactNode
  icon?: LucideIcon
  tone?: 'default' | 'success' | 'warning' | 'destructive' | 'muted'
  hint?: string
}) {
  const toneStyles: Record<typeof tone, string> = {
    default: 'text-foreground',
    success: 'text-[color:var(--success)]',
    warning: 'text-[color:var(--warning)]',
    destructive: 'text-destructive',
    muted: 'text-muted-foreground',
  }
  const iconBg: Record<typeof tone, string> = {
    default: 'bg-muted text-muted-foreground',
    success: 'bg-[color:var(--success)]/15 text-[color:var(--success)]',
    warning: 'bg-[color:var(--warning)]/15 text-[color:var(--warning)]',
    destructive: 'bg-destructive/15 text-destructive',
    muted: 'bg-muted text-muted-foreground',
  }
  return (
    <Card className="px-5 py-4 hover:border-foreground/20 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div className={cn('mt-1.5 text-2xl font-semibold tabular-nums', toneStyles[tone])}>
            {value}
          </div>
          {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
        </div>
        {Icon && (
          <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', iconBg[tone])}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
    </Card>
  )
}
