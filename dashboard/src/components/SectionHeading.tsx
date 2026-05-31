import type { LucideIcon } from 'lucide-react'

export function SectionHeading({
  title,
  subtitle,
  icon: Icon,
  action,
}: {
  title: string
  subtitle?: string
  icon?: LucideIcon
  action?: React.ReactNode
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        </div>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
