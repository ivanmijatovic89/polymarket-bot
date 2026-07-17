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
  Menu,
  Trophy,
  X,
} from 'lucide-react'
import { BullBoardLink } from '@/components/BullBoardLink'
import { LiveStatusBadge } from '@/components/LiveStatusBadge'
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

function isActive(pathname: string, href: string, exact: boolean, group?: 'backtests'): boolean {
  if (exact) return pathname === href
  if (group === 'backtests' && pathname.startsWith('/backtests/datasets')) return false
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function MainNav({ bullBoardPort }: { bullBoardPort: number }) {
  const pathname = usePathname() ?? '/'
  const [moreOpen, setMoreOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const navRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMoreOpen(false)
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setMoreOpen(false)
        setMobileOpen(false)
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMoreOpen(false)
        setMobileOpen(false)
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const moreActive = MORE_ITEMS.some((i) => isActive(pathname, i.href, i.exact))
  const mobileItems = [...ITEMS, ...MORE_ITEMS]

  return (
    <div ref={navRef} className="contents">
      <nav aria-label="Primary navigation" className="hidden items-center gap-1 text-sm xl:flex">
        {ITEMS.map(({ href, label, icon: Icon, exact, group }) => {
          const active = isActive(pathname, href, exact, group)
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors',
                active
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          )
        })}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMoreOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-controls="desktop-more-navigation"
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors',
              moreActive || moreOpen
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            More
            <ChevronDown
              className={cn('h-3.5 w-3.5 transition-transform', moreOpen && 'rotate-180')}
            />
          </button>
          {moreOpen && (
            <div
              id="desktop-more-navigation"
              role="menu"
              className="absolute left-0 top-full z-40 mt-1 min-w-[200px] rounded-md border bg-background p-1 shadow-md"
            >
              {MORE_ITEMS.map(({ href, label, icon: Icon, exact }) => {
                const active = isActive(pathname, href, exact)
                return (
                  <Link
                    key={href}
                    href={href}
                    role="menuitem"
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2 rounded-sm px-3 py-1.5 transition-colors',
                      active
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
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

      <div className="relative ml-auto flex items-center gap-2 xl:hidden">
        <LiveStatusBadge className="shrink-0 gap-1.5 px-2" />
        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={mobileOpen}
          aria-controls="mobile-navigation"
          className="flex h-9 w-9 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>

        {mobileOpen && (
          <div
            id="mobile-navigation"
            className="absolute right-0 top-full z-40 mt-2 max-h-[calc(100dvh-4.5rem)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border bg-background p-2 shadow-xl"
          >
            <nav aria-label="Mobile navigation" className="grid gap-1">
              {mobileItems.map(({ href, label, icon: Icon, exact, group }) => {
                const active = isActive(pathname, href, exact, group)
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                      active
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </Link>
                )
              })}
            </nav>

            <div className="mt-2 grid gap-1 border-t pt-2">
              <BullBoardLink
                port={bullBoardPort}
                className="flex min-h-10 items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
