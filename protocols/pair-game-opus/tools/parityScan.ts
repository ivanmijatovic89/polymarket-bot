#!/usr/bin/env npx tsx
/**
 * parityScan.ts — does "hold both legs, wait for the outside price to name a
 * side, then buy" fit the pair ceiling, and how often does the outside price
 * ever speak?
 *
 * Reads the whole-window observation channel (`--param debug=2`, one line per
 * second per market, written to a probe's `.err` file) plus the probe's `.rows`
 * table for the settled outcome, and prints one line per market per band:
 *
 *   the first instant the reading |diff|/need reaches the band, the side it
 *   names, whether that side won, the named side's ask there, the cheapest the
 *   other side gets afterwards, and what a parity plan would therefore pay for
 *   a thousand pairs.
 *
 * Usage:
 *   npx tsx protocols/pair-game-opus/tools/parityScan.ts \
 *     --obs '/tmp/pg/obs_*.err' --rows '/tmp/pg/obs_*.rows' [--band 1.6] [--hold 0.344]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'

/** Tiny glob: a directory plus one `*` in the file name is all this tool needs. */
const globSync = (pattern: string): string[] => {
  const dir = dirname(pattern)
  const pat = basename(pattern)
  const [head, tail] = pat.split('*')
  return readdirSync(dir)
    .filter((f) => f.startsWith(head) && f.endsWith(tail ?? ''))
    .sort()
    .map((f) => join(dir, f))
}

const argv = process.argv.slice(2)
const arg = (k: string, d?: string): string | undefined => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 ? argv[i + 1] : d
}
const obsGlob = arg('obs', '/tmp/pg/obs_*.err') as string
const rowsGlob = arg('rows', '/tmp/pg/obs_*.rows') as string
const bands = (arg('bands', '1.2,1.4,1.6,1.8,2.0') as string).split(',').map(Number)
const holdFrac = Number(arg('hold', '0.344'))
const qty = 1000
const ceil = 0.98

/** Fee-inclusive cost of one share at price p. */
const cost = (p: number): number => p + 0.07 * p * (1 - p)

type Tick = { t: number; askUp: number; askDown: number; frac: number; side: 'UP' | 'DOWN' }
const byMarket = new Map<string, Tick[]>()

for (const f of globSync(obsGlob)) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.includes('obs slug=')) continue
    const kv = new Map<string, string>()
    for (const part of line.split(/\s+/)) {
      const i = part.indexOf('=')
      if (i > 0) kv.set(part.slice(0, i), part.slice(i + 1))
    }
    const slug = kv.get('slug')
    const diff = kv.get('diff')
    const need = Number(kv.get('need'))
    if (!slug || diff === undefined || diff === '-' || !(need > 0)) continue
    const tRaw = line.match(/ t\+(\d+)s /)
    if (!tRaw) continue
    const d = Number(diff)
    const list = byMarket.get(slug) ?? []
    list.push({
      t: Number(tRaw[1]),
      askUp: Number(kv.get('askUp')),
      askDown: Number(kv.get('askDown')),
      frac: Math.abs(d) / need,
      side: d > 0 ? 'UP' : 'DOWN',
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

const slugs = [...byMarket.keys()].sort()
console.log(`markets=${slugs.length} hold=${holdFrac} ceil=${ceil}`)
for (const band of bands) {
  let never = 0
  let wrong = 0
  let overBudget = 0
  const lines: string[] = []
  for (const slug of slugs) {
    const ticks = byMarket.get(slug)!
    const hit = ticks.find((x) => x.frac >= band)
    const won = outcome.get(slug) ?? '?'
    if (!hit) {
      never++
      lines.push(`  ${slug} band=${band} NEVER won=${won}`)
      continue
    }
    const after = ticks.filter((x) => x.t >= hit.t)
    const winAsk = hit.side === 'UP' ? hit.askUp : hit.askDown
    const otherAsks = after.map((x) => (hit.side === 'UP' ? x.askDown : x.askUp))
    const otherMin = Math.min(...otherAsks)
    const otherLate = otherAsks[otherAsks.length - 1]
    const held = holdFrac * qty
    const rest = qty - held
    const totalMin = held * 1.035 + rest * (cost(winAsk) + cost(otherMin))
    const totalLate = held * 1.035 + rest * (cost(winAsk) + cost(otherLate))
    const right = won === hit.side
    if (!right) wrong++
    if (totalMin > qty * ceil) overBudget++
    lines.push(
      `  ${slug} band=${band} t=${hit.t}s side=${hit.side} won=${won}${right ? '' : ' WRONG'} ` +
        `winAsk=${winAsk.toFixed(3)} otherMin=${otherMin.toFixed(3)} otherLate=${otherLate.toFixed(3)} ` +
        `costMin=${totalMin.toFixed(0)} costLate=${totalLate.toFixed(0)}` +
        `${totalMin > qty * ceil ? ' OVER' : ''}`,
    )
  }
  console.log(
    `\nband ${band}: never=${never}/${slugs.length} wrongSide=${wrong} overBudget(min)=${overBudget}`,
  )
  for (const l of lines) console.log(l)
}
