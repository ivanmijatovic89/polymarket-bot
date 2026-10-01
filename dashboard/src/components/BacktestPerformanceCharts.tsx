'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChartNoAxesCombined } from 'lucide-react'
import {
  buildPerformanceSeries,
  nearestPerformancePoint,
  rollingMarketAverages,
  trailingMarketSummary,
  type PerformanceMarket,
  type PerformancePoint,
} from '@/lib/backtestPerformance'
import { cn } from '@/lib/utils'
import { Card } from './ui/card'
import { SectionHeading } from './SectionHeading'

const WINDOWS = [100, 500, 1000] as const
const money = (value: number) =>
  value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const signed = (value: number) => `${value > 0 ? '+' : ''}${money(value)}`
const tone = (value: number) =>
  value > 0 ? 'text-[color:var(--success)]' : value < 0 ? 'text-destructive' : 'text-foreground'
const dateLabel = (timestamp: number) =>
  new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
const pointLabel = (point: PerformancePoint, hasDates: boolean) =>
  hasDates
    ? `${new Date(point.timestamp!).toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : `Market ${point.marketNumber.toLocaleString('en-US')}`

type ChartMarker = { index: number; value: number; label: string; from?: number }

function PerformanceChart({
  title,
  description,
  points,
  values,
  hasDates,
  selected,
  onSelect,
  cumulative = false,
  markers = [],
}: {
  title: string
  description: string
  points: PerformancePoint[]
  values: Array<number | null>
  hasDates: boolean
  selected: number | null
  onSelect: (index: number | null) => void
  cumulative?: boolean
  markers?: ChartMarker[]
}) {
  const id = useId().replace(/:/g, '')
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(960)
  useEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(Math.max(240, element.clientWidth)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const height = 228
  const left = 66
  const right = width - 18
  const top = 14
  const bottom = height - 30
  const firstX = points[0].x
  const lastX = points.at(-1)!.x
  const x = (value: number) =>
    lastX === firstX
      ? (left + right) / 2
      : left + ((value - firstX) / (lastX - firstX)) * (right - left)
  const geometry = useMemo(() => {
    let min = 0
    let max = 0
    for (const value of values) {
      if (value === null) continue
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
    const padding = (max - min || 1) * 0.1
    min -= padding
    max += padding
    const y = (value: number) => bottom - ((value - min) / (max - min)) * (bottom - top)
    const plotX = (value: number) =>
      lastX === firstX
        ? (left + right) / 2
        : left + ((value - firstX) / (lastX - firstX)) * (right - left)
    let line = cumulative ? `M${plotX(firstX)},${y(0)}` : ''
    let first: number | null = null
    let last: number | null = null
    for (let i = 0; i < points.length; i++) {
      const value = values[i]
      if (value === null) continue
      first ??= i
      last = i
      line += `${line ? 'L' : 'M'}${plotX(points[i].x).toFixed(2)},${y(value).toFixed(2)}`
    }
    const area =
      first === null || last === null
        ? ''
        : `${line}L${plotX(points[last].x)},${y(0)}L${plotX(points[first].x)},${y(0)}Z`
    return { min, max, y, line, area, hasValues: first !== null }
  }, [values, points, cumulative, firstX, lastX, right])

  const inspectIndex = selected ?? points.length - 1
  const current = values[inspectIndex]
  const zeroY = geometry.y(0)
  const tickCount = firstX === lastX ? 1 : width < 500 ? 3 : 5
  return (
    <Card className="overflow-hidden p-4">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
        </div>
        <div className="text-right">
          <div
            className={cn(
              'text-lg font-semibold tabular-nums',
              current === null ? 'text-muted-foreground' : tone(current),
            )}
          >
            {current === null ? '—' : signed(current)}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {cumulative ? 'USDC' : 'USDC / market'}
          </div>
        </div>
      </div>
      <div
        ref={container}
        role="slider"
        tabIndex={0}
        aria-label={`Inspect ${title}. Use left and right arrow keys to move between markets.`}
        aria-valuemin={1}
        aria-valuemax={points.length}
        aria-valuenow={inspectIndex + 1}
        aria-valuetext={`${pointLabel(points[inspectIndex], hasDates)}: ${current === null ? 'Full window unavailable' : signed(current)}`}
        className="relative rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const fraction = Math.max(
            0,
            Math.min(1, (event.clientX - rect.left - left) / (right - left)),
          )
          onSelect(nearestPerformancePoint(points, firstX + fraction * (lastX - firstX)))
        }}
        onPointerLeave={() => onSelect(null)}
        onBlur={() => onSelect(null)}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          onSelect(
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? points.length - 1
                : Math.max(
                    0,
                    Math.min(
                      points.length - 1,
                      inspectIndex + (event.key === 'ArrowLeft' ? -1 : 1),
                    ),
                  ),
          )
        }}
      >
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          <defs>
            <clipPath id={`${id}-positive`}>
              <rect x={left} y={top} width={right - left} height={zeroY - top} />
            </clipPath>
            <clipPath id={`${id}-negative`}>
              <rect x={left} y={zeroY} width={right - left} height={bottom - zeroY} />
            </clipPath>
          </defs>
          {Array.from({ length: 5 }, (_, i) => {
            const value = geometry.min + ((geometry.max - geometry.min) * i) / 4
            const y = geometry.y(value)
            if (Math.abs(y - zeroY) < 14) return null
            return (
              <g key={i}>
                <line
                  x1={left}
                  x2={right}
                  y1={y}
                  y2={y}
                  stroke="var(--border)"
                  strokeDasharray="3 4"
                />
                <text
                  x={left - 10}
                  y={y + 4}
                  textAnchor="end"
                  fill="var(--muted-foreground)"
                  fontSize={10}
                >
                  {value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })}
                </text>
              </g>
            )
          })}
          <line
            x1={left}
            x2={right}
            y1={zeroY}
            y2={zeroY}
            stroke="var(--muted-foreground)"
            strokeOpacity={0.55}
          />
          <text x={left - 10} y={zeroY + 4} textAnchor="end" fill="var(--foreground)" fontSize={10}>
            0
          </text>
          {(['positive', 'negative'] as const).map((sign) => (
            <g key={sign} clipPath={`url(#${id}-${sign})`}>
              <path
                d={geometry.area}
                fill={sign === 'positive' ? 'var(--success)' : 'var(--destructive)'}
                fillOpacity={0.08}
              />
              <path
                d={geometry.line}
                fill="none"
                stroke={sign === 'positive' ? 'var(--success)' : 'var(--destructive)'}
                strokeWidth={1.5}
                strokeLinejoin="round"
              />
            </g>
          ))}
          {markers.map((marker) => (
            <g key={marker.label}>
              {marker.from !== undefined && (
                <line
                  x1={x(points[marker.index].x)}
                  x2={x(points[marker.index].x)}
                  y1={geometry.y(marker.from)}
                  y2={geometry.y(marker.value)}
                  stroke="var(--destructive)"
                  strokeDasharray="4 3"
                  strokeWidth={2}
                />
              )}
              <circle
                cx={x(points[marker.index].x)}
                cy={geometry.y(marker.value)}
                r={4}
                fill="var(--card)"
                stroke={marker.from === undefined ? 'var(--success)' : 'var(--destructive)'}
                strokeWidth={2}
              />
              <title>{marker.label}</title>
            </g>
          ))}
          {selected !== null && (
            <g>
              <line
                x1={x(points[selected].x)}
                x2={x(points[selected].x)}
                y1={top}
                y2={bottom}
                stroke="var(--foreground)"
                strokeOpacity={0.5}
                strokeDasharray="3 3"
              />
              {values[selected] !== null && (
                <circle
                  cx={x(points[selected].x)}
                  cy={geometry.y(values[selected]!)}
                  r={4}
                  fill="var(--foreground)"
                />
              )}
            </g>
          )}
          {Array.from({ length: tickCount }, (_, i) => {
            const fraction = tickCount === 1 ? 0.5 : i / (tickCount - 1)
            const value = firstX + (lastX - firstX) * fraction
            return (
              <text
                key={i}
                x={left + (right - left) * fraction}
                y={height - 8}
                textAnchor={
                  tickCount === 1
                    ? 'middle'
                    : i === 0
                      ? 'start'
                      : i === tickCount - 1
                        ? 'end'
                        : 'middle'
                }
                fill="var(--muted-foreground)"
                fontSize={10}
              >
                {hasDates ? dateLabel(value) : `#${Math.round(value).toLocaleString('en-US')}`}
              </text>
            )
          })}
        </svg>
        {!geometry.hasValues && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            Not enough markets for a full window.
          </div>
        )}
      </div>
    </Card>
  )
}

export function BacktestPerformanceCharts({
  markets,
  selectedMarketsTotal,
}: {
  markets: readonly PerformanceMarket[]
  selectedMarketsTotal: number
}) {
  const [window, setWindow] = useState<number>(500)
  const [selected, setSelected] = useState<number | null>(null)
  const series = useMemo(() => buildPerformanceSeries(markets), [markets])
  const cumulative = useMemo(() => series.points.map((point) => point.cumulative), [series])
  const rolling = useMemo(() => rollingMarketAverages(series.points, window), [series, window])
  const last500 = trailingMarketSummary(series.points, 500)
  const last1000 = trailingMarketSummary(series.points, 1000)
  if (series.points.length === 0) return null
  const cursor = selected !== null && selected < series.points.length ? selected : null
  const point = series.points[cursor ?? series.points.length - 1]
  const cards = [
    {
      label: 'Total net PnL',
      value: series.points.at(-1)!.cumulative,
      unit: 'USDC',
      hint: `${markets.length.toLocaleString('en-US')} markets · fees included`,
    },
    {
      label: 'Last 500 average',
      value: last500?.average ?? null,
      unit: 'USDC / market',
      hint: last500 ? `${signed(last500.total)} USDC net` : 'Requires 500 markets',
    },
    {
      label: 'Last 1,000 average',
      value: last1000?.average ?? null,
      unit: 'USDC / market',
      hint: last1000 ? `${signed(last1000.total)} USDC net` : 'Requires 1,000 markets',
    },
    {
      label: 'Maximum drawdown',
      value: -series.maxDrawdown,
      unit: 'USDC',
      hint: 'Largest drop from a prior PnL peak',
    },
  ]
  const markers: ChartMarker[] = []
  if (series.peakIndex !== null)
    markers.push({
      index: series.peakIndex,
      value: series.peak,
      label: `Peak ${signed(series.peak)} USDC`,
    })
  if (series.drawdownIndex !== null)
    markers.push({
      index: series.drawdownIndex,
      value: series.points[series.drawdownIndex].cumulative,
      from: series.drawdownPeak,
      label: `Maximum drawdown ${money(series.maxDrawdown)} USDC`,
    })

  return (
    <section aria-label="Profitability over time" className="space-y-3">
      <SectionHeading
        title="Profitability over time"
        icon={ChartNoAxesCombined}
        subtitle="Net results by market. Includes skipped markets; each market has independent capital."
      />
      {selectedMarketsTotal > markets.length && (
        <p className="text-xs text-destructive">
          Partial results: charts cover {markets.length.toLocaleString('en-US')} of{' '}
          {selectedMarketsTotal.toLocaleString('en-US')} selected markets. Missing results are not
          counted as zero.
        </p>
      )}
      {!series.hasDates && (
        <p className="text-xs text-muted-foreground">
          Some market dates are unavailable. Charts use the saved market order.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label} className="px-4 py-3">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {card.label}
            </div>
            <div
              className={cn(
                'mt-1 text-xl font-semibold tabular-nums',
                card.value === null ? 'text-muted-foreground' : tone(card.value),
              )}
            >
              {card.value === null ? '—' : signed(card.value)}
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">{card.unit}</div>
            <div className="mt-2 text-[11px] text-muted-foreground">{card.hint}</div>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Rolling window</span>
          <div className="flex gap-1" role="group" aria-label="Rolling window size">
            {WINDOWS.map((size) => (
              <button
                key={size}
                type="button"
                aria-pressed={window === size}
                onClick={() => setWindow(size)}
                className={cn(
                  'rounded-md px-3 py-1.5 tabular-nums focus-visible:outline-2 focus-visible:outline-ring',
                  window === size
                    ? 'bg-accent font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-accent/50',
                )}
              >
                {size.toLocaleString('en-US')}
              </button>
            ))}
          </div>
          <span className="text-muted-foreground">markets</span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          Full trailing windows · {series.hasDates ? 'dates in UTC' : 'market order'}
        </span>
      </div>
      <div className="rounded-md border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground tabular-nums">
        <span className="font-medium text-foreground">
          {cursor === null ? 'Latest' : 'Inspecting'} · {pointLabel(point, series.hasDates)}
        </span>
        <span className="ml-3">
          Market #{point.marketNumber.toLocaleString('en-US')} · net{' '}
          <span className={tone(point.pnl)}>{signed(point.pnl)}</span> USDC · drawdown{' '}
          {money(point.drawdown)} USDC
        </span>
      </div>
      <PerformanceChart
        title="Cumulative net PnL"
        description={`Starts at zero · peak ${signed(series.peak)} USDC · red marker shows maximum drawdown`}
        points={series.points}
        values={cumulative}
        hasDates={series.hasDates}
        selected={cursor}
        onSelect={setSelected}
        cumulative
        markers={markers}
      />
      <PerformanceChart
        title={`Rolling average · ${window.toLocaleString('en-US')} markets`}
        description="Above zero: profitable window. Below zero: losing window. Skipped markets count in the average."
        points={series.points}
        values={rolling}
        hasDates={series.hasDates}
        selected={cursor}
        onSelect={setSelected}
      />
      <p className="text-[11px] text-muted-foreground">
        Hover either chart to inspect the same market on both. Use arrow keys when focused.
        Cumulative PnL is not a compounded account balance.
      </p>
    </section>
  )
}
