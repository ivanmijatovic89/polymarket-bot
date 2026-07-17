/**
 * time-to-pair.ts — W4 remainder: how long after the first leg does
 * the pair-completing second leg arrive?
 *
 * Per btc-15m market in an /activity pull: build cumulative bought-
 * share curves for Up and Down; whenever min(cumUp, cumDn) rises by Δ
 * (a pair tranche completes), its lag = completion time − the time the
 * LEADING leg's curve first reached that pair level (interpolated to
 * the crossing trade). Share-weighted lag distribution + completion-
 * within thresholds + unpaired remainder share.
 *
 * Usage: npx tsx research/gabagool/scripts/time-to-pair.ts \
 *   --activity <jsonl> [--label name]
 */
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const argOf = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const paths = (argOf('activity') ?? '').split(',')

type T = { ts: number; size: number; outcome: string }
const bySlug = new Map<string, T[]>()
for (const p of paths) {
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (!line) continue
    const r = JSON.parse(line)
    if (r.type !== 'TRADE' || r.side !== 'BUY') continue
    if (!r.slug?.startsWith('btc-updown-15m-')) continue
    let arr = bySlug.get(r.slug)
    if (!arr) bySlug.set(r.slug, (arr = []))
    arr.push({ ts: r.timestamp, size: r.size, outcome: r.outcome })
  }
}

// weighted quantile
const wq = (pairs: Array<[number, number]>, q: number) => {
  const s = [...pairs].sort((a, b) => a[0] - b[0])
  const tot = s.reduce((a, [, w]) => a + w, 0)
  let acc = 0
  for (const [v, w] of s) {
    acc += w
    if (acc >= q * tot) return v
  }
  return s.length ? s[s.length - 1][0] : NaN
}

const lags: Array<[number, number]> = [] // [lagSec, weightShares]
let totalPairs = 0
let totalMax = 0
let mkts = 0
for (const [, ts] of bySlug) {
  ts.sort((a, b) => a.ts - b.ts)
  // cumulative curves as step points
  const curves: Record<string, Array<[number, number]>> = { Up: [[0, 0]], Down: [[0, 0]] }
  const cum: Record<string, number> = { Up: 0, Down: 0 }
  let minSoFar = 0
  for (const t of ts) {
    if (t.outcome !== 'Up' && t.outcome !== 'Down') continue
    cum[t.outcome] += t.size
    curves[t.outcome].push([t.ts, cum[t.outcome]])
    const m = Math.min(cum.Up, cum.Down)
    if (m > minSoFar) {
      const delta = m - minSoFar
      // leading leg = the OTHER one (the one that was ahead); when did it reach level m?
      const lead = t.outcome === 'Up' ? 'Down' : 'Up' // the leg NOT filling now was ahead
      const c = curves[lead]
      let reach = t.ts
      for (const [time, v] of c) {
        if (v >= m) {
          reach = time
          break
        }
      }
      lags.push([t.ts - reach, delta])
      minSoFar = m
    }
  }
  totalPairs += minSoFar
  totalMax += Math.max(cum.Up, cum.Down)
  if (cum.Up + cum.Down > 0) mkts++
}

const within = (s: number) => {
  const tot = lags.reduce((a, [, w]) => a + w, 0)
  const ok = lags.filter(([v]) => v <= s).reduce((a, [, w]) => a + w, 0)
  return ((100 * ok) / tot).toFixed(1) + '%'
}
console.log(`${argOf('label') ?? ''} markets: ${mkts}, paired shares ${totalPairs.toFixed(0)}, pairRate ${(totalPairs / totalMax).toFixed(3)}`)
console.log(`time-to-pair (share-weighted): p25 ${wq(lags, 0.25)}s p50 ${wq(lags, 0.5)}s p75 ${wq(lags, 0.75)}s p90 ${wq(lags, 0.9)}s`)
console.log(`completed within 10s ${within(10)} | 60s ${within(60)} | 300s ${within(300)}`)
process.exit(0)
