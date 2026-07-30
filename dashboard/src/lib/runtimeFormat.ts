// Formatting helpers shared by the Mission Control list and run detail views.
import type { RuntimeRun } from '@/lib/runtimeTypes'

export function formatUsd(value: number | null): string {
  if (value === null) return '—'
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`
}

export function formatNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString()
}

export function formatCompact(value: number | null): string {
  if (value === null) return '—'
  if (Math.abs(value) < 1000) return String(value)
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

export function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString(undefined, { hourCycle: 'h23' }) : '—'
}

export function formatRelative(value: string): string {
  const deltaSeconds = Math.round((new Date(value).getTime() - Date.now()) / 1000)
  const magnitude = Math.abs(deltaSeconds)
  const [amount, unit]: [number, Intl.RelativeTimeFormatUnit] =
    magnitude < 60
      ? [deltaSeconds, 'second']
      : magnitude < 3600
        ? [Math.round(deltaSeconds / 60), 'minute']
        : magnitude < 86_400
          ? [Math.round(deltaSeconds / 3600), 'hour']
          : [Math.round(deltaSeconds / 86_400), 'day']
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(amount, unit)
}

export function formatDurationBetween(start: string | null, end: string | null): string {
  if (!start) return '—'
  const startMs = new Date(start).getTime()
  const endMs = end ? new Date(end).getTime() : Date.now()
  return formatDuration(Math.max(0, endMs - startMs))
}

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.round(milliseconds / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

export function formatAccount(run: Pick<RuntimeRun, 'provider' | 'authHome'>): string {
  if (!run.authHome) {
    return run.provider === 'claude' ? 'Default Claude login' : 'Default Codex login'
  }
  return run.authHome === '~/.claude-balsa' ? 'Balsa' : run.authHome
}
