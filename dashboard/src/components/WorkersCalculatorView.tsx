'use client'

import { useMemo, useState } from 'react'
import { getMachine } from '@/lib/machineNames'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

// One single-threaded worker per core, so parallel throughput is
// cores × single-core Geekbench 6 (NOT GB6 multi, which saturates ~16 cores).
type Plan = { name: string; cores: number; single: number; hourly: number; capMonthly: number }

// Hetzner CCX dedicated-vCPU plans. single-core verified (~1,877, homogeneous
// EPYC); hourly + monthly cap are real Hetzner console prices in EUR (ex-VAT).
const HETZNER_PLANS: Plan[] = [
  { name: 'CCX13', cores: 2, single: 1807, hourly: 0.069, capMonthly: 42.99 },
  { name: 'CCX23', cores: 4, single: 1846, hourly: 0.138, capMonthly: 85.99 },
  { name: 'CCX33', cores: 8, single: 1871, hourly: 0.222, capMonthly: 138.49 },
  { name: 'CCX43', cores: 16, single: 1877, hourly: 0.442, capMonthly: 275.99 },
  { name: 'CCX53', cores: 32, single: 1876, hourly: 0.855, capMonthly: 533.49 },
  { name: 'CCX63', cores: 48, single: 1859, hourly: 1.368, capMonthly: 853.49 },
]

// DigitalOcean CPU-Optimized (Standard Intel) dedicated-vCPU plans. Pricing
// and single-core verified (~957, Xeon Platinum 8168). monthly cap = the plan's
// monthly price (672h). DO vCPUs are hyperthreads, so per-worker speed is about
// half a Hetzner dedicated core (1,877). Premium Intel (Xeon 8358) benches ~1,447
// single but costs more — Standard is DO's best-case for value, used here.
const DO_PLANS: Plan[] = [
  { name: 'CPU-Opt 2', cores: 2, single: 957, hourly: 0.0625, capMonthly: 42 },
  { name: 'CPU-Opt 4', cores: 4, single: 957, hourly: 0.125, capMonthly: 84 },
  { name: 'CPU-Opt 8', cores: 8, single: 957, hourly: 0.25, capMonthly: 168 },
  { name: 'CPU-Opt 16', cores: 16, single: 957, hourly: 0.5, capMonthly: 336 },
  { name: 'CPU-Opt 32', cores: 32, single: 957, hourly: 1.0, capMonthly: 672 },
]

// Devices pulled from machines.json (cores, parallelThroughput, priceUsd).
// `short` is a compact label for table columns; `name` is the registered alias.
const DEVICE_REFS = [
  { id: '8955f8d87c59', short: 'M1 Pro' },
  { id: '8e367b2f7eb8', short: 'M5 Pro' },
  { id: 'mac-mini-m4', short: 'Mac mini M4' },
]

type Device = { id: string; short: string; name: string; cores: number; thru: number; price: number }

type TimeMode = 'perDay' | 'total'

function loadDevices(): Device[] {
  return DEVICE_REFS.map((r) => {
    const m = getMachine(r.id)
    return {
      id: r.id,
      short: r.short,
      name: m?.name ?? r.id,
      cores: m?.cores ?? 0,
      thru: m?.parallelThroughput ?? 0,
      price: m?.priceUsd ?? 0,
    }
  })
}

const fmt = (v: number, sym: string) =>
  `${sym}${v.toLocaleString('en-US', { maximumFractionDigits: v < 100 ? 2 : 0 })}`

function PlansTable({
  title,
  subtitle,
  plans,
  servers,
  mode,
  hoursPerDay,
  totalHours,
  devices,
  currency,
}: {
  title: string
  subtitle: string
  plans: Plan[]
  servers: number
  mode: TimeMode
  hoursPerDay: number
  totalHours: number
  devices: Device[]
  currency: string
}) {
  const costLabel = mode === 'perDay' ? `${currency}/mo` : `${currency} total`
  return (
    <div>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <p className="mt-0.5 mb-3 text-xs text-muted-foreground">{subtitle}</p>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Workers</TableHead>
              <TableHead className="text-right">{currency}/hr</TableHead>
              <TableHead className="text-right">{costLabel}</TableHead>
              {devices.map((d) => (
                <TableHead key={d.id} className="text-right">
                  ≈ {d.short}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.map((p) => {
              const workers = p.cores * servers
              const thru = p.cores * p.single * servers
              const costHr = p.hourly * servers
              const cost =
                mode === 'perDay'
                  ? Math.min(p.hourly * hoursPerDay * 30, p.capMonthly) * servers
                  : p.hourly * totalHours * servers
              return (
                <TableRow key={p.name}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {workers.toLocaleString('en-US')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(costHr, currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {`${currency}${Math.round(cost).toLocaleString('en-US')}`}
                  </TableCell>
                  {devices.map((d) => (
                    <TableCell key={d.id} className="text-right tabular-nums text-muted-foreground">
                      {d.thru ? `${(thru / d.thru).toFixed(1)}×` : '—'}
                    </TableCell>
                  ))}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}

export function WorkersCalculatorView() {
  const devices = useMemo(loadDevices, [])
  const [servers, setServers] = useState(10)
  const [mode, setMode] = useState<TimeMode>('perDay')
  const [hoursPerDay, setHoursPerDay] = useState(5)
  const [totalHours, setTotalHours] = useState(150)
  const [prices, setPrices] = useState<Record<string, number>>(() =>
    Object.fromEntries(devices.map((d) => [d.id, d.price])),
  )

  const bestValueId = useMemo(() => {
    let bestId = devices[0]?.id
    let best = -Infinity
    for (const d of devices) {
      const v = d.thru / (prices[d.id] || 1)
      if (v > best) {
        best = v
        bestId = d.id
      }
    }
    return bestId
  }, [devices, prices])

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            Servers (per plan):{' '}
            <span className="font-medium text-foreground tabular-nums">{servers}</span>
          </span>
          <input
            type="range"
            min={1}
            max={30}
            step={1}
            value={servers}
            onChange={(e) => setServers(Number(e.target.value))}
            className="w-full accent-foreground"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Time</span>
            <div className="flex rounded-md border p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setMode('perDay')}
                className={cn(
                  'rounded-sm px-2 py-0.5 transition-colors',
                  mode === 'perDay'
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Per day
              </button>
              <button
                type="button"
                onClick={() => setMode('total')}
                className={cn(
                  'rounded-sm px-2 py-0.5 transition-colors',
                  mode === 'total'
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Total hours
              </button>
            </div>
          </div>
          {mode === 'perDay' ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">
                Hours / day:{' '}
                <span className="font-medium text-foreground tabular-nums">{hoursPerDay}</span>
              </span>
              <input
                type="range"
                min={1}
                max={24}
                step={1}
                value={hoursPerDay}
                onChange={(e) => setHoursPerDay(Number(e.target.value))}
                className="w-full accent-foreground"
              />
            </label>
          ) : (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Total hours</span>
              <input
                type="number"
                min={1}
                step={1}
                value={totalHours}
                onChange={(e) => setTotalHours(Math.max(1, Number(e.target.value)))}
                className="w-full rounded-md border bg-transparent px-2 py-1.5 text-sm tabular-nums"
              />
            </label>
          )}
        </div>
      </div>

      <PlansTable
        title="Hetzner — dedicated vCPU (CCX)"
        subtitle="Full dedicated EPYC cores. single-core verified (~1,877). Prices in EUR (Hetzner console, ex-VAT)."
        plans={HETZNER_PLANS}
        servers={servers}
        mode={mode}
        hoursPerDay={hoursPerDay}
        totalHours={totalHours}
        devices={devices}
        currency="€"
      />

      <PlansTable
        title="DigitalOcean — CPU-Optimized"
        subtitle="Standard, dedicated vCPUs (hyperthreads). Similar price to Hetzner but ~half the per-core speed (single-core verified ~957). Prices in USD."
        plans={DO_PLANS}
        servers={servers}
        mode={mode}
        hoursPerDay={hoursPerDay}
        totalHours={totalHours}
        devices={devices}
        currency="$"
      />

      <div>
        <h2 className="text-base font-semibold tracking-tight">Which device is the best value</h2>
        <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
          Parallel throughput per dollar. Edit prices to re-rank.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {devices.map((d) => {
            const price = prices[d.id] || 1
            const perDollar = d.thru / price
            const isBest = d.id === bestValueId
            return (
              <Card key={d.id} className={cn('p-4', isBest && 'border-[color:var(--success)]')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{d.name}</span>
                  {isBest && (
                    <span className="rounded-md bg-[color:var(--success)]/15 px-2 py-0.5 text-[11px] font-medium text-[color:var(--success)]">
                      best value
                    </span>
                  )}
                </div>
                <dl className="mt-3 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Max workers</dt>
                    <dd className="tabular-nums">{d.cores}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Parallel throughput</dt>
                    <dd className="tabular-nums">{d.thru.toLocaleString('en-US')}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">Price</dt>
                    <dd className="flex items-center gap-1">
                      <span className="text-muted-foreground">$</span>
                      <input
                        type="number"
                        min={1}
                        step={50}
                        value={prices[d.id] ?? 0}
                        onChange={(e) =>
                          setPrices((prev) => ({ ...prev, [d.id]: Number(e.target.value) }))
                        }
                        className="w-24 rounded-md border bg-transparent px-2 py-1 text-right text-sm tabular-nums"
                      />
                    </dd>
                  </div>
                </dl>
                <div className="mt-3 border-t pt-3">
                  <div className="text-xs text-muted-foreground">Throughput / $</div>
                  <div className="text-2xl font-semibold tabular-nums">{perDollar.toFixed(1)}</div>
                </div>
              </Card>
            )
          })}
        </div>
      </div>

      <p className="text-xs text-muted-foreground max-w-3xl">
        Metric is parallel throughput (cores × single-core Geekbench 6) — correct for independent
        per-market jobs, unlike GB6 multi which saturates around 16 cores. Hetzner single-core is
        verified (~1,877 per dedicated EPYC core); DigitalOcean single-core is verified (~957, Xeon
        Platinum 8168 — its vCPUs are hyperthreads, ~half a Hetzner core); Apple device throughput is
        a P/E-weighted estimate stored in <code className="font-mono">machines.json</code> — all
        calibrated by a real burst. Cost: in <strong>Per day</strong> mode it is hourly × hours/day ×
        30, capped at each plan&apos;s monthly maximum; in <strong>Total hours</strong> mode it is
        hourly × total hours (no monthly cap applied). Hetzner prices are in EUR (console, ex-VAT);
        DigitalOcean and device prices in USD.
      </p>
    </div>
  )
}
