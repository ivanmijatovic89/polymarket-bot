#!/usr/bin/env npx tsx
/**
 * volScan.ts — is the outside price a better witness when its distance is
 * measured in the day's OWN volatility instead of a fixed number of dollars?
 *
 * The player's oracle reading is `|diff| / (ptbEdge * sqrt(timeLeft))`, and
 * `ptbEdge` is a constant: the same sixty dollars means the same thing in a calm
 * quarter-hour and a violent one. This tool recomputes the reading from the
 * observation channel with the volatility estimated from BTC's own recent
 * movement — `|diff| / (sigmaHat * sqrt(secondsLeft))`, `sigmaHat` the standard
 * deviation of one-second moves over a trailing window — and scores both
 * readings the same way: at the first instant each crosses a band, does it name
 * the side that actually won, and what would completing the pair have cost.
 *
 * Usage:
 *   npx tsx protocols/pair-game-opus/tools/volScan.ts [--bands 1.2,1.6,2.0]
 *     [--win 180] [--hold 0] [--obs ...] [--rows ...]
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
const bands = arg('bands', '1.2,1.4,1.6,1.8,2.0,2.5').split(',').map(Number)
const volWin = Number(arg('win', '180'))
const minSamples = Number(arg('minSamples', '30'))
const holdFrac = Number(arg('hold', '0'))
const detail = argv.includes('--detail')
const WINDOW_S = 900
const qty = 1000
const ceilTotal = 980

const cost = (p: number): number => p + 0.07 * p * (1 - p)

type Row = { t: number; askUp: number; askDown: number; diff: number | null; need: number }
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
    const tm = line.match(/ t\+(\d+)s /)
    if (!slug || !tm) continue
    const d = kv.get('diff')
    const list = byMarket.get(slug) ?? []
    list.push({
      t: Number(tm[1]),
      askUp: Number(kv.get('askUp')),
      askDown: Number(kv.get('askDown')),
      diff: d === undefined || d === '-' ? null : Number(d),
      need: Number(kv.get('need')),
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

/** First crossing of `band` by `frac`, with the cost of completing from there. */
type Hit = { t: number; side: 'UP' | 'DOWN'; winAsk: number; otherMin: number; total: number }
const firstHit = (rows: Row[], frac: (r: Row, i: number) => number, band: number): Hit | null => {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as Row
    if (r.diff === null) continue
    if (frac(r, i) < band) continue
    const side = r.diff > 0 ? 'UP' : 'DOWN'
    const winAsk = side === 'UP' ? r.askUp : r.askDown
    const rest = rows.slice(i).map((x) => (side === 'UP' ? x.askDown : x.askUp))
    const otherMin = Math.min(...rest)
    const held = holdFrac * qty
    const total = held * 1.035 + (qty - held) * (cost(winAsk) + cost(otherMin))
    return { t: r.t, side, winAsk, otherMin, total }
  }
  return null
}

const slugs = [...byMarket.keys()].sort()
console.log(`markets=${slugs.length} volWin=${volWin}s hold=${holdFrac} ceil=${ceilTotal}`)
console.log('reading                band  never  wrongSide  overBudget  medianT')

for (const band of bands) {
  for (const mode of ['fixed', 'adaptive'] as const) {
    let never = 0
    let wrong = 0
    let over = 0
    const times: number[] = []
    const lines: string[] = []
    for (const slug of slugs) {
      const rows = byMarket.get(slug)!.sort((a, b) => a.t - b.t)
      // trailing realised volatility of the outside price, per second
      const sig: number[] = []
      for (let i = 0; i < rows.length; i++) {
        const from = Math.max(0, i - volWin)
        let n = 0
        let s2 = 0
        for (let j = from + 1; j <= i; j++) {
          const a = rows[j] as Row
          const b = rows[j - 1] as Row
          if (a.diff === null || b.diff === null) continue
          const dt = Math.max(1, a.t - b.t)
          const step = (a.diff - b.diff) / Math.sqrt(dt)
          s2 += step * step
          n++
        }
        sig.push(n >= minSamples ? Math.sqrt(s2 / n) : NaN)
      }
      const frac =
        mode === 'fixed'
          ? (r: Row) => (r.diff === null || !(r.need > 0) ? 0 : Math.abs(r.diff) / r.need)
          : (r: Row, i: number) => {
              const s = sig[i] as number
              const left = Math.max(1, WINDOW_S - r.t)
              if (!Number.isFinite(s) || s <= 0 || r.diff === null) return 0
              return Math.abs(r.diff) / (s * Math.sqrt(left))
            }
      const hit = firstHit(rows, frac, band)
      const won = outcome.get(slug) ?? '?'
      if (!hit) {
        never++
        lines.push(`    ${slug} NEVER won=${won}`)
        continue
      }
      times.push(hit.t)
      const right = hit.side === won
      if (!right) wrong++
      if (hit.total > ceilTotal) over++
      lines.push(
        `    ${slug} t=${hit.t}s side=${hit.side} won=${won}${right ? '' : ' WRONG'} ` +
          `winAsk=${hit.winAsk.toFixed(3)} otherMin=${hit.otherMin.toFixed(3)} cost=${hit.total.toFixed(0)}` +
          `${hit.total > ceilTotal ? ' OVER' : ''}`,
      )
    }
    times.sort((a, b) => a - b)
    const med = times.length ? times[Math.floor(times.length / 2)] : -1
    console.log(
      `${mode.padEnd(22)} ${String(band).padStart(4)}  ${String(never).padStart(5)}  ` +
        `${String(wrong).padStart(9)}  ${String(over).padStart(10)}  ${String(med).padStart(7)}s`,
    )
    if (detail) for (const l of lines) console.log(l)
  }
}

// `--dump <slug>`: the two readings side by side, second by second.
const dumpSlug = arg('dump', '')
if (dumpSlug) {
  const rows = (byMarket.get(dumpSlug) ?? []).sort((a, b) => a.t - b.t)
  console.log(`\n${dumpSlug}: t  askUp askDown  diff  fixedFrac  sigmaHat  adaptiveZ`)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as Row
    if (i % 10 !== 0) continue
    const from = Math.max(0, i - volWin)
    let n = 0
    let s2 = 0
    for (let j = from + 1; j <= i; j++) {
      const a = rows[j] as Row
      const b = rows[j - 1] as Row
      if (a.diff === null || b.diff === null) continue
      const dt = Math.max(1, a.t - b.t)
      const step = (a.diff - b.diff) / Math.sqrt(dt)
      s2 += step * step
      n++
    }
    const s = n >= minSamples ? Math.sqrt(s2 / n) : NaN
    const left = Math.max(1, WINDOW_S - r.t)
    const z = r.diff === null || !(s > 0) ? NaN : Math.abs(r.diff) / (s * Math.sqrt(left))
    console.log(
      `  t+${String(r.t).padStart(3)}s ${r.askUp.toFixed(3)} ${r.askDown.toFixed(3)}  ` +
        `${(r.diff ?? NaN).toFixed(1).padStart(7)}  ` +
        `${(r.diff === null || !(r.need > 0) ? NaN : Math.abs(r.diff) / r.need).toFixed(2).padStart(5)}  ` +
        `${s.toFixed(2).padStart(6)}  ${z.toFixed(2).padStart(6)}${r.diff !== null && r.diff > 0 ? ' UP' : ' DOWN'}`,
    )
  }
}

// `--release <band>`: for every market, the first instant the volatility-
// normalised reading reaches the band NAMING THE SIDE THAT WON, and that side's
// ask there. This is the question a cap needs answered: if a leg is held back
// because the model is running ahead of the book, how late — and how dear — is
// the witness that would let it go?
const relBand = Number(arg('release', '0'))
if (relBand > 0) {
  console.log(`\nrelease band ${relBand} (naming the winner): slug t winnerAsk otherAsk`)
  for (const slug of slugs) {
    const rows = (byMarket.get(slug) ?? []).sort((a, b) => a.t - b.t)
    const won = outcome.get(slug)
    let hit: Row | null = null
    let hitZ = 0
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] as Row
      if (r.diff === null) continue
      const from = Math.max(0, i - volWin)
      let n = 0
      let s2 = 0
      for (let j = from + 1; j <= i; j++) {
        const a = rows[j] as Row
        const b = rows[j - 1] as Row
        if (a.diff === null || b.diff === null) continue
        const dt = Math.max(1, a.t - b.t)
        const step = (a.diff - b.diff) / Math.sqrt(dt)
        s2 += step * step
        n++
      }
      const s = n >= minSamples ? Math.sqrt(s2 / n) : NaN
      if (!(s > 0)) continue
      const z = Math.abs(r.diff) / (s * Math.sqrt(Math.max(1, WINDOW_S - r.t)))
      if (z >= relBand && (r.diff > 0 ? 'UP' : 'DOWN') === won) {
        hit = r
        hitZ = z
        break
      }
    }
    if (!hit) console.log(`  ${slug} NEVER won=${won}`)
    else
      console.log(
        `  ${slug} t=${String(hit.t).padStart(3)}s won=${won} z=${hitZ.toFixed(2)} ` +
          `winAsk=${(won === 'UP' ? hit.askUp : hit.askDown).toFixed(3)} ` +
          `otherAsk=${(won === 'UP' ? hit.askDown : hit.askUp).toFixed(3)}`,
      )
  }
}
