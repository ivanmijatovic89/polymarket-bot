'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Calculator,
  ChevronDown,
  Database,
  Gauge,
  HeartPulse,
  History,
  LayoutDashboard,
  Trophy,
} from 'lucide-react'
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

const MORE_ITEMS: NavItem[] = [
  { href: '/workers-calculator', label: 'Workers Calculator', icon: Calculator, exact: true },
  { href: '/llm-usage', label: 'LLM Usage', icon: Gauge, exact: true },
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
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMoreOpen(false)
  }, [pathname])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const moreActive = MORE_ITEMS.some((i) => isActive(pathname, i.href, i.exact))

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
      <div className="relative" ref={moreRef}>
        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors',
            moreActive || moreOpen
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent',
          )}
        >
          More
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform', moreOpen && 'rotate-180')}
          />
        </button>
        {moreOpen && (
          <div className="absolute left-0 top-full z-40 mt-1 min-w-[200px] rounded-md border bg-background p-1 shadow-md">
            {MORE_ITEMS.map(({ href, label, icon: Icon, exact }) => {
              const active = isActive(pathname, href, exact)
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'flex items-center gap-2 rounded-sm px-3 py-1.5 transition-colors',
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
          </div>
        )}
      </div>
    </nav>
  )
}
