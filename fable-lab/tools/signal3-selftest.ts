/**
 * signal3-selftest.ts — deterministic selftest for tools/signal3-scan.ts
 * (SIGNAL-003, knowledge/SIGNAL-FILLS.md). Same lean shape as the
 * signal-scan selftest: pins the load-bearing behaviors —
 *   T1 parse/filter accounting: malformed, dedupe, later-fill, non-maker,
 *      price-range and quote-attribution exclusions produce hand-counted
 *      totals
 *   T2 planted monotone toxicity on ONE feature (move10: big pre-fill
 *      moves toward the quote → losing fills) is detected as CANDIDATE
 *      (|z| ≥ 3.5) with the correct (negative) sign
 *   T3 a pure-noise feature stays below WARM on the same data
 *   T4 G1 join-direction gate aborts (exit 2) when outcomes are flipped
 *   T5 --outcomes refused on a log path without "synthetic" (exit 1)
 *   T6 G2 zero-anchor gate aborts (exit 2) when the join is globally
 *      shifted (all fills marked winners)
 *
 * Writes fixtures under fable-lab/logs/ (gitignored) with "synthetic" in
 * the filename, per the scan's refusal guard.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const logsDir = join(here, '..', 'logs')
mkdirSync(logsDir, { recursive: true })
const logPath = join(logsDir, 'synthetic-signal3-selftest.log')
const outcomesPath = join(logsDir, 'synthetic-signal3-selftest-outcomes.json')
const outcomesFlippedPath = join(logsDir, 'synthetic-signal3-selftest-outcomes-flipped.json')
const outcomesAllWinPath = join(logsDir, 'synthetic-signal3-selftest-outcomes-allwin.json')
const badLogPath = join(logsDir, 'signal3-selftest-nomagic.log')

// Deterministic LCG (no Math.random in lab tools — resume-safety convention)
let seed = 1234
const rnd = (): number => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}

const mkLine = (
  slug: string,
  epoch: number,
  o: Partial<Record<string, string | number>> = {},
): string => {
  const d: Record<string, string | number> = {
    fillSeq: 0, fTs: '451.0', fPrice: '0.5000', fSize: 100, fLiq: 'MAKER',
    stateTs: '450.5', qAgeSec: '4.0', qMidDrift: '0.0000',
    upBid: '0.4800', upAsk: '0.5200', dnBid: '0.5000', dnAsk: '0.5200',
    l1Imb: '0.5000', l5Imb: '0.5000', l10Imb: '0.5000', dTot5: '1000.0',
    dTot10: '2000.0', nTicks: 1000, rate60: 100, vol: '0.00500', nz: 100,
    flips: 50, range: '0.1000', posR: '0.5000', move60: '0.0000',
    move10: '0.0000', firstMid: '0.5000', firstTs: '1.0', crossedN: 0,
    ...o,
  }
  return (
    `[diag-fill] slug=${slug} epoch=${epoch} fillSeq=${d.fillSeq} ` +
    `fTs=${d.fTs} fPrice=${d.fPrice} fSize=${d.fSize} fLiq=${d.fLiq} ` +
    `stateTs=${d.stateTs} qAgeSec=${d.qAgeSec} qMidDrift=${d.qMidDrift} ` +
    `upBid=${d.upBid} upAsk=${d.upAsk} dnBid=${d.dnBid} dnAsk=${d.dnAsk} ` +
    `l1Imb=${d.l1Imb} l5Imb=${d.l5Imb} l10Imb=${d.l10Imb} dTot5=${d.dTot5} ` +
    `dTot10=${d.dTot10} nTicks=${d.nTicks} rate60=${d.rate60} vol=${d.vol} ` +
    `nz=${d.nz} flips=${d.flips} range=${d.range} posR=${d.posR} ` +
    `move60=${d.move60} move10=${d.move10} firstMid=${d.firstMid} ` +
    `firstTs=${d.firstTs} crossedN=${d.crossedN}`
  )
}

// Build N MID-stratum fills (fPrice 0.50). Planted toxicity, zero-mean
// globally so the G2 anchor holds (E29 world: the ungated population
// averages ~0 while a feature separates good from bad fills):
//   move10 ~ U(-0.05, +0.05); P(down wins) = clamp(0.49 + TOX*(move10/0.05))
// → residual correlates POSITIVELY with move10 (monotone candidate; the
// direction is read from the sign). rate60 stays pure noise.
const N = 6000
const TOX = 0.2
const lines: string[] = []
const outcomes: Record<string, string> = {}
const outcomesFlipped: Record<string, string> = {}
const outcomesAllWin: Record<string, string> = {}
let expectPrimary = 0
for (let i = 0; i < N; i++) {
  const epoch = 1764460800 + i * 900
  const slug = `btc-updown-15m-${epoch}`
  const move10 = 0.05 * (2 * rnd() - 1)
  const rate60 = Math.floor(rnd() * 5000)
  const pDn = Math.min(0.98, Math.max(0.02, 0.49 + TOX * (move10 / 0.05)))
  const dnWon = rnd() < pDn
  outcomes[slug] = dnWon ? '1' : '0'
  outcomesFlipped[slug] = dnWon ? '0' : '1'
  outcomesAllWin[slug] = '1'
  expectPrimary++
  lines.push(mkLine(slug, epoch, { move10: move10.toFixed(4), rate60 }))
}
// G1 material: 200 high-price fills (fPrice 0.95) winning at the implied rate.
for (let i = 0; i < 200; i++) {
  const epoch = 1770000000 + i * 900
  const slug = `btc-updown-15m-${epoch}`
  const dnWon = rnd() < 0.95
  outcomes[slug] = dnWon ? '1' : '0'
  outcomesFlipped[slug] = dnWon ? '0' : '1'
  outcomesAllWin[slug] = '1'
  expectPrimary++
  lines.push(mkLine(slug, epoch, { fPrice: '0.9500', dnBid: '0.9500', dnAsk: '0.9700' }))
}
// T1 exclusion rows (hand-counted):
// (a) later fill (fillSeq=1) on market 0 → excluded from primary
lines.push(mkLine('btc-updown-15m-1764460800', 1764460800, { fillSeq: 1 }))
// (b) duplicate (slug, fillSeq) of market 1 with a different price — ignored
lines.push(mkLine('btc-updown-15m-1764461700', 1764461700, { fPrice: '0.7000' }))
// (c) non-maker first fill → excluded
lines.push(mkLine('btc-updown-15m-1799999100', 1799999100, { fLiq: 'TAKER' }))
outcomes['btc-updown-15m-1799999100'] = '1'
// (d) price out of range → excluded
lines.push(mkLine('btc-updown-15m-1799999101', 1799999101, { fPrice: '0.0100', dnBid: '0.0100', dnAsk: '0.0300' }))
outcomes['btc-updown-15m-1799999101'] = '1'
// (e) unattributed quote (qAgeSec=-1): KEPT in primary, excluded from
// qAgeSec/qMidDrift tests only
lines.push(mkLine('btc-updown-15m-1799999102', 1799999102, { qAgeSec: '-1.0' }))
outcomes['btc-updown-15m-1799999102'] = '1'
outcomesFlipped['btc-updown-15m-1799999102'] = '0'
outcomesAllWin['btc-updown-15m-1799999102'] = '1'
expectPrimary++
// (f) malformed line
lines.push('[diag-fill] slug=btc-updown-15m-1799999103 epoch=broken')

writeFileSync(logPath, lines.join('\n') + '\n')
writeFileSync(outcomesPath, JSON.stringify(outcomes))
writeFileSync(outcomesFlippedPath, JSON.stringify(outcomesFlipped))
writeFileSync(outcomesAllWinPath, JSON.stringify(outcomesAllWin))
writeFileSync(badLogPath, lines[0] + '\n')

const run = (args: string[]): { out: string; code: number } => {
  try {
    const out = execFileSync('npx', ['tsx', join(here, 'signal3-scan.ts'), ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { out, code: 0 }
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { out: (err.stdout ?? '') + (err.stderr ?? ''), code: err.status ?? -1 }
  }
}

let failures = 0
const check = (name: string, cond: boolean, detail: string): void => {
  if (cond) console.log(`PASS ${name}`)
  else {
    failures++
    console.log(`FAIL ${name}: ${detail}`)
  }
}

// ---- main run ----
const main = run([logPath, '--outcomes', outcomesPath])
check('T0 exit 0', main.code === 0, `exit=${main.code}`)
check(
  'T1 primary accounting',
  main.out.includes(`parsed ${expectPrimary} primary fills`),
  `expected ${expectPrimary}; got: ${main.out.match(/parsed .*/)?.[0]}`,
)
check('T1 malformed=1', main.out.includes('(1 malformed'), main.out.match(/parsed .*/)?.[0] ?? 'no parse line')
check('T1 later-fill=1', main.out.includes('1 later-fill rows excluded'), main.out.match(/parsed .*/)?.[0] ?? '')
check('T1 non-maker=1', main.out.includes('1 non-maker first fills excluded'), main.out.match(/parsed .*/)?.[0] ?? '')
check('T1 price-range=1', main.out.includes('1 price-range excluded'), main.out.match(/parsed .*/)?.[0] ?? '')
check(
  'T1 quote attribution sentinel=1',
  main.out.includes(`quote attribution: ${expectPrimary - 1}/${expectPrimary} attributed (1 sentinel`),
  main.out.match(/quote attribution.*/)?.[0] ?? 'no attribution line',
)
const mv = new RegExp('^  move10 z=\\+(\\d+\\.\\d+) .* CANDIDATE$', 'm').exec(main.out)
check('T2 planted toxicity CANDIDATE (+ sign: less-adverse move → win)', mv !== null && Number(mv[1]) >= 3.5, mv?.[0] ?? `no move10 candidate line; top: ${main.out.match(/^  \S+ z=.*$/m)?.[0]}`)
const rateLine = new RegExp('^  rate60 z=([+-]\\d+\\.\\d+).*(WARM|CANDIDATE)$', 'm').exec(main.out)
check('T3 noise feature below WARM', rateLine === null, rateLine?.[0] ?? '')
check('T3 G1 non-vacuous', /gate G1: n=\d+ fPrice≥0\.90 winRate=0\.9/.test(main.out), main.out.match(/gate G1.*/)?.[0] ?? 'no G1 line')

// ---- flipped outcomes → G1 abort ----
const flipped = run([logPath, '--outcomes', outcomesFlippedPath])
check('T4 G1 abort exit 2', flipped.code === 2, `exit=${flipped.code}`)
check('T4 G1 abort message', flipped.out.includes('GATE G1 FAILED'), flipped.out.slice(-300))

// ---- refusal guard ----
const refused = run([badLogPath, '--outcomes', outcomesPath])
check('T5 refusal exit 1', refused.code === 1, `exit=${refused.code}`)
check('T5 refusal message', refused.out.includes('REFUSED'), refused.out.slice(-200))

// ---- all-winners join → G2 abort (G1 passes: high-price fills all "win") ----
const allwin = run([logPath, '--outcomes', outcomesAllWinPath])
check('T6 G2 abort exit 2', allwin.code === 2, `exit=${allwin.code}`)
check('T6 G2 abort message', allwin.out.includes('GATE G2 FAILED'), allwin.out.slice(-300))

// ---- T7/T8: cell-grid + seasonality families (SIGNAL-FILLS §6c amendment 2)
// Second synthetic world, zero-mean globally (G2 must pass):
//   U-shaped posR effect, invisible to the monotone screen by symmetry —
//     e(posR) = -A*((|posR-0.5|-0.25)*2): extreme quintiles toxic
//     (q1/q5 d ≈ -9c), middle quintile favorable (q3 d ≈ +12c);
//   day-of-week effect — Sundays (d0) toxic by -10c, other days +1.67c.
// Both effects are mean-zero over the uniform draws, mutually independent.
const log2Path = join(logsDir, 'synthetic-signal3-selftest2.log')
const outcomes2Path = join(logsDir, 'synthetic-signal3-selftest2-outcomes.json')
const N2 = 6000
const A = 0.3
const lines2: string[] = []
const outcomes2: Record<string, string> = {}
for (let i = 0; i < N2; i++) {
  const epoch = 1764460800 + i * 900
  const slug = `btc-updown-15m-${epoch}`
  const posR = rnd()
  const ePos = -A * ((Math.abs(posR - 0.5) - 0.25) * 2)
  const dow = Math.floor(epoch / 86400 + 4) % 7
  const eSeason = dow === 0 ? -0.1 : 0.1 / 6
  const pDn = Math.min(0.98, Math.max(0.02, 0.49 + ePos + eSeason))
  const dnWon = rnd() < pDn
  outcomes2[slug] = dnWon ? '1' : '0'
  lines2.push(mkLine(slug, epoch, { posR: posR.toFixed(4) }))
}
writeFileSync(log2Path, lines2.join('\n') + '\n')
writeFileSync(outcomes2Path, JSON.stringify(outcomes2))
const grid = run([log2Path, '--outcomes', outcomes2Path])
check('T7 exit 0 (G2 passes on zero-mean U-shape world)', grid.code === 0, `exit=${grid.code}`)
const q1 = new RegExp('^  MID posR q1 d=-(\\d+\\.\\d+)c z=-(\\d+\\.\\d+) n=\\d+ CANDIDATE$', 'm').exec(grid.out)
check('T7 U-shape adverse extreme q1 CANDIDATE (−)', q1 !== null && Number(q1[2]) >= 4.2, q1?.[0] ?? grid.out.match(/^  MID posR q1.*$/m)?.[0] ?? 'no q1 line')
const q5 = new RegExp('^  MID posR q5 d=-(\\d+\\.\\d+)c z=-(\\d+\\.\\d+) n=\\d+ CANDIDATE$', 'm').exec(grid.out)
check('T7 U-shape adverse extreme q5 CANDIDATE (−)', q5 !== null && Number(q5[2]) >= 4.2, q5?.[0] ?? grid.out.match(/^  MID posR q5.*$/m)?.[0] ?? 'no q5 line')
const q3 = new RegExp('^  MID posR q3 d=\\+?(\\d+\\.\\d+)c z=\\+(\\d+\\.\\d+) n=\\d+ CANDIDATE$', 'm').exec(grid.out)
check('T7 U-shape favorable middle q3 CANDIDATE (+)', q3 !== null && Number(q3[2]) >= 4.2, q3?.[0] ?? grid.out.match(/^  MID posR q3.*$/m)?.[0] ?? 'no q3 line')
const cellTotal = /of (\d+) evaluated cells/.exec(grid.out)
check('T7 cell grid evaluated cells > 0', cellTotal !== null && Number(cellTotal[1]) > 0, grid.out.match(/cell grid: .*/)?.[0] ?? 'no cell grid summary')
const noMono = new RegExp('^  posR z=[+-][\\d.]+ .* CANDIDATE$', 'm').exec(grid.out)
check('T7 U-shape invisible to monotone screen', noMono === null, noMono?.[0] ?? '')
const d0 = new RegExp('^  MID d0 d=-(\\d+\\.\\d+)c z=-(\\d+\\.\\d+) n=\\d+ CANDIDATE$', 'm').exec(grid.out)
check('T8 day-of-week d0 CANDIDATE (−)', d0 !== null && Number(d0[2]) >= 4.2, d0?.[0] ?? grid.out.match(/^  MID d0 .*$/m)?.[0] ?? 'no d0 line')

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
