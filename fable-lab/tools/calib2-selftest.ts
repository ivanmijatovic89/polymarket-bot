/**
 * calib2-selftest.ts — mechanical validation of calib2.ts on a SYNTHETIC
 * fixture with hand-computed expected output (CALIBRATION-2.md
 * Disclosures: the tool is never tested against the real log).
 *
 * Usage: npx tsx fable-lab/tools/calib2-selftest.ts
 *
 * Generates a deterministic synthetic diag-calib log + outcomes JSON under
 * fable-lab/logs/ (gitignored; this generator IS the committed fixture),
 * runs calib2.ts on it, and asserts:
 *   - designed CANDIDATE: UP (30-150, up2), n=200, meanAsk=0.5400,
 *     winRate=0.7500, z≈+5.96, minority=50, sub-window consistent
 *   - designed NEG-FLAG: DOWN (30-150, up2) (mirror economics, z≈−6.5)
 *   - drift filter discards exactly 1 planted line (ts past next offset)
 *   - dedupe swallows exactly 1 planted duplicate (no double count)
 *   - band filter drops exactly 2 planted out-of-band entries
 *   - both join-direction gates pass; E14-analog controls empty-OK
 *   - parser-consistency gate is SKIPPED for synthetic input
 *   - the --outcomes guard REFUSES paths without "synthetic"
 *
 * Hand computation for the candidate cell (frozen formulas):
 *   meanAsk=0.54, winRate=150/200=0.75, d=0.21,
 *   fee=0.75*0.0156*0.46/0.54=0.009967, net=0.200,
 *   se=sqrt(200*0.54*0.46)/200=0.035242, z=0.21/0.035242=5.958→"+5.96".
 */
import { writeFileSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const LOG = 'fable-lab/logs/calib2-synthetic.log'
const OUTCOMES = 'fable-lab/logs/calib2-synthetic-outcomes.json'

function line(slug: string, epoch: number, asset: string, off: number, ts: number, bid: number, ask: number): string {
  return `[diag-calib] slug=${slug} epoch=${epoch} asset=${asset} off=${off} ts=${ts.toFixed(1)} bid=${bid.toFixed(4)} ask=${ask.toFixed(4)}`
}

const lines: string[] = ['[backtest] synthetic fixture — not a real run']
const outcomes: Record<string, string> = {}

// --- Candidate block: 200 markets, pair (30,150), UP move +0.03 (up2). ---
// Sub-window spread: 70 Dec (53 wins), 70 Jan (52 wins), 60 Feb (45 wins)
// → 150/200 total UP wins; d > 0 in every sub-window.
const blocks: Array<[number, number, number]> = [
  [1765000000, 70, 53], // Dec 2025
  [1768000000, 70, 52], // Jan 2026
  [1770000000, 60, 45], // Feb 2026
]
let ci = 0
for (const [baseEpoch, count, wins] of blocks) {
  for (let i = 0; i < count; i++, ci++) {
    const slug = `synth-c${String(ci + 1).padStart(3, '0')}`
    const epoch = baseEpoch + i * 900
    lines.push(line(slug, epoch, 'UP', 30, 30, 0.49, 0.51)) // mid 0.50
    lines.push(line(slug, epoch, 'DOWN', 30, 30, 0.49, 0.51))
    lines.push(line(slug, epoch, 'UP', 150, 150, 0.52, 0.54)) // mid 0.53 → move +0.03
    lines.push(line(slug, epoch, 'DOWN', 150, 150, 0.46, 0.48))
    outcomes[slug] = i < wins ? '0' : '1'
  }
}

// --- Gate blocks: pair (750,850), flat move, tail entries. ---
for (let i = 0; i < 40; i++) {
  const slug = `synth-g${String(i + 1).padStart(3, '0')}` // UP-expensive tail
  const epoch = 1765500000 + i * 900
  for (const off of [750, 850]) {
    lines.push(line(slug, epoch, 'UP', off, off, 0.98, 0.99))
    lines.push(line(slug, epoch, 'DOWN', off, off, 0.01, 0.02))
  }
  outcomes[slug] = i < 39 ? '0' : '1' // UP tail winRate 39/40 = 0.975
}
for (let i = 0; i < 40; i++) {
  const slug = `synth-h${String(i + 1).padStart(3, '0')}` // DOWN-expensive tail
  const epoch = 1766000000 + i * 900
  for (const off of [750, 850]) {
    lines.push(line(slug, epoch, 'UP', off, off, 0.01, 0.02))
    lines.push(line(slug, epoch, 'DOWN', off, off, 0.98, 0.99))
  }
  outcomes[slug] = i < 39 ? '1' : '0' // DOWN tail winRate 39/40 = 0.975
}

// --- Planted defects the pipeline must handle. ---
// 1 drift line: ts=460 ≥ NEXT_BOUND[300]=450 → drift-discarded.
lines.push(line('synth-c001', 1765000000, 'UP', 300, 460, 0.5, 0.52))
// 1 exact duplicate of an existing (slug, asset, off) → dedupe.
lines.push(line('synth-c001', 1765000000, 'UP', 30, 30, 0.49, 0.51))
// 2 out-of-band entries: valid pair (30,150), entry asks 1.00 and 0.005.
lines.push(line('synth-x001', 1765100000, 'UP', 30, 30, 0.98, 0.99))
lines.push(line('synth-x001', 1765100000, 'UP', 150, 150, 0.998, 1.0)) // mid .999, move +0.014 → up1; ask 1.00 > 0.995
lines.push(line('synth-x001', 1765100000, 'DOWN', 150, 150, 0.0, 0.005)) // ask 0.005 < 0.02
outcomes['synth-x001'] = '0'

writeFileSync(LOG, lines.join('\n') + '\n')
writeFileSync(OUTCOMES, JSON.stringify(outcomes, null, 1))

const out = execFileSync('npx', ['tsx', 'fable-lab/tools/calib2.ts', LOG, '--outcomes', OUTCOMES], {
  encoding: 'utf8',
})
console.log(out)

const EXPECT: Array<[string, string | RegExp]> = [
  ['parser gate skipped', 'gate parser-consistency: SKIPPED (synthetic fixture)'],
  ['drift count', '(1 drift-discarded lines)'],
  ['band count', '(2 dropped: entry ask outside [0.02,0.995])'],
  ['UP join gate', /gates UP: join-direction OK \(pooled 750-850 tail winRate=0\.9750, n=40\); E14-analog control OK \(empty\)/],
  ['DOWN join gate', /gates DOWN: join-direction OK \(pooled 750-850 tail winRate=0\.9750, n=40\); E14-analog control OK \(empty\)/],
  // Candidate row: n=200 (dedupe worked), meanAsk .5400, winRate .7500, z +5.96, minority 50.
  ['candidate row', /30-150\s+up2\s+200\s+0\.5400\s+0\.7500 \+0\.2100 0\.0100 \+0\.2000 0\.0352 \+\s+5\.96\s+50\s+CANDIDATE/],
  ['candidate list', /CANDIDATE cells: UP \(30-150, up2\) \[W1\(→Dec\):n=70,d=0\.2171 W2\(Jan\):n=70,d=0\.2029 W3\(Feb\):n=60,d=0\.2100\]/],
  ['neg-flag', /DOWN \(30-150, up2\) NEG-FLAG/],
]
let fails = 0
for (const [name, pat] of EXPECT) {
  const ok = typeof pat === 'string' ? out.includes(pat) : pat.test(out)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) fails++
}

// Guard test: --outcomes refused when path lacks "synthetic".
const GUARD = 'fable-lab/logs/calib2-guardtest.log'
copyFileSync(LOG, GUARD)
let guardOk = false
try {
  execFileSync('npx', ['tsx', 'fable-lab/tools/calib2.ts', GUARD, '--outcomes', OUTCOMES], { encoding: 'utf8' })
} catch (err: any) {
  guardOk = String(err.stderr).includes('REFUSED: --outcomes is only for synthetic fixtures')
}
console.log(`${guardOk ? 'PASS' : 'FAIL'}  outcomes-guard refusal`)
if (!guardOk) fails++

if (fails > 0) {
  console.error(`SELFTEST FAILED: ${fails} assertion(s)`)
  process.exit(1)
}
console.log('SELFTEST OK')
