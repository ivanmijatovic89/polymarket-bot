#!/usr/bin/env npx tsx
/**
 * bookScan.ts — does the BOOK's own behaviour separate the level 68 window from
 * the windows that need the aggressive chase?
 *
 * Every rule tried so far scores what the PLAYER does (shares held, money spent,
 * how far it has committed past its cash) or what BTC does (the oracle, the
 * model-book disagreement). All of them fire everywhere or nowhere. This tool
 * asks the one question nobody has measured: what does the book itself do around
 * the commitment?
 *
 * The commitment ("the buyout") is located without reference to any rule: the
 * tick with the largest rise in `spent` over a `--jumpWin` second window. At that
 * instant every feature below is computed from the PAST ONLY, so anything that
 * separates is legal to act on:
 *
 *   ask    the chased leg's ask — what the buyout pays
 *   gap    askChased - askOther, the reading `edgeFull` already uses
 *   v20    the book's velocity, (pBook now - pBook 20s ago) / 20, signed toward
 *          the chased leg — how FAST the lean arrived
 *   run    how far the book has come from its own extreme in the other direction
 *   age    seconds since the book last sat at a coin flip
 *   vol    the book's own churn: mean |dpBook| per second over the trailing 60s
 *   eff    path efficiency of the book over [0, tBuy): |net| / total movement.
 *          Low = the book has been chopping rather than trending.
 *
 * Then it ranks the specimen against the whole field and against the eighteen
 * windows already measured to break when money or shares are withheld — the set
 * any new rule must not disturb.
 *
 * Usage:
 *   npx tsx protocols/pair-game-opus/tools/bookScan.ts [--jumpWin 5] [--sort v20]
 *     [--obs ...] [--rows ...]
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
const jumpWin = Number(arg('jumpWin', '5'))
const minAsk = Number(arg('minAsk', '0.55'))
const imbWin = Number(arg('imbWin', '10'))
const imbGate = Number(arg('imbGate', '0.84'))
const sortKey = arg('sort', 'slug')

/** The one window level 68 adds. */
const SPECIMEN = 'btc-updown-15m-1775148300'
/** Windows that break when `fairHold` caps the leg the model is ahead on. */
const FH = [
  '1775092500',
  '1775093400',
  '1775095200',
  '1775104200',
  '1775107800',
  '1775120400',
  '1775131200',
  '1775132100',
  '1775140200',
]
/** Windows that break when `reserveLow=0.8` holds money back. */
const RL = [
  '1775089800',
  '1775094300',
  '1775109600',
  '1775110500',
  '1775124900',
  '1775129400',
  '1775133900',
  '1775138400',
  '1775147400',
]
const fh = new Set(FH.map((s) => `btc-updown-15m-${s}`))
const rl = new Set(RL.map((s) => `btc-updown-15m-${s}`))

type Row = {
  t: number
  askUp: number
  askDown: number
  up: number
  down: number
  spent: number
  pBook: number
  bidU: number
  askU: number
  bidD: number
  askD: number
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
    const tm = line.match(/ t\+(\d+)s /)
    const held = (kv.get('held') ?? '').split('/')
    if (!slug || !tm || held.length !== 2) continue
    const list = byMarket.get(slug) ?? []
    list.push({
      t: Number(tm[1]),
      askUp: Number(kv.get('askUp')),
      askDown: Number(kv.get('askDown')),
      up: Number(held[0]),
      down: Number(held[1]),
      spent: Number(kv.get('spent')),
      pBook: Number(kv.get('pBook')),
      bidU: Number((kv.get('depUp') ?? '0/0').split('/')[0]),
      askU: Number((kv.get('depUp') ?? '0/0').split('/')[1]),
      bidD: Number((kv.get('depDown') ?? '0/0').split('/')[0]),
      askD: Number((kv.get('depDown') ?? '0/0').split('/')[1]),
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
  tag: string
  won: string
  t: number
  side: string
  right: boolean
  ask: number
  gap: number
  v20: number
  v10: number
  run: number
  age: number
  askDep: number
  imb: number
  imbS: number
  oImb: number
  thin: number
  vol: number
  vol60: number
  volPre: number
  eff: number
}

const at = (r: Row[], i: number, back: number): Row => r[Math.max(0, i - back)] as Row

const rows: Out[] = []
for (const slug of [...byMarket.keys()].sort()) {
  const r = byMarket.get(slug)!.sort((a, b) => a.t - b.t)
  const won = outcome.get(slug) ?? '?'

  // The buyout: the largest rise in `spent` over `jumpWin` seconds. Located
  // from the spend series alone, so it does not assume which rule granted it.
  // Only ticks that bought a leg priced at `minAsk` or more count: the chase is
  // the money spent on a leg the market has already made dear, not the cheap
  // completion of the other side that usually dominates the raw spend series.
  let bi = 0
  let best = -1
  for (let i = 1; i < r.length; i++) {
    const x = r[i] as Row
    const p = at(r, i, jumpWin)
    const d = x.spent - p.spent
    if (d <= best) continue
    const s = x.up - p.up >= x.down - p.down ? 'UP' : 'DOWN'
    if ((s === 'UP' ? x.askUp : x.askDown) < minAsk) continue
    best = d
    bi = i
  }
  const b = r[bi] as Row
  // Which leg the buyout bought: the one whose holding grew across the jump.
  const b0 = at(r, bi, jumpWin)
  const side = b.up - b0.up >= b.down - b0.down ? 'UP' : 'DOWN'
  const sgn = side === 'UP' ? 1 : -1
  const ask = side === 'UP' ? b.askUp : b.askDown
  const other = side === 'UP' ? b.askDown : b.askUp

  const v20 = (sgn * (b.pBook - at(r, bi, 20).pBook)) / 20
  const v10 = (sgn * (b.pBook - at(r, bi, 10).pBook)) / 10
  // how far the book has come from its own extreme against the chased leg
  let ext = b.pBook
  for (let i = 0; i <= bi; i++) {
    const p = (r[i] as Row).pBook
    if (sgn > 0 ? p < ext : p > ext) ext = p
  }
  const run = sgn * (b.pBook - ext)
  // seconds since the book last sat at a coin flip on the chased side
  let age = b.t
  for (let i = bi; i >= 0; i--) {
    const p = (r[i] as Row).pBook
    if (sgn > 0 ? p <= 0.5 : p >= 0.5) {
      age = b.t - (r[i] as Row).t
      break
    }
  }
  const churn = (from: number, to: number): number => {
    let mv = 0
    let n = 0
    for (let i = Math.max(1, from); i <= Math.min(r.length - 1, to); i++) {
      mv += Math.abs((r[i] as Row).pBook - (r[i - 1] as Row).pBook)
      n++
    }
    return n > 0 ? mv / n : 0
  }
  // depth on the chased leg at the moment the buyout fires, and the same book's
  // own imbalance: is the lean backed by size, or is the ask simply thin?
  const askDep = sgn > 0 ? b.askU : b.askD
  const bidDep = sgn > 0 ? b.bidU : b.bidD
  const oAskDep = sgn > 0 ? b.askD : b.askU
  const oBidDep = sgn > 0 ? b.bidD : b.bidU
  const imb = askDep + bidDep > 0 ? bidDep / (askDep + bidDep) : 0.5
  // the same reading smoothed over `imbWin` seconds — a live rule cannot act on
  // a single tick's ladder without acting on every momentary hole in the offer
  let is = 0
  let isN = 0
  for (let i = Math.max(0, bi - imbWin); i <= bi; i++) {
    const x = r[i] as Row
    const a = sgn > 0 ? x.askU : x.askD
    const d = sgn > 0 ? x.bidU : x.bidD
    if (a + d <= 0) continue
    is += d / (a + d)
    isN++
  }
  const imbS = isN > 0 ? is / isN : 0.5
  const oImb = oAskDep + oBidDep > 0 ? oBidDep / (oAskDep + oBidDep) : 0.5
  // how thin the offer is against what this player is about to buy
  const thin = best > 0 ? askDep / Math.max(1, best) : 0

  const vol = churn(bi - 60, bi)
  // the same churn measured on windows the lean itself cannot contaminate:
  // a fixed early slice, and the forty seconds ending twenty before the chase
  const vol60 = churn(10, 70)
  const volPre = churn(bi - 60, bi - 20)
  let path = 0
  for (let i = 1; i <= bi; i++) path += Math.abs((r[i] as Row).pBook - (r[i - 1] as Row).pBook)
  const eff = path > 0 ? Math.abs(b.pBook - (r[0] as Row).pBook) / path : 0

  rows.push({
    slug,
    tag: slug === SPECIMEN ? 'SPEC' : fh.has(slug) ? 'fh' : rl.has(slug) ? 'rl' : '',
    won,
    t: b.t,
    side,
    right: side === won,
    ask,
    gap: ask - other,
    v20,
    v10,
    run,
    age,
    askDep,
    imb,
    imbS,
    oImb,
    thin,
    vol,
    vol60,
    volPre,
    eff,
  })
}

const cmp: Record<string, (a: Out, b: Out) => number> = {
  slug: (a, b) => a.slug.localeCompare(b.slug),
  v20: (a, b) => a.v20 - b.v20,
  v10: (a, b) => a.v10 - b.v10,
  run: (a, b) => a.run - b.run,
  ask: (a, b) => a.ask - b.ask,
  gap: (a, b) => a.gap - b.gap,
  age: (a, b) => b.age - a.age,
  askDep: (a, b) => a.askDep - b.askDep,
  imb: (a, b) => a.imb - b.imb,
  imbS: (a, b) => a.imbS - b.imbS,
  oImb: (a, b) => a.oImb - b.oImb,
  thin: (a, b) => a.thin - b.thin,
  vol: (a, b) => a.vol - b.vol,
  vol60: (a, b) => a.vol60 - b.vol60,
  volPre: (a, b) => a.volPre - b.volPre,
  eff: (a, b) => a.eff - b.eff,
  t: (a, b) => a.t - b.t,
}
rows.sort(cmp[sortKey] ?? cmp.slug!)

console.log(`markets=${rows.length} jumpWin=${jumpWin}s sort=${sortKey}`)
console.log('slug                       tag  won  tBuy side ok |  ask   gap    v20     v10     run   age  askDep  imb   imbS  thin   vol    vol60  eff')
for (const o of rows) {
  console.log(
    `${o.slug} ${o.tag.padEnd(4)} ${o.won.padEnd(4)} ${String(o.t).padStart(4)} ` +
      `${o.side.padEnd(4)} ${o.right ? 'Y' : 'n'} | ` +
      `${o.ask.toFixed(3)} ${o.gap.toFixed(3).padStart(6)} ${o.v20.toFixed(4).padStart(7)} ${o.v10.toFixed(4).padStart(7)} ` +
      `${o.run.toFixed(3).padStart(6)} ${String(o.age).padStart(4)} ${o.askDep.toFixed(0).padStart(6)} ${o.imb.toFixed(3)} ${o.imbS.toFixed(3)} ${o.thin.toFixed(2).padStart(5)} ${o.vol.toFixed(4)} ${o.vol60.toFixed(4)} ${o.eff.toFixed(3)}`,
  )
}

const spec = rows.find((o) => o.slug === SPECIMEN)
if (spec) {
  const need = rows.filter((o) => o.tag === 'fh' || o.tag === 'rl')
  const feats: Array<[string, (o: Out) => number]> = [
    ['ask', (o) => o.ask],
    ['gap', (o) => o.gap],
    ['v20', (o) => o.v20],
    ['v10', (o) => o.v10],
    ['run', (o) => o.run],
    ['age', (o) => o.age],
    ['askDep', (o) => o.askDep],
    ['imb', (o) => o.imb],
    ['imbS', (o) => o.imbS],
    ['oImb', (o) => o.oImb],
    ['thin', (o) => o.thin],
    ['vol', (o) => o.vol],
    ['vol60', (o) => o.vol60],
    ['volPre', (o) => o.volPre],
    ['eff', (o) => o.eff],
    ['tBuy', (o) => o.t],
  ]
  console.log('\nspecimen separation (rank 1 = lowest value; how many windows sit BELOW the specimen)')
  console.log('feature   specimen   rank/68   rank among the 18 that need the chase')
  for (const [name, f] of feats) {
    const v = f(spec)
    const rAll = rows.filter((o) => f(o) < v).length + 1
    const rNeed = need.filter((o) => f(o) < v).length + 1
    console.log(
      `${name.padEnd(9)} ${v.toFixed(4).padStart(8)}   ${String(rAll).padStart(2)}/68     ` +
        `${String(rNeed).padStart(2)}/${need.length}`,
    )
  }
}


// How often would a live gate on this reading actually fire? For every window,
// count the seconds at which the DEARER leg's smoothed depth imbalance sits at
// or above `--imbGate` while that leg is still worth buying (ask over `minAsk`).
// A rule is only usable if that count is near zero in the windows that need the
// chase.
console.log(`\nlive blast radius of imbS >= ${imbGate} on the dearer leg (ask >= ${minAsk})`)
console.log('slug                       tag  won  seconds  firstAt  chasedSideWon')
const blast: Array<{ slug: string; tag: string; n: number; first: number }> = []
for (const o of rows) {
  const r = byMarket.get(o.slug)!.sort((a, b) => a.t - b.t)
  let n = 0
  let first = -1
  for (let i = 0; i < r.length; i++) {
    const x = r[i] as Row
    if (x.t > 600) break
    if (x.t < 10) continue
    const up = x.askUp >= x.askDown
    const ask = up ? x.askUp : x.askDown
    if (ask < minAsk) continue
    // Only firings that would actually bite: the dearer leg must still be being
    // bought. A gate that fires once the leg is complete costs nothing.
    if ((up ? x.up : x.down) >= 950) continue
    let is = 0
    let isN = 0
    for (let j = Math.max(0, i - imbWin); j <= i; j++) {
      const y = r[j] as Row
      const a = up ? y.askU : y.askD
      const d = up ? y.bidU : y.bidD
      if (a + d <= 0) continue
      is += d / (a + d)
      isN++
    }
    if (isN > 0 && is / isN >= imbGate) {
      n++
      if (first < 0) first = x.t
    }
  }
  blast.push({ slug: o.slug, tag: o.tag, n, first })
}
blast.sort((a, b) => b.n - a.n)
for (const b of blast) {
  if (b.n === 0 && b.tag === '') continue
  const o = rows.find((x) => x.slug === b.slug)!
  console.log(
    `${b.slug} ${b.tag.padEnd(4)} ${o.won.padEnd(4)} ${String(b.n).padStart(7)}  ${String(b.first).padStart(7)}  ${o.right ? 'Y' : 'n'}`,
  )
}
console.log(`windows that never fire: ${blast.filter((b) => b.n === 0).length}/68`)
