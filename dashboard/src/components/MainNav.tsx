'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Database, HeartPulse, History, LayoutDashboard, Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'

type NavItem = {
  href: string
  label: string
  icon: typeof LayoutDashboard
  exact: boolean
  group?: 'backtests'
}

const ITEMS: NavItem[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/backtests', label: 'Backtests', icon: History, exact: false, group: 'backtests' },
  { href: '/backtests/datasets', label: 'Datasets', icon: Database, exact: true },
  { href: '/leaderboard', label: 'Leaderboard', icon: Trophy, exact: false },
  { href: '/health', label: 'Health', icon: HeartPulse, exact: false },
]

function isActive(
  pathname: string,
  href: string,
  exact: boolean,
  group?: 'backtests',
): boolean {
  if (exact) return pathname === href
  if (group === 'backtests' && pathname.startsWith('/backtests/datasets')) return false
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function MainNav() {
  const pathname = usePathname() ?? '/'
  return (
    <nav className="flex items-center gap-1 text-sm">
      {ITEMS.map(({ href, label, icon: Icon, exact, group }) => {
        const active = isActive(pathname, href, exact, group)
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors',
              active
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
