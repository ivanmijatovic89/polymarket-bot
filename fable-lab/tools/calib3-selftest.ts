/**
 * calib3-selftest.ts — mechanical validation of calib3.ts on a SYNTHETIC
 * fixture with hand-computed expected output (CALIBRATION-3.md
 * Disclosures: the tool is never tested against the real log).
 *
 * Usage: npx tsx fable-lab/tools/calib3-selftest.ts
 *
 * Generates a deterministic synthetic diag-calib log + outcomes JSON under
 * fable-lab/logs/ (gitignored; this generator IS the committed fixture),
 * runs calib3.ts on it, and asserts (see EXPECT below):
 *   - designed CANDIDATE: UP (30-150-300, up-up), n=200, meanAsk=0.5700,
 *     winRate=0.7500, z≈+5.14, minority=50, sub-window consistent
 *   - designed NEG-FLAG: DOWN (30-150-300, up-up) (mirror economics)
 *   - segment-edge moves at exactly ±0.02 land in the big buckets
 *     (FP verified: ±0.020000000000000018 — inclusive edge semantics)
 *   - mid-segment entries are EXCLUDED and counted (both mid-second and
 *     mid-first orderings)
 *   - drift filter discards exactly 2 planted lines; a later valid line
 *     for a drift-dead key stays deduped (triple never forms)
 *   - dedupe swallows exactly 1 planted duplicate (candidate n stays 200)
 *   - band filter drops exactly 2 planted out-of-band entries
 *   - per-triple coverage counts (pre-shape, in-band)
 *   - both join-direction gates pass; E14-analog controls empty-OK;
 *     gate-reproduction is skipped for synthetic input
 *   - reserve mode flags CANDIDATE(reserve) without sub-windows
 *   - both refusal guards fire
 *
 * Hand computation for the candidate cell (frozen formulas):
 *   meanAsk=0.57, winRate=150/200=0.75, d=0.18,
 *   fee=0.75*0.0156*0.43/0.57=0.008826, net=0.171174→"+0.1712",
 *   se=sqrt(200*0.57*0.43)/200=0.035007, z=0.18/0.035007=5.1418→"+5.14".
 * NEG-FLAG cell: meanAsk=0.45, winRate=0.25, d=−0.20,
 *   se=sqrt(200*0.45*0.55)/200=0.035178, z=−5.685→"-5.69".
 */
import { writeFileSync, copyFileSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const LOG = 'fable-lab/logs/calib3-synthetic.log'
const OUTCOMES = 'fable-lab/logs/calib3-synthetic-outcomes.json'

function line(slug: string, epoch: number, asset: string, off: number, ts: number, bid: number, ask: number): string {
  return `[diag-calib] slug=${slug} epoch=${epoch} asset=${asset} off=${off} ts=${ts.toFixed(1)} bid=${bid.toFixed(4)} ask=${ask.toFixed(4)}`
}

const lines: string[] = ['[backtest] synthetic fixture — not a real run']
const outcomes: Record<string, string> = {}

// --- Candidate block: 200 markets, triple (30,150,300), UP mids
// 0.50 → 0.53 → 0.56 (segments +0.03, +0.03 → shape up-up). Entry UP at
// 300: ask 0.57; entry DOWN at 300: ask 0.45 (mirror NEG-FLAG cell).
// Sub-window spread: 70 Dec (53 wins), 70 Jan (52), 60 Feb (45) → 150/200.
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
    lines.push(line(slug, epoch, 'UP', 150, 150, 0.52, 0.54)) // mid 0.53 → s1 +0.03 up
    lines.push(line(slug, epoch, 'UP', 300, 300, 0.55, 0.57)) // mid 0.56 → s2 +0.03 up
    lines.push(line(slug, epoch, 'DOWN', 300, 300, 0.43, 0.45))
    outcomes[slug] = i < wins ? '0' : '1'
  }
}

// --- Gate blocks: pair (750,850) only (no 600 → no triple → scan-clean). ---
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

// --- Segment-edge markets on triple (150,300,450) (candidate cell stays
// clean). FP verified (see header): a segment of exactly ±0.02 computed
// from these 4-dp mids lands ON the big side of the edge.
// e001: mids 0.50 → 0.53 → 0.55 (s2 = +0.02 exactly → up; shape up-up),
//       unique entry ask 0.56.
lines.push(line('synth-e001', 1765200000, 'UP', 150, 150, 0.49, 0.51))
lines.push(line('synth-e001', 1765200000, 'UP', 300, 300, 0.52, 0.54))
lines.push(line('synth-e001', 1765200000, 'UP', 450, 450, 0.54, 0.56))
outcomes['synth-e001'] = '0'
// e002: mids 0.56 → 0.53 → 0.51 (s1 −0.03 dn; s2 = −0.02 exactly → dn;
//       shape dn-dn), unique entry ask 0.52.
lines.push(line('synth-e002', 1765201000, 'UP', 150, 150, 0.55, 0.57))
lines.push(line('synth-e002', 1765201000, 'UP', 300, 300, 0.52, 0.54))
lines.push(line('synth-e002', 1765201000, 'UP', 450, 450, 0.5, 0.52))
outcomes['synth-e002'] = '0'
// m001: mids 0.50 → 0.53 → 0.54 (s2 = +0.01 → mid) — EXCLUDED, counted.
lines.push(line('synth-m001', 1765202000, 'UP', 150, 150, 0.49, 0.51))
lines.push(line('synth-m001', 1765202000, 'UP', 300, 300, 0.52, 0.54))
lines.push(line('synth-m001', 1765202000, 'UP', 450, 450, 0.53, 0.55))
outcomes['synth-m001'] = '0'
// m002: mids 0.50 → 0.51 → 0.54 (s1 = +0.01 → mid) — EXCLUDED, counted.
lines.push(line('synth-m002', 1765203000, 'UP', 150, 150, 0.49, 0.51))
lines.push(line('synth-m002', 1765203000, 'UP', 300, 300, 0.5, 0.52))
lines.push(line('synth-m002', 1765203000, 'UP', 450, 450, 0.53, 0.55))
outcomes['synth-m002'] = '0'

// --- Drift-ordering case (calib.ts convention): the FIRST occurrence of
// (slug, side, off=450) is drift-invalid; the LATER valid line for the
// same key stays deduped, so triple (300,450,600) never forms.
lines.push(line('synth-d001', 1765300000, 'UP', 450, 600.5, 0.5, 0.52)) // ts ≥ 600 → drift
lines.push(line('synth-d001', 1765300000, 'UP', 450, 450, 0.5, 0.52)) // valid but deduped
lines.push(line('synth-d001', 1765300000, 'UP', 300, 300, 0.5, 0.52))
lines.push(line('synth-d001', 1765300000, 'UP', 600, 600, 0.5, 0.52))
outcomes['synth-d001'] = '0'

// --- Planted defects the pipeline must handle. ---
// 1 more drift line: c001 UP@450, ts=650 ≥ NEXT_BOUND[450]=600 → drift.
lines.push(line('synth-c001', 1765000000, 'UP', 450, 650, 0.5, 0.52))
// 1 exact duplicate of an existing (slug, asset, off) → dedupe (n stays 200).
lines.push(line('synth-c001', 1765000000, 'UP', 30, 30, 0.49, 0.51))
// 2 out-of-band entries: valid triple (30,150,300), shape up-up, but
// UP entry ask 1.00 > 0.995 and DOWN entry ask 0.005 < 0.02.
lines.push(line('synth-x001', 1765100000, 'UP', 30, 30, 0.49, 0.51))
lines.push(line('synth-x001', 1765100000, 'UP', 150, 150, 0.52, 0.54))
lines.push(line('synth-x001', 1765100000, 'UP', 300, 300, 0.998, 1.0))
lines.push(line('synth-x001', 1765100000, 'DOWN', 300, 300, 0.0, 0.005))
outcomes['synth-x001'] = '0'

writeFileSync(LOG, lines.join('\n') + '\n')
writeFileSync(OUTCOMES, JSON.stringify(outcomes, null, 1))

const out = execFileSync('npx', ['tsx', 'fable-lab/tools/calib3.ts', LOG, '--outcomes', OUTCOMES], {
  encoding: 'utf8',
})
console.log(out)

const EXPECT: Array<[string, string | RegExp]> = [
  ['parser gate skipped', 'gate parser-consistency: SKIPPED (synthetic fixture)'],
  ['drift count', '(2 drift-discarded lines)'],
  ['band count', '2 dropped: entry ask outside [0.02,0.995]'],
  ['mid-exclusion count', '2 excluded: mid segment'],
  ['derived count', /derived 402 path entries/],
  [
    'per-triple coverage UP',
    'per-triple market coverage UP (pre-shape): t30-150-300=200 t150-300-450=4 t300-450-600=0 t450-600-750=0 t600-750-850=0',
  ],
  [
    'per-triple coverage DOWN',
    'per-triple market coverage DOWN (pre-shape): t30-150-300=200 t150-300-450=0 t300-450-600=0 t450-600-750=0 t600-750-850=0',
  ],
  ['outcome join', 'outcome joined for 202/202 scan markets (0 missing/unresolved — excluded)'],
  ['UP join gate', /gates UP: join-direction OK \(pooled 750-850 tail winRate=0\.9750, n=40\); E14-analog control OK \(empty\)/],
  ['DOWN join gate', /gates DOWN: join-direction OK \(pooled 750-850 tail winRate=0\.9750, n=40\); E14-analog control OK \(empty\)/],
  ['gate-reproduction not claimed on synthetic', /^(?!.*gate-reproduction OK)[\s\S]*$/],
  // Candidate row: n=200 (dedupe worked), meanAsk .5700, winRate .7500, z +5.14, minority 50.
  [
    'candidate row',
    /30-150-300\s+up-up\s+200\s+0\.5700\s+0\.7500 \+0\.1800 0\.0088 \+0\.1712 0\.0350 \+\s+5\.14\s+50\s+CANDIDATE/,
  ],
  [
    'candidate list + sub-windows',
    /CANDIDATE cells: UP \(30-150-300, up-up\) \[W1\(→Dec\):n=70,d=0\.1871 W2\(Jan\):n=70,d=0\.1729 W3\(Feb\):n=60,d=0\.1800\]/,
  ],
  ['neg-flag (mirror cell)', /DOWN \(30-150-300, up-up\) NEG-FLAG/],
  ['edge s2 = +0.02 → up-up', /150-300-450\s+up-up\s+1\s+0\.5600/],
  ['edge s2 = −0.02 → dn-dn', /150-300-450\s+dn-dn\s+1\s+0\.5200/],
  ['drift-first key stays dead (triple never forms)', /300-450-600\s+dn-dn\s+empty/],
]
let fails = 0
for (const [name, pat] of EXPECT) {
  const ok = typeof pat === 'string' ? out.includes(pat) : pat.test(out)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) fails++
}

// Guard test: --outcomes refused when path lacks "synthetic".
const GUARD = 'fable-lab/logs/calib3-guardtest.log'
copyFileSync(LOG, GUARD)
let guardOk = false
try {
  execFileSync('npx', ['tsx', 'fable-lab/tools/calib3.ts', GUARD, '--outcomes', OUTCOMES], { encoding: 'utf8' })
} catch (err: any) {
  guardOk = String(err.stderr).includes('REFUSED: --outcomes is only for synthetic fixtures')
}
console.log(`${guardOk ? 'PASS' : 'FAIL'}  outcomes-guard refusal`)
if (!guardOk) fails++
unlinkSync(GUARD)

// Reserve-mode test: sub-window flag disabled, CANDIDATE(reserve).
const reserveOut = execFileSync(
  'npx',
  ['tsx', 'fable-lab/tools/calib3.ts', LOG, '--outcomes', OUTCOMES, '--expect-totals', '1,1'],
  { encoding: 'utf8' },
)
const reserveOk = /CANDIDATE cells: UP \(30-150-300, up-up\) \[reserve\]/.test(reserveOut)
console.log(`${reserveOk ? 'PASS' : 'FAIL'}  reserve-mode candidate (sub-windows disabled)`)
if (!reserveOk) fails++

// Reserve-mode discovery-path refusal.
let discoveryGuardOk = false
try {
  execFileSync(
    'npx',
    ['tsx', 'fable-lab/tools/calib3.ts', 'fable-lab/logs/CAL-001-discovery-fake.log', '--expect-totals', '1,1'],
    { encoding: 'utf8' },
  )
} catch (err: any) {
  discoveryGuardOk = String(err.stderr).includes('cannot be used on the discovery log')
}
console.log(`${discoveryGuardOk ? 'PASS' : 'FAIL'}  expect-totals discovery-path refusal`)
if (!discoveryGuardOk) fails++

if (fails > 0) {
  console.error(`SELFTEST FAILED: ${fails} assertion(s)`)
  process.exit(1)
}
console.log('SELFTEST OK')
