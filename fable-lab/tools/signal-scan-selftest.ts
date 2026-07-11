/**
 * signal-scan-selftest.ts — deterministic selftest for tools/signal-scan.ts
 * (SIGNAL-001, knowledge/SIGNAL-MAP.md). Leaner than the calib selftests by
 * design (operator batch-economics mandate 2026-07-11, map-grade
 * instrument): it pins the load-bearing behaviors rather than hand-computing
 * every statistic —
 *   T1 parse/filter accounting: malformed, drift, dedupe, ask-range and
 *      DOWN-sentinel exclusions produce hand-counted sample totals
 *   T2 planted monotone signal on ONE feature is detected as CANDIDATE
 *      (|z| ≥ 4) with the correct sign, on both sides
 *   T3 a pure-noise feature stays below WARM on the same data
 *   T4 G1 join-direction gate aborts (exit 2) when outcomes are flipped
 *   T5 --outcomes refused on a log path without "synthetic" (exit 1)
 *
 * Writes its fixtures under fable-lab/logs/ (gitignored) with "synthetic"
 * in the filename, per the signal-scan refusal guard.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const logsDir = join(here, '..', 'logs')
mkdirSync(logsDir, { recursive: true })
const logPath = join(logsDir, 'synthetic-signal-selftest.log')
const outcomesPath = join(logsDir, 'synthetic-signal-selftest-outcomes.json')
const outcomesFlippedPath = join(logsDir, 'synthetic-signal-selftest-outcomes-flipped.json')
const badLogPath = join(logsDir, 'signal-selftest-nomagic.log')

// Deterministic LCG (no Math.random in lab tools — resume-safety convention)
let seed = 42
const rnd = (): number => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}

// Build N markets at off=300 only. upAsk ~ 0.50 (MID stratum), spread 2c.
// Outcome: P(up wins) = clamp(upAsk-0.01 + SLOPE*(l1Imb-0.5), 0.02, 0.98)
// → l1Imb is a real monotone signal (positive for UP buyer, negative for
// DOWN buyer since DOWN keeps the same feature but mirrored outcome);
// rate60 is pure noise. Expected planted effect ≈ SLOPE/4 per unit rank —
// with N=6000 and SLOPE=0.30 the Spearman z is far above 4 with prob ~1.
const N = 6000
const SLOPE = 0.3
const lines: string[] = []
const outcomes: Record<string, string> = {}
const outcomesFlipped: Record<string, string> = {}
let expectUpSamples = 0
let expectDnSamples = 0
for (let i = 0; i < N; i++) {
  const epoch = 1764460800 + i * 900
  const slug = `btc-updown-15m-${epoch}`
  const upBid = 0.48
  const upAsk = 0.5
  const dnBid = 0.48
  const dnAsk = 0.5
  const l1Imb = rnd()
  const rate60 = Math.floor(rnd() * 5000)
  const pUp = Math.min(0.98, Math.max(0.02, upAsk - 0.01 + SLOPE * (l1Imb - 0.5)))
  const upWon = rnd() < pUp
  outcomes[slug] = upWon ? '0' : '1'
  outcomesFlipped[slug] = upWon ? '1' : '0'
  expectUpSamples++
  expectDnSamples++
  lines.push(
    `[diag-signal] slug=${slug} epoch=${epoch} off=300 ts=300.5 ` +
      `upBid=${upBid.toFixed(4)} upAsk=${upAsk.toFixed(4)} dnBid=${dnBid.toFixed(4)} dnAsk=${dnAsk.toFixed(4)} ` +
      `l1Imb=${l1Imb.toFixed(4)} l5Imb=0.5000 l10Imb=0.5000 dTot5=1000.0 dTot10=2000.0 ` +
      `nTicks=1000 rate60=${rate60} vol=0.00500 nz=100 flips=50 ` +
      `range=0.1000 posR=0.5000 move60=0.0000 firstMid=0.5000 firstTs=1.0 crossedN=0`,
  )
}
// Also give G1 something to chew on: 200 high-ask UP markets (ask 0.95)
// that win at the ask-implied rate, so the gate is non-vacuous and passes.
for (let i = 0; i < 200; i++) {
  const epoch = 1770000000 + i * 900
  const slug = `btc-updown-15m-${epoch}`
  const upWon = rnd() < 0.95
  outcomes[slug] = upWon ? '0' : '1'
  outcomesFlipped[slug] = upWon ? '1' : '0'
  expectUpSamples++ // ask 0.95 is inside [0.02,0.98]
  expectDnSamples++ // dn ask 0.06
  lines.push(
    `[diag-signal] slug=${slug} epoch=${epoch} off=300 ts=300.5 ` +
      `upBid=0.9400 upAsk=0.9500 dnBid=0.0500 dnAsk=0.0600 ` +
      `l1Imb=0.5000 l5Imb=0.5000 l10Imb=0.5000 dTot5=1000.0 dTot10=2000.0 ` +
      `nTicks=1000 rate60=2500 vol=0.00500 nz=100 flips=50 ` +
      `range=0.1000 posR=0.5000 move60=0.0000 firstMid=0.5000 firstTs=1.0 crossedN=0`,
  )
}
// T1 exclusion rows (hand-counted):
// (a) drift: ts past next bound → dropped before sampling
lines.push(
  `[diag-signal] slug=btc-updown-15m-1799999100 epoch=1799999100 off=300 ts=601.0 ` +
    `upBid=0.4800 upAsk=0.5000 dnBid=0.4800 dnAsk=0.5000 ` +
    `l1Imb=0.5000 l5Imb=0.5000 l10Imb=0.5000 dTot5=1000.0 dTot10=2000.0 ` +
    `nTicks=1000 rate60=2500 vol=0.00500 nz=100 flips=50 ` +
    `range=0.1000 posR=0.5000 move60=0.0000 firstMid=0.5000 firstTs=1.0 crossedN=0`,
)
outcomes['btc-updown-15m-1799999100'] = '0'
// (b) duplicate (slug,off) of market 0 with a different ask — must be ignored
lines.push(lines[0].replace('upAsk=0.5000', 'upAsk=0.7000'))
// (c) UP ask outside range (0.995) but DOWN valid (0.02): UP excluded, DOWN kept
lines.push(
  `[diag-signal] slug=btc-updown-15m-1799999101 epoch=1799999101 off=300 ts=300.5 ` +
    `upBid=0.9900 upAsk=0.9950 dnBid=0.0100 dnAsk=0.0200 ` +
    `l1Imb=0.5000 l5Imb=0.5000 l10Imb=0.5000 dTot5=1000.0 dTot10=2000.0 ` +
    `nTicks=1000 rate60=2500 vol=0.00500 nz=100 flips=50 ` +
    `range=0.1000 posR=0.5000 move60=0.0000 firstMid=0.5000 firstTs=1.0 crossedN=0`,
)
outcomes['btc-updown-15m-1799999101'] = '0'
expectDnSamples++
// (d) DOWN sentinel (-1): DOWN excluded, UP kept
lines.push(
  `[diag-signal] slug=btc-updown-15m-1799999102 epoch=1799999102 off=300 ts=300.5 ` +
    `upBid=0.4800 upAsk=0.5000 dnBid=-1.0000 dnAsk=-1.0000 ` +
    `l1Imb=0.5000 l5Imb=0.5000 l10Imb=0.5000 dTot5=1000.0 dTot10=2000.0 ` +
    `nTicks=1000 rate60=2500 vol=0.00500 nz=100 flips=50 ` +
    `range=0.1000 posR=0.5000 move60=0.0000 firstMid=0.5000 firstTs=1.0 crossedN=0`,
)
outcomes['btc-updown-15m-1799999102'] = '0'
expectUpSamples++
// (e) malformed line
lines.push('[diag-signal] slug=btc-updown-15m-1799999103 epoch=broken')

writeFileSync(logPath, lines.join('\n') + '\n')
writeFileSync(outcomesPath, JSON.stringify(outcomes))
writeFileSync(outcomesFlippedPath, JSON.stringify(outcomesFlipped))
writeFileSync(badLogPath, lines[0] + '\n')

const run = (args: string[]): { out: string; code: number } => {
  try {
    const out = execFileSync('npx', ['tsx', join(here, 'signal-scan.ts'), ...args], {
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
  'T1 sample accounting',
  main.out.includes(`samples: UP=${expectUpSamples} DOWN=${expectDnSamples}`),
  `expected UP=${expectUpSamples} DOWN=${expectDnSamples}; got: ${main.out.match(/samples: .*/)?.[0]}`,
)
check('T1 malformed=1', main.out.includes('(1 malformed'), main.out.match(/parsed .*/)?.[0] ?? 'no parse line')
check('T1 drift=1', main.out.includes('1 drift-discarded'), main.out.match(/parsed .*/)?.[0] ?? 'no parse line')
const upCand = new RegExp('^  UP o300 l1Imb z=\\+(\\d+\\.\\d+) .* CANDIDATE$', 'm').exec(main.out)
check('T2 planted signal UP CANDIDATE (+)', upCand !== null && Number(upCand[1]) >= 4, upCand?.[0] ?? 'no UP l1Imb candidate line')
const dnCand = new RegExp('^  DOWN o300 l1Imb z=-(\\d+\\.\\d+) .* CANDIDATE$', 'm').exec(main.out)
check('T2 planted signal DOWN CANDIDATE (−)', dnCand !== null && Number(dnCand[1]) >= 4, dnCand?.[0] ?? 'no DOWN l1Imb candidate line')
const rateLine = new RegExp('^  (UP|DOWN) o300 rate60 z=([+-]\\d+\\.\\d+).*(WARM|CANDIDATE)$', 'm').exec(main.out)
check('T3 noise feature below WARM', rateLine === null, rateLine?.[0] ?? '')
check('T3 G1 non-vacuous', /gate G1 UP: n=2\d\d ask≥0\.90 winRate=0\.9/.test(main.out), main.out.match(/gate G1 UP.*/)?.[0] ?? 'no G1 line')

// ---- flipped outcomes → G1 abort ----
const flipped = run([logPath, '--outcomes', outcomesFlippedPath])
check('T4 G1 abort exit 2', flipped.code === 2, `exit=${flipped.code}`)
check('T4 G1 abort message', flipped.out.includes('GATE G1 FAILED'), flipped.out.slice(-300))

// ---- refusal guard ----
const refused = run([badLogPath, '--outcomes', outcomesPath])
check('T5 refusal exit 1', refused.code === 1, `exit=${refused.code}`)
check('T5 refusal message', refused.out.includes('REFUSED'), refused.out.slice(-200))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
