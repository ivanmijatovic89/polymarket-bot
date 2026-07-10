/**
 * calib-selftest.ts — mechanical validation of calib.ts (the CAL-001
 * instrument) on a SYNTHETIC fixture with hand-computed expected output.
 *
 * Usage: npx tsx fable-lab/tools/calib-selftest.ts
 *
 * Motivation (D28): CAL-001's real discovery read produced ZERO candidates,
 * so the CANDIDATE / demotion / NEG-FLAG branches of calib.ts had never
 * executed on ANY input — a bug in those branches would be observationally
 * identical to the published E20 null. calib2/calib3 got selftests at
 * registration; this closes the same gap for the most load-bearing tool.
 * The --outcomes injection path this test uses was proven inert on the real
 * log (byte-identical output before/after the change).
 *
 * Generates a deterministic synthetic diag-calib log + outcomes JSON under
 * fable-lab/logs/ (gitignored; this generator IS the committed fixture),
 * runs calib.ts on it, and asserts:
 *   - designed CANDIDATE: UP (30s, [0.50,0.650)), n=200, meanAsk=0.5400,
 *     winRate=0.7500, z≈+5.96, minority=50, sub-window consistent
 *   - designed demotion: UP (150s, same bucket), identical cell stats but
 *     W3(Feb) d=−0.04 → CANDIDATE-demoted(subwindow-inconsistent)
 *   - designed empty-sub-window demotion: UP (750s, same bucket), W3 has
 *     ZERO observations → demoted via the n>0 clause, rendered d=na
 *   - designed NEG-FLAG: DOWN (30s, same bucket), z≈−8.23, minority=50
 *   - designed NEG-FLAG(underpowered-E14): UP (300s, [0.35,0.500)),
 *     z≈−3.87 but minority=4 < 30
 *   - drift filter discards exactly 2 planted lines (ts past next offset)
 *   - dedupe-before-drift: a key whose FIRST occurrence is drift-invalid
 *     stays dead even when a later valid line arrives (cell stays empty)
 *   - band filter drops exactly 2 planted out-of-band asks (1.00, 0.005)
 *   - bucket edges: ask exactly 0.02→[0.02,0.10), 0.10→[0.10,0.20),
 *     0.98→[0.98,0.995], 0.995→[0.98,0.995] (last bucket hi-inclusive)
 *   - unresolved-outcome exclusion (1 slug absent from the outcome map)
 *   - both join-direction gates pass at winRate=0.9750 n=40; E14 controls
 *     empty-OK
 *   - gate ABORT paths: join-direction failure (BOTH arms: winRate≤0.9 and
 *     n<30) and E14 positive-control failure each exit(2) with their
 *     frozen message and no table printed
 *   - the --outcomes guard REFUSES paths without "synthetic"
 *   - the two summary lines are asserted as ANCHORED whole lines, so a
 *     double-listing bug (a cell in both candidates and negFlags) fails
 *
 * Known residue (audit AUDIT-2026-07-10-CALIB-SELFTEST.md finding 3,
 * accepted): the `net > 0` clause of the candidate condition is never the
 * discriminating factor — under Bernoulli-consistent variance a
 * bar-clearing d always exceeds the ~0.2-1.6c fee, so covering it needs a
 * ~48k-market fixture (disproportionate); and epochs ≥ Mar 2026 dropping
 * out of the sub-window check are untested (irrelevant to the frozen
 * Dec–Feb discovery window). Both argued analytically, not fixture-covered.
 *
 * Hand computation for the candidate cell (frozen formulas, calib.ts):
 *   meanAsk=0.54, winRate=150/200=0.75, d=+0.21,
 *   fee=winRate·0.0156·min(a,1−a)/a=0.75·0.0156·0.46/0.54=0.009967→"0.0100",
 *   net=0.2000, sumVar=200·0.54·0.46=49.68,
 *   se=sqrt(49.68)/200=0.035242→"0.0352", z=0.21/0.035242=5.9588→"+5.96",
 *   minority=50. NEG-FLAG mirror: winRate=0.25, d=−0.29, z=−8.229→"−8.23".
 *   Underpowered cell: n=40, ask=0.40, wins=4 → d=−0.30,
 *   se=sqrt(40·0.24)/40=0.077460→"0.0775", z=−3.873, minority=4.
 */
import { writeFileSync, copyFileSync, unlinkSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const LOG = 'fable-lab/logs/calib1-synthetic.log'
const OUTCOMES = 'fable-lab/logs/calib1-synthetic-outcomes.json'

function line(slug: string, epoch: number, asset: string, off: number, ts: number, bid: number, ask: number): string {
  return `[diag-calib] slug=${slug} epoch=${epoch} asset=${asset} off=${off} ts=${ts.toFixed(1)} bid=${bid.toFixed(4)} ask=${ask.toFixed(4)}`
}

const lines: string[] = ['[backtest] synthetic fixture — not a real run']
const outcomes: Record<string, string> = {}

// Sub-window blocks (calib.ts SUBWINDOWS: W1 <2026-01-01, W2 Jan, W3 Feb,
// by slug epoch·1000): Dec 2025 / Jan 2026 / Feb 2026 bases.
const W_BASES: Array<[number, number]> = [
  [1765000000, 70], // Dec 2025 (< 1767225600)
  [1768000000, 70], // Jan 2026
  [1770000000, 60], // Feb 2026 (≥ 1769904000)
]

// --- Candidate block: 200 markets, UP off=30 ask=0.54 (bucket [0.50,0.650)).
// Wins per window: 53/70, 52/70, 45/60 → 150/200; d>0 in every window.
// The SAME markets carry DOWN off=30 ask=0.54 lines → the DOWN cell is the
// designed NEG-FLAG (winRate 0.25, z≈−8.23, minority=50).
{
  const wins = [53, 52, 45]
  let ci = 0
  for (let b = 0; b < W_BASES.length; b++) {
    const [base, count] = W_BASES[b]
    for (let i = 0; i < count; i++, ci++) {
      const slug = `synth-c${String(ci + 1).padStart(3, '0')}`
      const epoch = base + i * 900
      lines.push(line(slug, epoch, 'UP', 30, 30, 0.52, 0.54))
      lines.push(line(slug, epoch, 'DOWN', 30, 30, 0.52, 0.54))
      outcomes[slug] = i < wins[b] ? '0' : '1'
    }
  }
}

// --- Demotion block: 200 NEW markets, UP off=150 ask=0.54. Wins 60/70,
// 60/70, 30/60 → 150/200 (identical cell stats to the candidate) but
// W3 d = 0.50 − 0.54 = −0.04 → must demote, never reach the candidate list.
{
  const wins = [60, 60, 30]
  let mi = 0
  for (let b = 0; b < W_BASES.length; b++) {
    const [base, count] = W_BASES[b]
    for (let i = 0; i < count; i++, mi++) {
      const slug = `synth-m${String(mi + 1).padStart(3, '0')}`
      const epoch = base + i * 900
      lines.push(line(slug, epoch, 'UP', 150, 150, 0.52, 0.54))
      outcomes[slug] = i < wins[b] ? '0' : '1'
    }
  }
}

// --- Empty-sub-window demotion (audit finding 3b): 200 NEW markets, UP
// off=750 ask=0.54, wins 75/100 (W1) + 75/100 (W2), NOTHING in W3 →
// identical cell stats again (z=+5.96) but W3 n=0 → `consistent` must
// fail on the n>0 clause and render d=na.
{
  let ni = 0
  for (const [base, count] of [
    [1765000000, 100],
    [1768000000, 100],
  ] as Array<[number, number]>) {
    for (let i = 0; i < count; i++, ni++) {
      const slug = `synth-n${String(ni + 1).padStart(3, '0')}`
      lines.push(line(slug, base + i * 900, 'UP', 750, 750, 0.52, 0.54))
      outcomes[slug] = i < 75 ? '0' : '1'
    }
  }
}

// --- Underpowered NEG-FLAG: 40 markets, UP off=300 ask=0.40, 4 wins →
// z=−3.87 clears the bar but minority=4 < 30 → NEG-FLAG(underpowered-E14).
for (let i = 0; i < 40; i++) {
  const slug = `synth-u${String(i + 1).padStart(3, '0')}`
  lines.push(line(slug, 1765400000 + i * 900, 'UP', 300, 300, 0.38, 0.4))
  outcomes[slug] = i < 4 ? '0' : '1'
}

// --- Gate blocks: cell (850s, [0.98,0.995]) per side, n=40, winRate 0.975.
for (let i = 0; i < 40; i++) {
  const slug = `synth-g${String(i + 1).padStart(3, '0')}` // UP tail
  lines.push(line(slug, 1765500000 + i * 900, 'UP', 850, 850, 0.98, 0.99))
  outcomes[slug] = i < 39 ? '0' : '1'
}
for (let i = 0; i < 40; i++) {
  const slug = `synth-h${String(i + 1).padStart(3, '0')}` // DOWN tail
  lines.push(line(slug, 1766000000 + i * 900, 'DOWN', 850, 850, 0.98, 0.99))
  outcomes[slug] = i < 39 ? '1' : '0'
}

// --- Bucket-edge markets: asks landing EXACTLY on frozen edges. Offsets
// chosen so each row is its own n=1 cell (no collisions with other blocks).
lines.push(line('synth-e001', 1765200000, 'UP', 450, 450, 0.01, 0.02)) // → [0.02,0.100)
lines.push(line('synth-e002', 1765200900, 'UP', 450, 450, 0.09, 0.1)) // → [0.10,0.200)
lines.push(line('synth-e003', 1765201800, 'UP', 450, 450, 0.97, 0.98)) // → [0.98,0.995]
lines.push(line('synth-e004', 1765202700, 'UP', 600, 600, 0.99, 0.995)) // → [0.98,0.995] hi-inclusive
for (const s of ['synth-e001', 'synth-e002', 'synth-e003', 'synth-e004']) outcomes[s] = '0'

// --- Drift-ordering case: FIRST occurrence of (d001,UP,450) is
// drift-invalid (ts 601 ≥ NEXT_BOUND[450]=600); the later valid line must
// stay deduped (seen-key added before the drift check), so cell
// (450s, [0.50,0.650)) stays EMPTY. The off=600 line is valid → n=1 cell.
lines.push(line('synth-d001', 1765300000, 'UP', 450, 601, 0.5, 0.52))
lines.push(line('synth-d001', 1765300000, 'UP', 450, 450, 0.5, 0.52))
lines.push(line('synth-d001', 1765300000, 'UP', 600, 600, 0.5, 0.52))
outcomes['synth-d001'] = '0'

// --- Unresolved-outcome exclusion: valid line, slug absent from outcomes.
lines.push(line('synth-r001', 1765310000, 'UP', 30, 30, 0.28, 0.3))

// --- Planted defects the pipeline must count. ---
// 1 more drift line (ts=460 ≥ NEXT_BOUND[300]=450) → total drift = 2.
lines.push(line('synth-c001', 1765000000, 'UP', 300, 460, 0.5, 0.52))
// 1 exact duplicate key of an existing observation → dedupe (no double count).
lines.push(line('synth-c001', 1765000000, 'UP', 30, 30, 0.52, 0.54))
// 2 out-of-band asks (1.00 > 0.995, 0.005 < 0.02) on a slug with no valid obs.
lines.push(line('synth-x001', 1765320000, 'UP', 30, 30, 0.98, 1.0))
lines.push(line('synth-x001', 1765320000, 'UP', 150, 150, 0.0, 0.005))

writeFileSync(LOG, lines.join('\n') + '\n')
writeFileSync(OUTCOMES, JSON.stringify(outcomes, null, 1))

const out = execFileSync('npx', ['tsx', 'fable-lab/tools/calib.ts', LOG, '--outcomes', OUTCOMES], {
  encoding: 'utf8',
})
console.log(out)

// Totals: obs = 400 (candidate UP+DOWN) + 200 (demoted) + 200 (demoted-na)
// + 40 (underpowered) + 80 (gates) + 4 (edges) + 1 (d001 off=600) +
// 1 (r001) = 926 across 726 markets; 727 emitted any line (x001 has none
// valid); outcomes map has 725 entries (r001 absent) → joined 725/726.
const EXPECT: Array<[string, string | RegExp]> = [
  [
    'parsed totals (drift=2, band=2, dedupe absorbed)',
    'parsed 926 valid observations across 726 markets (2 drift-discarded [ts past next offset], 2 ask outside [0.02,0.995]; 727 markets emitted any line)',
  ],
  ['UP coverage', 'per-offset market coverage UP: o30=201 o150=200 o300=40 o450=3 o600=2 o750=200 o850=40'],
  ['DOWN coverage', 'per-offset market coverage DOWN: o30=200 o150=0 o300=0 o450=0 o600=0 o750=0 o850=40'],
  ['unresolved exclusion', 'outcome joined for 725/726 markets (1 missing/unresolved — excluded)'],
  ['UP join gate + empty control', 'gates UP: join-direction OK (850s tail winRate=0.9750, n=40); E14 positive control OK (empty)'],
  ['DOWN join gate + empty control', 'gates DOWN: join-direction OK (850s tail winRate=0.9750, n=40); E14 positive control OK (empty)'],
  // Candidate row: n=200, meanAsk 0.5400, winRate 0.7500, d +0.2100,
  // fee 0.0100, net +0.2000, se 0.0352, z +5.96, minority 50.
  [
    'candidate row',
    /30\s+\[0\.50,0\.650\)\s+200\s+0\.5400\s+0\.7500 \+0\.2100 0\.0100 \+0\.2000 0\.0352 \+\s+5\.96\s+50\s+CANDIDATE\s*$/m,
  ],
  // Anchored ^…$ (audit finding 2): a double-listing bug (e.g. demoted cell
  // ALSO pushed to candidates) must fail this, not hide past a prefix match.
  [
    'candidate list (sub-windows hand-computed, exact whole line)',
    /^CANDIDATE cells: UP \(30s, \[0\.50,0\.650\)\) \[W1\(→Dec\):n=70,d=0\.2171 W2\(Jan\):n=70,d=0\.2029 W3\(Feb\):n=60,d=0\.2100\]$/m,
  ],
  [
    'demoted row (same stats, W3 negative)',
    /150\s+\[0\.50,0\.650\)\s+200\s+0\.5400\s+0\.7500 \+0\.2100 0\.0100 \+0\.2000 0\.0352 \+\s+5\.96\s+50\s+CANDIDATE-demoted\(subwindow-inconsistent\)/,
  ],
  [
    'demoted listed under neg-flags, not candidates',
    'demoted UP (150s, [0.50,0.650)) [W1(→Dec):n=70,d=0.3171 W2(Jan):n=70,d=0.3171 W3(Feb):n=60,d=-0.0400]',
  ],
  [
    'neg-flag row (DOWN mirror, z −8.23)',
    /30\s+\[0\.50,0\.650\)\s+200\s+0\.5400\s+0\.2500 -0\.2900 0\.0033 -0\.2933 0\.0352\s+-8\.23\s+50\s+NEG-FLAG\s*$/m,
  ],
  [
    'underpowered neg-flag row (z −3.87, minority 4)',
    /300\s+\[0\.35,0\.500\)\s+40\s+0\.4000\s+0\.1000 -0\.3000 0\.0016 -0\.3016 0\.0775\s+-3\.87\s+4\s+NEG-FLAG\(underpowered-E14\)/,
  ],
  [
    'demoted-na row (empty W3 sub-window, audit finding 3b)',
    /750\s+\[0\.50,0\.650\)\s+200\s+0\.5400\s+0\.7500 \+0\.2100 0\.0100 \+0\.2000 0\.0352 \+\s+5\.96\s+50\s+CANDIDATE-demoted\(subwindow-inconsistent\)/,
  ],
  // Anchored ^…$ (audit finding 2), and pins the demoted-na rendering
  // `W3(Feb):n=0,d=na` (the NaN branch).
  [
    'neg-flag summary (order: demoted, underpowered, demoted-na, DOWN; exact whole line)',
    /^NEG-FLAG \/ demoted cells: demoted UP \(150s, \[0\.50,0\.650\)\) \[W1\(→Dec\):n=70,d=0\.3171 W2\(Jan\):n=70,d=0\.3171 W3\(Feb\):n=60,d=-0\.0400\], UP \(300s, \[0\.35,0\.500\)\) NEG-FLAG\(underpowered-E14\), demoted UP \(750s, \[0\.50,0\.650\)\) \[W1\(→Dec\):n=100,d=0\.2100 W2\(Jan\):n=100,d=0\.2100 W3\(Feb\):n=0,d=na\], DOWN \(30s, \[0\.50,0\.650\)\) NEG-FLAG$/m,
  ],
  ['drift-first key stays dead (cell never forms)', /450\s+\[0\.50,0\.650\)\s+empty/],
  ['edge ask=0.02 → [0.02,0.100)', /450\s+\[0\.02,0\.100\)\s+1\s+0\.0200/],
  ['edge ask=0.10 → [0.10,0.200)', /450\s+\[0\.10,0\.200\)\s+1\s+0\.1000/],
  ['edge ask=0.98 → [0.98,0.995]', /450\s+\[0\.98,0\.995\]\s+1\s+0\.9800/],
  ['edge ask=0.995 → [0.98,0.995] (hi-inclusive)', /600\s+\[0\.98,0\.995\]\s+1\s+0\.9950/],
  ['unresolved market drops out of grid', /30\s+\[0\.20,0\.350\)\s+empty/],
]
let fails = 0
for (const [name, pat] of EXPECT) {
  const ok = typeof pat === 'string' ? out.includes(pat) : pat.test(out)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) fails++
}

// Guard test: --outcomes refused when the log path lacks "synthetic".
const GUARD = 'fable-lab/logs/calib1-guardtest.log'
copyFileSync(LOG, GUARD)
let guardOk = false
try {
  execFileSync('npx', ['tsx', 'fable-lab/tools/calib.ts', GUARD, '--outcomes', OUTCOMES], { encoding: 'utf8' })
} catch (err: any) {
  guardOk = String(err.stderr).includes('REFUSED: --outcomes is only for synthetic fixtures')
}
console.log(`${guardOk ? 'PASS' : 'FAIL'}  outcomes-guard refusal`)
if (!guardOk) fails++
unlinkSync(GUARD)

// Gate-abort test 1: join-direction failure. Same log, outcome variant with
// the UP tail block mostly LOSING (winRate 0.25 ≤ 0.9) → exit 2, frozen
// message, and the cell table must never print.
{
  const variant = { ...JSON.parse(readFileSync(OUTCOMES, 'utf8')) } as Record<string, string>
  for (let i = 0; i < 40; i++) variant[`synth-g${String(i + 1).padStart(3, '0')}`] = i < 10 ? '0' : '1'
  const V = 'fable-lab/logs/calib1-synthetic-outcomes-joinfail.json'
  writeFileSync(V, JSON.stringify(variant))
  let ok = false
  try {
    execFileSync('npx', ['tsx', 'fable-lab/tools/calib.ts', LOG, '--outcomes', V], { encoding: 'utf8' })
  } catch (err: any) {
    ok =
      err.status === 2 &&
      String(err.stderr).includes('ABORT — join-direction gate failed (UP)') &&
      !String(err.stdout).includes('CAL-001 UP-side cell table')
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  join-direction gate abort (exit 2, no table)`)
  if (!ok) fails++
}

// Gate-abort test 1b (audit finding 3a): join-direction n<30 arm. Outcome
// variant resolving only 20 of the 40 UP-tail markets (winRate 0.95 > 0.9,
// so ONLY the n≥30 clause can fire) → exit 2, frozen message with n=20.
{
  const variant = { ...JSON.parse(readFileSync(OUTCOMES, 'utf8')) } as Record<string, string>
  for (let i = 20; i < 40; i++) delete variant[`synth-g${String(i + 1).padStart(3, '0')}`]
  for (let i = 0; i < 20; i++) variant[`synth-g${String(i + 1).padStart(3, '0')}`] = i < 19 ? '0' : '1'
  const V = 'fable-lab/logs/calib1-synthetic-outcomes-lowN.json'
  writeFileSync(V, JSON.stringify(variant))
  let ok = false
  try {
    execFileSync('npx', ['tsx', 'fable-lab/tools/calib.ts', LOG, '--outcomes', V], { encoding: 'utf8' })
  } catch (err: any) {
    ok =
      err.status === 2 &&
      String(err.stderr).includes('ABORT — join-direction gate failed (UP)') &&
      String(err.stderr).includes('n=20 winRate=0.9500') &&
      !String(err.stdout).includes('CAL-001 UP-side cell table')
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  join-direction gate n<30 arm abort (exit 2, no table)`)
  if (!ok) fails++
}

// Gate-abort test 2: E14 positive-control failure. Log variant with 200
// all-winning UP entries at (850s, [0.90,0.98)) → d=+0.10, z≈+4.71 ≥ 3.565
// → exit 2, frozen message.
{
  const extra: string[] = []
  const variantOutcomes = { ...JSON.parse(readFileSync(OUTCOMES, 'utf8')) } as Record<string, string>
  for (let i = 0; i < 200; i++) {
    const slug = `synth-p${String(i + 1).padStart(3, '0')}`
    extra.push(line(slug, 1766500000 + i * 900, 'UP', 850, 850, 0.88, 0.9))
    variantOutcomes[slug] = '0'
  }
  const VL = 'fable-lab/logs/calib1-synthetic-e14fail.log'
  const VO = 'fable-lab/logs/calib1-synthetic-outcomes-e14fail.json'
  writeFileSync(VL, lines.join('\n') + '\n' + extra.join('\n') + '\n')
  writeFileSync(VO, JSON.stringify(variantOutcomes))
  let ok = false
  try {
    execFileSync('npx', ['tsx', 'fable-lab/tools/calib.ts', VL, '--outcomes', VO], { encoding: 'utf8' })
  } catch (err: any) {
    ok =
      err.status === 2 &&
      String(err.stderr).includes('ABORT — E14 positive-control gate failed (UP)') &&
      !String(err.stdout).includes('CAL-001 UP-side cell table')
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  E14 positive-control gate abort (exit 2, no table)`)
  if (!ok) fails++
}

if (fails > 0) {
  console.error(`SELFTEST FAILED: ${fails} assertion(s)`)
  process.exit(1)
}
console.log('SELFTEST OK')
