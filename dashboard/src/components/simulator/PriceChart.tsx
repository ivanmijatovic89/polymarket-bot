'use client'
import { useEffect, useRef } from 'react'
import type { TraceManifest, Outcome } from '@bot/backtest/simulator/contracts'
import type { DisplayFrame } from './playback'

export function PriceChart({
  manifest,
  display,
  outcome,
  zoom,
  onSeek,
}: {
  manifest: TraceManifest
  display: DisplayFrame
  outcome: Outcome
  zoom: number
  onSeek: (time: number) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const start = zoom ? Math.max(manifest.startTime, display.frame.time - zoom) : manifest.startTime
  const end = zoom
    ? Math.min(manifest.endTime, Math.max(start + zoom, display.frame.time))
    : manifest.endTime
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const draw = () => {
      const width = el.clientWidth,
        height = 230,
        dpr = window.devicePixelRatio || 1
      el.width = width * dpr
      el.height = height * dpr
      const ctx = el.getContext('2d')!
      ctx.scale(dpr, dpr)
      const left = 40,
        right = width - 14,
        top = 12,
        bottom = height - 26
      const x = (time: number) =>
        left + ((time - start) / Math.max(1, end - start)) * (right - left)
      const y = (price: number) => bottom - price * (bottom - top)
      ctx.font = '10px monospace'
      for (let p = 0; p <= 1.001; p += 0.2) {
        ctx.strokeStyle = '#263142'
        ctx.beginPath()
        ctx.moveTo(left, y(p))
        ctx.lineTo(right, y(p))
        ctx.stroke()
        ctx.fillStyle = '#94a3b8'
        ctx.fillText(`${Math.round(p * 100)}¢`, 5, y(p) + 3)
      }
      for (let i = 0; i < 5; i++) {
        const time = start + ((end - start) * i) / 4
        ctx.fillStyle = '#94a3b8'
        ctx.fillText(
          new Date(time).toISOString().slice(11, 19),
          Math.min(right - 48, Math.max(left, x(time) - 24)),
          height - 7,
        )
      }
      const pointKeys =
        outcome === 'UP' ? (['upBid', 'upAsk'] as const) : (['downBid', 'downAsk'] as const)
      ctx.save()
      ctx.beginPath()
      ctx.rect(left, top, right - left, bottom - top)
      ctx.clip()
      for (const [i, key] of pointKeys.entries()) {
        ctx.strokeStyle = i === 0 ? '#38bdf8' : '#fbbf24'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        let hasPoint = false
        for (const p of manifest.chart) {
          if (p.tick > display.frame.tick || p.time > end) break
          if (p.time < start || p[key] === null) continue
          if (!hasPoint) ctx.moveTo(x(p.time), y(p[key]!))
          else ctx.lineTo(x(p.time), y(p[key]!))
          hasPoint = true
        }
        const current = outcome === 'UP' ? display.frame.up : display.frame.down
        const quote = i === 0 ? current?.bid : current?.ask
        if (hasPoint && quote != null) ctx.lineTo(x(display.frame.time), y(quote))
        ctx.stroke()
      }
      let labelY = -Infinity
      for (const order of display.state.orders
        .filter((o) => o.outcome === outcome)
        .sort((a, b) => b.price - a.price)) {
        ctx.strokeStyle = order.cancelRequested ? '#f97316' : 'rgba(167, 139, 250, 0.5)'
        ctx.lineWidth = 0.6
        ctx.setLineDash(order.cancelRequested ? [5, 5] : [])
        ctx.beginPath()
        ctx.moveTo(left, y(order.price))
        ctx.lineTo(right, y(order.price))
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = '#c4b5fd'
        if (y(order.price) - labelY >= 14) {
          ctx.fillText(
            `${order.side} ${order.remaining.toFixed(1)}`,
            right - 94,
            y(order.price) - 3,
          )
          labelY = y(order.price)
        }
      }
      for (const action of manifest.actions) {
        if (action.tick > display.frame.tick) break
        if (
          action.tick === display.frame.tick &&
          display.actionSeq !== null &&
          action.seq > display.actionSeq
        )
          break
        if (
          action.price === undefined ||
          action.outcome !== outcome ||
          action.time < start ||
          action.time > end
        )
          continue
        ctx.fillStyle = action.side === 'BUY' ? '#34d399' : '#fb7185'
        ctx.beginPath()
        ctx.arc(x(action.time), y(action.price), 3.5, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.strokeStyle = '#e2e8f0'
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(x(display.frame.time), top)
      ctx.lineTo(x(display.frame.time), bottom)
      ctx.stroke()
      ctx.restore()
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(el)
    return () => observer.disconnect()
  }, [manifest, display, outcome, start, end])
  return (
    <canvas
      ref={canvas}
      style={{ width: '100%', height: 230 }}
      role="img"
      aria-label={`${outcome} bid and ask chart, fills and active order levels`}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        const fraction = Math.max(
          0,
          Math.min(1, (event.clientX - rect.left - 40) / (rect.width - 54)),
        )
        onSeek(start + fraction * (end - start))
      }}
      className="cursor-crosshair"
    />
  )
}
