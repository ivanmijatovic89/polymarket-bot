#!/usr/bin/env npx tsx
/**
 * buyScan.ts — what did the player pay, and what did the outside price say at
 * the time?
 *
 * Reads the whole-window observation channel (`--param debug=2`) and, for every
 * second in which a leg's holding grew, records the ask on that leg and the
 * oracle reading |diff|/need at that instant. Then, per market, totals the
 * shares bought DEAR (ask at or above `--price`) while the outside price had
 * NOT confirmed that leg to `--band`.
 *
 * The point is to see whether the market that blocks the level is an outlier in
 * that total, i.e. whether "do not pay this much for a leg the outside price has
 * not confirmed" separates it from the markets that already pass.
 *
 * Usage:
 *   npx tsx protocols/pair-game-opus/tools/buyScan.ts [--price 0.55] [--band 1.6]
 *     [--obs '/tmp/pg/obs_*.err'] [--rows '/tmp/pg/obs_*.rows']
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'

const globSync = (pattern: string): string[] => {
  const dir = dirname(pattern)
  const [head, tail] = basename(pattern).split('*')
  return readdirSync(dir)
    .filter((f) => f.startsWith(head) && f.endsWith(tail ?? ''))
    .sort()
    .map((f) => join(dir, f))
}

const argv = process.argv.slice(2)
const arg = (k: string, d: string): string => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 ? (argv[i + 1] as string) : d
}
const obsGlob = arg('obs', '/tmp/pg/obs_*.err')
const rowsGlob = arg('rows', '/tmp/pg/obs_*.rows')
const priceCut = Number(arg('price', '0.55'))
const band = Number(arg('band', '1.6'))

type Row = {
  t: number
  askUp: number
  askDown: number
  up: number
  down: number
  frac: number
  side: 'UP' | 'DOWN'
}
const byMarket = new Map<string, Row[]>()

for (const f of globSync(obsGlob)) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.includes('obs slug=')) continue
    const kv = new Map<string, string>()
    for (const part of line.split(/\s+/)) {
      const i = part.indexOf('=')
      if (i > 0) kv.set(part.slice(0, i), part.slice(i + 1))
    }
    const slug = kv.get('slug')
    const t = line.match(/ t\+(\d+)s /)
    const heldRaw = (kv.get('held') ?? '').split('/')
    const diff = kv.get('diff')
    const need = Number(kv.get('need'))
    if (!slug || !t || heldRaw.length !== 2) continue
    const d = diff === undefined || diff === '-' ? null : Number(diff)
    const list = byMarket.get(slug) ?? []
    list.push({
      t: Number(t[1]),
      askUp: Number(kv.get('askUp')),
      askDown: Number(kv.get('askDown')),
      up: Number(heldRaw[0]),
      down: Number(heldRaw[1]),
      frac: d === null || !(need > 0) ? 0 : Math.abs(d) / need,
      side: (d ?? 0) > 0 ? 'UP' : 'DOWN',
    })
    byMarket.set(slug, list)
  }
}

const outcome = new Map<string, string>()
for (const f of globSync(rowsGlob)) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.trim().split(/\s+/)
    if (m[0]?.startsWith('btc-updown') && (m[1] === 'UP' || m[1] === 'DOWN')) outcome.set(m[0], m[1])
  }
}

type Out = {
  slug: string
  dearUnconfirmed: number
  dearSpend: number
  dearOnLoser: number
  worstAskUnconfirmed: number
  finalUp: number
  finalDown: number
}
const out: Out[] = []
for (const [slug, rows] of byMarket) {
  rows.sort((a, b) => a.t - b.t)
  let dear = 0
  let dearSpend = 0
  let dearLoser = 0
  let worst = 0
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1] as Row
    const cur = rows[i] as Row
    for (const side of ['UP', 'DOWN'] as const) {
      const grew = side === 'UP' ? cur.up - prev.up : cur.down - prev.down
      if (grew <= 0) continue
      const ask = side === 'UP' ? cur.askUp : cur.askDown
      const confirmed = cur.side === side && cur.frac >= band
      if (ask >= priceCut && !confirmed) {
        dear += grew
        dearSpend += grew * ask
        if (outcome.get(slug) !== side) dearLoser += grew
        worst = Math.max(worst, ask)
      }
    }
  }
  const last = rows[rows.length - 1] as Row
  out.push({
    slug,
    dearUnconfirmed: dear,
    dearSpend,
    dearOnLoser: dearLoser,
    worstAskUnconfirmed: worst,
    finalUp: last.up,
    finalDown: last.down,
  })
}

out.sort((a, b) => b.dearUnconfirmed - a.dearUnconfirmed)
console.log(`price>=${priceCut} band<${band}  (shares bought dear while unconfirmed)`)
console.log('  slug                         dear   $dear  onLoser  worstAsk  final')
for (const o of out) {
  console.log(
    `  ${o.slug} ${o.dearUnconfirmed.toFixed(0).padStart(6)} ${o.dearSpend.toFixed(0).padStart(7)} ` +
      `${o.dearOnLoser.toFixed(0).padStart(8)} ${o.worstAskUnconfirmed.toFixed(3).padStart(9)}  ` +
      `${o.finalUp.toFixed(0)}/${o.finalDown.toFixed(0)}`,
  )
}
