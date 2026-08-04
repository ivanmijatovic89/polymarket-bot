/**
 * closeScan — what the book looked like at the moment the player COMPLETED a leg.
 *
 * The three markets that have blocked levels 101, 108 and 109 all die the same
 * way: one leg is taken from half-built to its target in a single burst, in the
 * middle of the window, and the money that burst spends is exactly the money the
 * other leg needed. This scan asks the field the obvious question — when every
 * OTHER window completes a leg, what is the other leg quoted at, how much of it
 * is already held, and how much of the window is left?
 *
 * Input is the observation channel (`--param debug=2`), so run a sweep first:
 *
 *   protocols/pair-game-opus/tools/sweep80.sh obsf 110 --param debug=2 --param debugEveryMs=500
 *   npx tsx protocols/pair-game-opus/tools/closeScan.ts --tag obsf [--sort other|t|slug]
 */
import { readFileSync, readdirSync } from 'node:fs'

const argv = process.argv.slice(2)
const arg = (k: string, d: string): string => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 && argv[i + 1] !== undefined ? (argv[i + 1] as string) : d
}
const tag = arg('tag', 'obsf')
const sort = arg('sort', 'other')

type Sample = {
  t: number
  askUp: number
  askDown: number
  up: number
  down: number
  spent: number
  diff: number
  z: number
  pModel: number
  dimbUp: number
}
const bySlug = new Map<string, Sample[]>()

const dir = '/tmp/pg'
const files = readdirSync(dir).filter((f) => f.startsWith(`sw${tag}_`) && f.endsWith('.err'))
if (files.length === 0) {
  console.error(`no /tmp/pg/sw${tag}_*.err files — run a sweep with --param debug=2 first`)
  process.exit(1)
}
const re =
  /obs slug=(\S+) t\+(\d+)s askUp=([\d.]+) askDown=([\d.]+) held=([\d.]+)\/([\d.]+) spent=([\d.]+) diff=(\S+) need=\S+ z=([\d.]+) pModel=(\S+) pBook=\S+ depUp=\S+ depDown=\S+ dimb=([\d.-]+)\//
for (const f of files) {
  for (const line of readFileSync(`${dir}/${f}`, 'utf8').split('\n')) {
    const m = re.exec(line)
    if (!m) continue
    const slug = m[1] as string
    let rows = bySlug.get(slug)
    if (!rows) bySlug.set(slug, (rows = []))
    rows.push({
      t: Number(m[2]),
      askUp: Number(m[3]),
      askDown: Number(m[4]),
      up: Number(m[5]),
      down: Number(m[6]),
      spent: Number(m[7]),
      diff: Number(m[8]),
      z: Number(m[9]),
      pModel: Number(m[10]),
      dimbUp: Number(m[11]),
    })
  }
}

type Row = {
  slug: string
  t: number
  side: string
  askSide: number
  askOther: number
  otherHeld: number
  spent: number
  /** Volatility-normalised distance of BTC from the strike, SIGNED toward the completed leg. */
  zSigned: number
  /** The model's probability for the completed leg. */
  pSide: number
  /** Smoothed near-depth share sitting on the completed leg. */
  dimb: number
  finalUp: number
  finalDown: number
  ok: boolean
}
const out: Row[] = []
for (const [slug, rows] of bySlug) {
  const last = rows[rows.length - 1] as Sample
  let prev: Sample | null = null
  let hit: Row | null = null
  for (const s of rows) {
    if (prev) {
      const upDone = prev.up < 990 && s.up >= 990
      const downDone = prev.down < 990 && s.down >= 990
      if (upDone || downDone) {
        const side = upDone ? 'UP' : 'DOWN'
        hit = {
          slug,
          t: s.t,
          side,
          askSide: upDone ? s.askUp : s.askDown,
          askOther: upDone ? s.askDown : s.askUp,
          otherHeld: upDone ? s.down : s.up,
          spent: s.spent,
          zSigned: (upDone ? 1 : -1) * (s.diff >= 0 ? s.z : -s.z),
          pSide: upDone ? s.pModel : 1 - s.pModel,
          dimb: upDone ? s.dimbUp : 1 - s.dimbUp,
          finalUp: last.up,
          finalDown: last.down,
          ok: last.up >= 1000 && last.down >= 1000,
        }
        break
      }
    }
    prev = s
  }
  if (hit) out.push(hit)
  else
    out.push({
      slug,
      t: -1,
      side: '-',
      askSide: 0,
      askOther: 0,
      otherHeld: 0,
      spent: last.spent,
      zSigned: 0,
      pSide: 0,
      dimb: 0,
      finalUp: last.up,
      finalDown: last.down,
      ok: last.up >= 1000 && last.down >= 1000,
    })
}

out.sort((a, b) =>
  sort === 't'
    ? a.t - b.t
    : sort === 'slug'
      ? a.slug.localeCompare(b.slug)
      : sort === 'z'
        ? a.zSigned - b.zSigned
        : sort === 'p'
          ? a.pSide - b.pSide
          : b.askOther - a.askOther,
)

console.log(
  'slug                          done  t     side  askDone  askOther  otherHeld  spent      z    pSide  dimb   final',
)
for (const r of out) {
  console.log(
    `${r.slug.padEnd(30)}${r.ok ? 'PASS' : 'FAIL'}  ${String(r.t).padStart(4)}  ${r.side.padEnd(5)} ` +
      `${r.askSide.toFixed(3).padStart(7)}  ${r.askOther.toFixed(3).padStart(8)}  ` +
      `${r.otherHeld.toFixed(0).padStart(9)}  ${r.spent.toFixed(0).padStart(5)}  ` +
      `${r.zSigned.toFixed(2).padStart(6)}  ${r.pSide.toFixed(2)}  ${r.dimb.toFixed(2)}   ` +
      `${r.finalUp.toFixed(0)}/${r.finalDown.toFixed(0)}`,
  )
}
const done = out.filter((r) => r.t >= 0)
console.log(`\n${done.length} of ${out.length} windows complete a leg mid-window`)
