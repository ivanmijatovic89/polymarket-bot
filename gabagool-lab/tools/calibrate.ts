/**
 * calibrate.ts — TAIL_K + capital-efficiency floor calibration table
 * (EVALUATION §7 procedure; logic pre-registered in JOURNAL
 * 2026-07-17T05:00Z before fullwin numbers existed).
 *
 * Reads a per-market econ CSV produced by `results.ts --export` and
 * prints, for a grid of candidate EL floors, the implied TAIL_K
 * (G7: CVaR5 ≥ −(TAIL_K × EL)) and the implied capital-efficiency
 * floor (EL per $100 avg outlay). The chosen row + rationale goes to
 * DECISIONS.md; EVALUATION bumps to v1.1.
 *
 * Usage:
 *   npx tsx gabagool-lab/tools/calibrate.ts <export.csv> [--floors 0.25,0.5,0.75,1,1.5]
 */
import { readFileSync } from 'node:fs'

const path = process.argv[2]
if (!path || path.startsWith('--')) {
  console.error('usage: calibrate.ts <export.csv> [--floors 0.25,0.5,...]')
  process.exit(1)
}
const floorsArg = ((): number[] => {
  const i = process.argv.indexOf('--floors')
  const raw = i >= 0 ? process.argv[i + 1] : undefined
  return (raw ?? '0.25,0.5,0.75,1,1.5').split(',').map(Number)
})()

const lines = readFileSync(path, 'utf8').trim().split('\n')
const header = lines[0]!.split(',')
const col = (name: string): number => {
  const i = header.indexOf(name)
  if (i < 0) throw new Error(`column ${name} missing`)
  return i
}
const cEl = col('el')
const cOutlay = col('outlay')
const cMakerFills = col('maker_fills')
const cTakerFills = col('taker_fills')

type Row = { el: number; outlay: number; mf: number; tf: number }
const rows: Row[] = lines.slice(1).map((l) => {
  const p = l.split(',')
  return {
    el: Number(p[cEl]),
    outlay: Number(p[cOutlay]),
    mf: Number(p[cMakerFills]),
    tf: Number(p[cTakerFills]),
  }
})

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const quantile = (sorted: number[], q: number): number => {
  if (!sorted.length) return NaN
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))
  return sorted[idx]!
}

const els = rows.map((r) => r.el).sort((a, b) => a - b)
const played = rows.filter((r) => r.mf + r.tf > 0)
const outlays = played.map((r) => r.outlay).sort((a, b) => a - b)
const w5 = Math.max(1, Math.floor(els.length * 0.05))
const cvar5 = mean(els.slice(0, w5))
const p5 = quantile(els, 0.05)
const maxLose = els[0]!
const avgOutlay = mean(outlays)
const p90Outlay = quantile(outlays, 0.9)
const wins = els.filter((x) => x > 0)
const losses = els.filter((x) => x < 0)
const pf = losses.length ? wins.reduce((a, b) => a + b, 0) / Math.abs(losses.reduce((a, b) => a + b, 0)) : Infinity
const sd = Math.sqrt(mean(els.map((x) => (x - mean(els)) ** 2)))

console.log(`\n=== calibration source: ${path} ===`)
console.log(`n=${rows.length} played=${played.length}`)
console.log(
  `EL mean ${mean(els).toFixed(4)}  sd ${sd.toFixed(3)}  p5 ${p5.toFixed(3)}  CVaR5 ${cvar5.toFixed(3)}  maxLose ${maxLose.toFixed(3)}  PF ${pf.toFixed(2)}`,
)
console.log(
  `outlay avg ${avgOutlay.toFixed(2)}  p90 ${p90Outlay.toFixed(2)}  tail-to-outlay CVaR5/avgOutlay ${(cvar5 / avgOutlay).toFixed(3)}`,
)
console.log(`\nfloor = minimum EL/market a candidate must earn to carry THIS tail shape`)
console.log(`TAIL_K = |CVaR5_baseline| / floor      (G7: CVaR5 >= -(TAIL_K x EL))`)
console.log(`cap-floor = floor / avgOutlay x 100    (EL per $100 avg outlay, %)`)
console.log(`\nfloor($/mkt)  TAIL_K   cap-floor(EL/$100)`)
for (const f of floorsArg) {
  console.log(
    `${f.toFixed(2).padStart(11)}  ${(Math.abs(cvar5) / f).toFixed(1).padStart(6)}   ${((f / avgOutlay) * 100).toFixed(2).padStart(8)}%`,
  )
}
console.log(
  `\nnote: G7 applies to candidates (EL>0, past G4 t>=2). The baseline itself is exempt (calibration source).`,
)
