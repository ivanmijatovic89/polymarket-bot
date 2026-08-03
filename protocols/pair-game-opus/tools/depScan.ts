#!/usr/bin/env npx tsx
/**
 * depScan.ts — is the 45-second warmup on the depth cap really a proxy for
 * "there is not enough resting size for the ratio to mean anything"?
 *
 * `depthAfterMs=45000` exists because a just-opened book is thin on both sides,
 * so the bid/ask share within three levels is noise. That is a statement about
 * ABSOLUTE depth, stated as a clock. This tool measures the thing itself.
 *
 * It reads the observation channel (`--param debug=2`), and for every market
 * walks the 1 Hz samples forward, smoothing the near-depth ratio of whichever
 * leg is dearer with the same time constant the player uses. The first sample
 * where that leg is dearer, its smoothed ratio is at or above `--gate`, and the
 * book crossed even within `--fresh` seconds, is the ARMING MOMENT: the instant
 * the depth cap would engage if the clock did not hold it back. At that instant
 * it reports the elapsed time, the ratio, and the absolute size resting within
 * three levels of that leg — bid, ask and total.
 *
 * The question it answers: can a size floor separate the level 80 window, which
 * arms at ~t+45 and must be capped, from the three windows the clock was added
 * to protect, which arm between t+10 and t+27 and must not be?
 *
 * Usage:
 *   npx tsx protocols/pair-game-opus/tools/depScan.ts [--gate 0.70] [--fresh 30]
 *     [--tau 10] [--obs '/tmp/pg/o80_*.err'] [--sort dep]
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
const obsGlob = arg('obs', '/tmp/pg/o80_*.err')
const gate = Number(arg('gate', '0.70'))
const freshS = Number(arg('fresh', '30'))
const tauS = Number(arg('tau', '10'))
const sortKey = arg('sort', 'slug')

/** The window level 80 adds. */
const SPECIMEN = 'btc-updown-15m-1775159100'
/** The three windows `depthAfterMs=45000` was added to protect. */
const PROTECTED = new Set(
  ['1775096100', '1775112300', '1775116800'].map((s) => `btc-updown-15m-${s}`),
)

type Sample = {
  t: number
  askUp: number
  askDown: number
  heldUp: number
  heldDown: number
  depUp: [number, number]
  depDown: [number, number]
}

const bySlug = new Map<string, Sample[]>()
const num = (s: string | undefined): number => (s === undefined ? NaN : Number(s))

for (const file of globSync(obsGlob)) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('[pair.v1] obs ')) continue
    const f = Object.fromEntries(
      line
        .slice(line.indexOf('obs ') + 4)
        .trim()
        .split(/\s+/)
        .map((kv) => {
          const i = kv.indexOf('=')
          return [kv.slice(0, i), kv.slice(i + 1)] as const
        }),
    )
    const slug = f['slug']
    if (!slug || !f['t+']) {
      // `t+123s` is positional, not key=value.
    }
    const tTok = line.match(/ t\+(-?\d+)s /)
    if (!slug || !tTok) continue
    const pair = (v: string | undefined): [number, number] => {
      const [a, b] = (v ?? '0/0').split('/')
      return [num(a), num(b)]
    }
    const [hu, hd] = pair(f['held'])
    const s: Sample = {
      t: Number(tTok[1]),
      askUp: num(f['askUp']),
      askDown: num(f['askDown']),
      heldUp: hu,
      heldDown: hd,
      depUp: pair(f['depUp']),
      depDown: pair(f['depDown']),
    }
    if (!Number.isFinite(s.askUp) || !Number.isFinite(s.askDown)) continue
    const arr = bySlug.get(slug)
    if (arr) arr.push(s)
    else bySlug.set(slug, [s])
  }
}

type Out = {
  slug: string
  armT: number | null
  ratio: number
  bid: number
  ask: number
  dep: number
  side: string
  minDep: number
  tag: string
}
const rows: Out[] = []

for (const [slug, raw] of bySlug) {
  const samples = raw.sort((a, b) => a.t - b.t)
  // The book's implied probability of UP, and the last time it sat at a coin
  // flip on each side — the same `lastEvenMs` the player keeps.
  const ema: Record<'UP' | 'DOWN', number | null> = { UP: null, DOWN: null }
  const evenAt: Record<'UP' | 'DOWN', number | null> = { UP: null, DOWN: null }
  let prevT: number | null = null
  let out: Out | null = null
  for (const s of samples) {
    const k = prevT === null || tauS <= 0 ? 1 : 1 - Math.exp(-(s.t - prevT) / tauS)
    prevT = s.t
    for (const [side, d] of [
      ['UP', s.depUp],
      ['DOWN', s.depDown],
    ] as const) {
      const tot = d[0] + d[1]
      if (tot <= 0) continue
      const r = d[0] / tot
      const p = ema[side]
      ema[side] = p === null ? r : p + k * (r - p)
    }
    // A leg is "at even" while its own ask is at or below the other's — the
    // crossing the player's freshness test measures.
    if (s.askUp <= s.askDown) evenAt['UP'] = s.t
    if (s.askDown <= s.askUp) evenAt['DOWN'] = s.t
    if (out) continue
    const first: 'UP' | 'DOWN' = s.askUp >= s.askDown ? 'UP' : 'DOWN'
    const other: 'UP' | 'DOWN' = first === 'UP' ? 'DOWN' : 'UP'
    const heldFirst = first === 'UP' ? s.heldUp : s.heldDown
    const heldOther = other === 'UP' ? s.heldUp : s.heldDown
    const r = ema[first]
    const ev = evenAt[first]
    const fresh = freshS <= 0 || (ev !== null && s.t - ev <= freshS)
    if (r !== null && r >= gate && fresh && heldFirst > heldOther) {
      const d = first === 'UP' ? s.depUp : s.depDown
      out = {
        slug,
        armT: s.t,
        ratio: r,
        bid: d[0],
        ask: d[1],
        dep: d[0] + d[1],
        side: first,
        minDep: 0,
        tag: '',
      }
    }
  }
  if (!out) {
    out = { slug, armT: null, ratio: 0, bid: 0, ask: 0, dep: 0, side: '-', minDep: 0, tag: '' }
  }
  // The smallest total near depth on the dearer leg over the arming instant and
  // the four seconds before it — a size floor has to survive the dips too.
  if (out.armT !== null) {
    const win = samples.filter((s) => s.t <= (out as Out).armT! && s.t >= (out as Out).armT! - 4)
    const tot = win.map((s) => {
      const d = out!.side === 'UP' ? s.depUp : s.depDown
      return d[0] + d[1]
    })
    out.minDep = tot.length ? Math.min(...tot) : out.dep
  }
  out.tag = slug === SPECIMEN ? 'L80' : PROTECTED.has(slug) ? 'PROT' : ''
  rows.push(out)
}

const key = (r: Out): number =>
  sortKey === 'dep'
    ? r.dep
    : sortKey === 'minDep'
      ? r.minDep
      : sortKey === 'arm'
        ? (r.armT ?? 1e9)
        : 0
rows.sort((a, b) => (sortKey === 'slug' ? a.slug.localeCompare(b.slug) : key(a) - key(b)))

console.log(
  `depScan: ${rows.length} markets  gate=${gate} fresh=${freshS}s tau=${tauS}s  (arm = first sample the depth cap could engage)`,
)
console.log('slug                       side  armT  ratio     bid     ask     dep  minDep  tag')
for (const r of rows) {
  console.log(
    `${r.slug.padEnd(26)} ${r.side.padEnd(5)} ` +
      `${(r.armT === null ? '-' : `${r.armT}s`).padStart(5)} ` +
      `${r.ratio.toFixed(2).padStart(5)} ` +
      `${r.bid.toFixed(0).padStart(7)} ${r.ask.toFixed(0).padStart(7)} ` +
      `${r.dep.toFixed(0).padStart(7)} ${r.minDep.toFixed(0).padStart(7)}  ${r.tag}`,
  )
}
const armed = rows.filter((r) => r.armT !== null)
console.log(
  `\narmed ${armed.length}/${rows.length}   ` +
    `dep percentiles: ${[0.1, 0.25, 0.5, 0.75, 0.9]
      .map((q) => {
        const v = armed.map((r) => r.dep).sort((a, b) => a - b)
        return `p${q * 100}=${(v[Math.floor(q * (v.length - 1))] ?? 0).toFixed(0)}`
      })
      .join(' ')}`,
)
