// SwiftBar plugin body — launched by polybot.5s.sh.
//
// Reads the backtest dashboard (:3051) and renders the worker fleet + active
// batch progress into the macOS menu bar. Zero dependencies: plain Node 18+
// (global fetch), no tsx, no build step, so the 5s refresh stays cheap.
//
// Output format: <title> | key=value ... — see SwiftBar's plugin API.

import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DASHBOARD = process.env.POLYBOT_MENUBAR_DASHBOARD_URL ?? 'http://localhost:3051'
const BULL_BOARD = process.env.POLYBOT_MENUBAR_BULL_BOARD_URL ?? 'http://localhost:3052'
const TITLE_MODE = process.env.POLYBOT_MENUBAR_TITLE ?? 'full'
const FETCH_TIMEOUT_MS = 2500
const MAX_BATCH_ROWS = 3
const STATE_PATH = join(tmpdir(), 'swiftbar-polybot-eta.json')

/** Menu bar tones. Each is `light,dark` so the colour holds in both appearances. */
const TONE = {
  active: '#0F6E56,#5DCAA5',
  stalled: '#854F0B,#FAC775',
  muted: '#888780,#B4B2A9',
}

/** SwiftBar splits a line on `|`, so no dynamic string may contain one. */
const clean = (s) => String(s).replace(/\|/g, '¦').trim()

/**
 * Friendly machine names, read straight from the same `machines.json` the
 * dashboard uses, so the menu bar and the Workers page never disagree.
 * Unregistered ids fall back to the raw hex, exactly like `machineLabel`.
 */
const machineNames = (() => {
  try {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
    return JSON.parse(readFileSync(join(repoRoot, 'dashboard/src/data/machines.json'), 'utf8'))
  } catch {
    return {}
  }
})()

const machineLabel = (id) => machineNames[id]?.name ?? id

function compact(n) {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  // 999,500+ rounds to "1000k" via the k-branch, so hand it to the M-branch —
  // the title must never grow past 4 characters per number.
  if (n < 999_500) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  const m = Math.round(seconds / 60)
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d${h % 24}h`
}

async function getJson(path) {
  const res = await fetch(`${DASHBOARD}${path}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`)
  return res.json()
}

/**
 * Throughput is derived from our own previous sample rather than from the API,
 * so the ETA costs nothing on the backend. An EWMA smooths the 5s jitter; a
 * shrinking `done` means the active batch set rolled over, so the rate resets
 * instead of reporting an ETA computed across two unrelated runs.
 */
function updateRate(done) {
  const now = Date.now()
  let prev = null
  try {
    prev = JSON.parse(readFileSync(STATE_PATH, 'utf8'))
  } catch {
    prev = null
  }

  let rate = null
  if (prev && typeof prev.done === 'number' && typeof prev.tsMs === 'number') {
    const dtSec = (now - prev.tsMs) / 1000
    if (done < prev.done) {
      rate = null
    } else if (dtSec >= 2 && dtSec <= 120) {
      const sample = (done - prev.done) / dtSec
      const previousRate = typeof prev.rate === 'number' ? prev.rate : null
      rate = previousRate === null ? sample : previousRate * 0.75 + sample * 0.25
    } else {
      rate = typeof prev.rate === 'number' ? prev.rate : null
    }
  }

  try {
    writeFileSync(STATE_PATH, JSON.stringify({ tsMs: now, done, rate }))
  } catch {
    // A read-only tmpdir just means no ETA; never break the menu bar over it.
  }
  return rate
}

/**
 * Menu bar width is the binding constraint, so the title is a preset rather
 * than a fixed layout:
 *
 *   full     machines · workers · queue · dot+pct   (~115px, the default)
 *   compact  workers · queue · dot+pct              (~90px)
 *   minimal  dot+pct only                           (~45px)
 *
 * Anything dropped here (eta, per-batch detail) lives in the dropdown, so no
 * information is lost — only the at-a-glance layer shrinks.
 *
 * Two hard-won rules encoded here:
 *
 * 1. Width must not change between idle and running. macOS silently hides a
 *    status item that stops fitting, so a title that grows when a run starts
 *    disappears exactly when it becomes useful. Every slot is always present
 *    (queue shows its real number, 0 included) and the eta — the one block
 *    with genuinely unbounded width ("4m" → "2h10m") — never enters the title.
 *
 * 2. No sfcolor/color parameters on the title. In practice SwiftBar tints the
 *    whole line, not just the indexed symbol, which made everything grey at
 *    idle and green while running. State colour is carried by an emoji dot
 *    instead — emoji render in their own colour, icons and text keep the
 *    native menu bar colour in both light and dark appearance. Idle is 🔵
 *    rather than ⚪/⚫ because a white or black circle disappears against one
 *    of the two menu bar appearances.
 */
function titleLine({ tone, machineCount, alive, queued, pct }) {
  const mode = TITLE_MODE
  const dot = tone === 'active' ? '🟢' : tone === 'stalled' ? '🟠' : '🔵'
  const progress = tone === 'idle' ? 'idle' : `${pct}%`

  const parts = []
  if (mode === 'full') parts.push(`:server.rack: ${machineCount}`)
  if (mode === 'full' || mode === 'compact') {
    parts.push(`:cpu: ${alive}`)
    parts.push(`:tray.full: ${compact(queued)}`)
  }
  parts.push(`${dot} ${progress}`)

  return `${parts.join('  ')} | sfsize=12`
}

function renderOffline(detail) {
  const out = [
    `:questionmark.circle: — | sfsize=12`,
    '---',
    `dashboard unreachable | color=${TONE.muted} size=11`,
    `${clean(detail)} | color=${TONE.muted} size=11 length=60`,
    '---',
    `Start it: npm run dashboard | color=${TONE.muted} size=11`,
    `Refresh now | refresh=true`,
  ]
  console.log(out.join('\n'))
}

async function main() {
  let workers
  let batchData
  let queueData
  try {
    // Queue counts are non-fatal: the badge still works without them, so a
    // slow BullMQ round-trip must not blank the whole menu bar item.
    ;[workers, batchData, queueData] = await Promise.all([
      getJson('/api/workers'),
      getJson('/api/batches/active'),
      getJson('/api/queues').catch(() => null),
    ])
  } catch (e) {
    renderOffline(e instanceof Error ? e.message : String(e))
    return
  }

  const machines = workers.machines ?? []
  const machineCount = machines.length
  const alive = workers.totals?.alive ?? 0

  const batches = batchData.batches ?? []
  const total = batches.reduce((s, b) => s + b.totalMarkets, 0)
  const done = batches.reduce((s, b) => s + b.completedChildren + b.failedChildren, 0)
  const outstanding = Math.max(0, total - done)
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  // Queue depth: real BullMQ counts from the markets queue when available
  // (jobs actually waiting to be picked up, whatever their parent batch),
  // falling back to the active batches' waiting children.
  const marketCounts = queueData?.markets ?? null
  const queued = marketCounts
    ? Number(marketCounts.waiting ?? 0) + Number(marketCounts.delayed ?? 0)
    : batches.reduce((s, b) => s + b.waitingChildren, 0)

  const tone = outstanding > 0 ? (alive > 0 ? 'active' : 'stalled') : 'idle'
  const rate = tone === 'idle' ? null : updateRate(done)
  const eta = rate && rate > 0.0001 ? duration(outstanding / rate) : null

  const lines = []
  lines.push(titleLine({ tone, machineCount, alive, queued, pct }))

  lines.push('---')
  lines.push(
    `polymarket bot · ${DASHBOARD.replace(/^https?:\/\//, '')} | color=${TONE.muted} size=11`,
  )
  lines.push('---')

  if (batches.length === 0) {
    lines.push(`no active batches | color=${TONE.muted} size=11`)
  } else {
    lines.push(`active batches (${batches.length}) | color=${TONE.muted} size=11`)
    for (const b of batches.slice(0, MAX_BATCH_ROWS)) {
      const bPct =
        b.totalMarkets > 0
          ? Math.round(((b.completedChildren + b.failedChildren) / b.totalMarkets) * 100)
          : 0
      const label = `${clean(b.strategy)}  ${compact(b.completedChildren + b.failedChildren)}/${compact(b.totalMarkets)} · ${bPct}%`
      lines.push(
        `${label} | font=Menlo size=12 href=${DASHBOARD}/batches/${encodeURIComponent(b.batchUid)}`,
      )
      if (b.failedChildren > 0) {
        lines.push(
          `  ${compact(b.failedChildren)} failed | font=Menlo size=11 color=#A32D2D,#F09595 href=${DASHBOARD}/batches/${encodeURIComponent(b.batchUid)}`,
        )
      }
    }
    if (batches.length > MAX_BATCH_ROWS) {
      lines.push(`  +${batches.length - MAX_BATCH_ROWS} more | color=${TONE.muted} size=11`)
    }
    if (rate && rate > 0.0001) {
      lines.push(
        `eta ~${eta ?? '—'} · ${Math.round(rate * 60)} mkts/min | color=${TONE.muted} size=11`,
      )
    }
  }

  if (queueData) {
    lines.push('---')
    lines.push(`queues | color=${TONE.muted} size=11`)
    for (const [name, counts] of [
      ['markets', queueData.markets],
      ['aggregate', queueData.aggregate],
    ]) {
      if (!counts) continue
      const waiting = Number(counts.waiting ?? 0) + Number(counts.delayed ?? 0)
      const active = Number(counts.active ?? 0)
      const failed = Number(counts.failed ?? 0)
      lines.push(
        `${name}  ${compact(waiting)} waiting · ${compact(active)} active | font=Menlo size=12 href=${BULL_BOARD}`,
      )
      if (failed > 0) {
        lines.push(
          `  ${compact(failed)} failed | font=Menlo size=11 color=#A32D2D,#F09595 href=${BULL_BOARD}`,
        )
      }
    }
  }

  // Rows need an action (href) or SwiftBar renders them disabled-grey; the
  // fleet lives on the dashboard's overview page, so link every row there.
  lines.push('---')
  lines.push(`workers | color=${TONE.muted} size=11`)
  const machineWord = machineCount === 1 ? 'machine' : 'machines'
  lines.push(
    `${machineCount} ${machineWord} · ${alive} alive | font=Menlo size=12 href=${DASHBOARD}`,
  )
  for (const m of machines) {
    lines.push(
      `  ${clean(machineLabel(m.machineId))}  ${m.totals.aliveCount} | font=Menlo size=12 href=${DASHBOARD}`,
    )
  }

  lines.push('---')
  lines.push(`Open dashboard | href=${DASHBOARD}`)
  lines.push(`Open Bull Board | href=${BULL_BOARD}`)
  lines.push('Refresh now | refresh=true')

  console.log(lines.join('\n'))
}

main().catch((e) => {
  renderOffline(e instanceof Error ? e.message : String(e))
})
