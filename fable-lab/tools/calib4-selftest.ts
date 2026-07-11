/**
 * calib4-selftest.ts — mechanical validation of calib4.ts (the CAL-004
 * instrument) on SYNTHETIC fixtures with hand-computed expected output,
 * committed BEFORE the one-shot read (CAL-002/003 precedent; D28 lens).
 *
 * Usage: npx tsx fable-lab/tools/calib4-selftest.ts
 *
 * Asserts (hand computations in comments below):
 *   - spread-state assignment: tight (0.54-0.53=0.0100..→T), wide
 *     (0.54-0.50=0.0400..→W), and BOTH exact-edge FP behaviors
 *     (0.5305-0.52=0.010499..→T; 0.54-0.5295=0.010500..0065→W) — the
 *     CAL-002 finding-4 exposure class, documented as actual behavior
 *   - designed T CANDIDATE: UP T (30s, [0.50,0.650)) n=200 z≈+5.96,
 *     sub-window consistent; its same-cell W complement (n=50, z≈−1.99)
 *     stays unflagged; tfr prints 0.800 on the T row
 *   - designed W NEG-FLAG: DOWN W (30s, same bucket) z≈−8.23 minority=50
 *   - designed W NEG-FLAG(underpowered-E14): UP W (300s, [0.35,0.500))
 *     z≈−3.87 minority=4 (0.40-0.38=0.0200..→W)
 *   - sub-window demotion (W3 negative) and empty-sub-window demotion
 *     (W3 n=0 → d=na), both on T cells
 *   - state pooling in gates: each join-direction gate cell mixes 20 T +
 *     20 W lines and must pass POOLED at winRate=0.9750 n=40
 *   - calib.ts pipeline semantics preserved: drift filter (2 planted),
 *     dedupe-before-drift (drift-first key stays dead), band filter
 *     (2 planted), unresolved-outcome exclusion, line/pipeline totals
 *   - RESERVE mode (--expect-totals): correct totals run with the
 *     sub-window requirement DROPPED (a discovery-demoted cell prints
 *     CANDIDATE); wrong totals abort exit 2; refused on paths containing
 *     "CAL-001-discovery"
 *   - gate ABORT paths: join-direction failure (winRate≤0.9 arm and n<30
 *     arm) and E14 positive-control failure each exit(2), no table
 *   - the --outcomes guard REFUSES paths without "synthetic"
 *   - summary lines asserted as ANCHORED whole lines (double-listing bug
 *     coverage, U47b finding-2 precedent)
 *
 * Known residue (accepted, disclosed): the DISCOVERY identity gates 1-6
 * (hard-coded published CAL-001 totals) cannot execute on synthetic input
 * by construction — they are simple equality comparisons whose failure
 * direction is fail-safe (abort BEFORE any new cell prints, exposing only
 * already-published totals), reviewed by the pre-read audit. The reserve
 * empty-E14-control abort (real-log semantics) is likewise untestable
 * synthetically (outcomes injection requires a "synthetic" path, which
 * relaxes that arm); its logic is one boolean shared with the tested
 * discovery arm. The `net > 0` clause residue carries over from
 * calib-selftest.ts (D28 amendment).
 *
 * Hand computation, candidate cell (frozen formulas): meanAsk=0.54,
 * winRate=150/200=0.75, d=+0.21, fee=0.75·0.0156·0.46/0.54=0.009967
 * →"0.0100", net=+0.2000, se=sqrt(200·0.54·0.46)/200=0.035242→"0.0352",
 * z=+5.9588→"+5.96", minority=50. Same-cell W complement: n=50,
 * winRate=0.40, d=−0.14, fee=0.40·0.0156·0.46/0.54=0.005316→"0.0053",
 * net=−0.1453, se=sqrt(50·0.2484)/50=0.070484→"0.0705", z=−1.9863
 * →"−1.99", minority=20. DOWN W NEG-FLAG: winRate=0.25, d=−0.29,
 * fee=0.25·0.0156·0.46/0.54=0.003322→"0.0033", net=−0.2933, z=−8.2288
 * →"−8.23". Underpowered: n=40, ask=0.40, 4 wins → d=−0.30,
 * se=sqrt(40·0.24)/40=0.077460→"0.0775", z=−3.873→"−3.87" (clears the
 * 3.75 bar), minority=4.
 */
import { writeFileSync, copyFileSync, unlinkSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const LOG = 'fable-lab/logs/calib4-synthetic.log'
const OUTCOMES = 'fable-lab/logs/calib4-synthetic-outcomes.json'
const RLOG = 'fable-lab/logs/calib4-synthetic-reserve.log'
const ROUT = 'fable-lab/logs/calib4-synthetic-reserve-outcomes.json'

function line(slug: string, epoch: number, asset: string, off: number, ts: number, bid: number, ask: number): string {
  return `[diag-calib] slug=${slug} epoch=${epoch} asset=${asset} off=${off} ts=${ts.toFixed(1)} bid=${bid.toFixed(4)} ask=${ask.toFixed(4)}`
}

const lines: string[] = ['[backtest] synthetic fixture — not a real run']
const outcomes: Record<string, string> = {}

const W_BASES: Array<[number, number]> = [
  [1765000000, 70], // Dec 2025 (< 2026-01-01)
  [1768000000, 70], // Jan 2026
  [1770000000, 60], // Feb 2026
]

// --- T candidate + DOWN W neg-flag: 200 markets, UP off=30 bid=0.53
// ask=0.54 (spread 0.0100.. → T); same markets carry DOWN off=30 bid=0.50
// ask=0.54 (spread 0.0400.. → W). Wins 53/70, 52/70, 45/60 → 150/200.
{
  const wins = [53, 52, 45]
  let ci = 0
  for (let b = 0; b < W_BASES.length; b++) {
    const [base, count] = W_BASES[b]
    for (let i = 0; i < count; i++, ci++) {
      const slug = `synth-c${String(ci + 1).padStart(3, '0')}`
      const epoch = base + i * 900
      lines.push(line(slug, epoch, 'UP', 30, 30, 0.53, 0.54))
      lines.push(line(slug, epoch, 'DOWN', 30, 30, 0.5, 0.54))
      outcomes[slug] = i < wins[b] ? '0' : '1'
    }
  }
}

// --- W complement of the candidate cell: 50 NEW markets, UP off=30
// bid=0.50 ask=0.54 (→ W), 20 wins → winRate 0.40, z≈−1.99, unflagged.
// tfr of UP (30s, [0.50,0.650)) = 200/250 = 0.800.
for (let i = 0; i < 50; i++) {
  const slug = `synth-w${String(i + 1).padStart(3, '0')}`
  lines.push(line(slug, 1765600000 + i * 900, 'UP', 30, 30, 0.5, 0.54))
  outcomes[slug] = i < 20 ? '0' : '1'
}

// --- Sub-window demotion: 200 markets, UP off=150 T. Wins 60/70, 60/70,
// 30/60 → same cell stats as the candidate but W3 d=−0.04 → demoted.
{
  const wins = [60, 60, 30]
  let mi = 0
  for (let b = 0; b < W_BASES.length; b++) {
    const [base, count] = W_BASES[b]
    for (let i = 0; i < count; i++, mi++) {
      const slug = `synth-m${String(mi + 1).padStart(3, '0')}`
      lines.push(line(slug, base + i * 900, 'UP', 150, 150, 0.53, 0.54))
      outcomes[slug] = i < wins[b] ? '0' : '1'
    }
  }
}

// --- Empty-sub-window demotion: 200 markets, UP off=750 T, wins 75/100
// (W1) + 75/100 (W2), NOTHING in W3 → z=+5.96 but W3 n=0 → d=na demotion.
{
  let ni = 0
  for (const [base, count] of [
    [1765000000, 100],
    [1768000000, 100],
  ] as Array<[number, number]>) {
    for (let i = 0; i < count; i++, ni++) {
      const slug = `synth-n${String(ni + 1).padStart(3, '0')}`
      lines.push(line(slug, base + i * 900, 'UP', 750, 750, 0.53, 0.54))
      outcomes[slug] = i < 75 ? '0' : '1'
    }
  }
}

// --- W underpowered NEG-FLAG: 40 markets, UP off=300 bid=0.38 ask=0.40
// (spread 0.0200.. → W), 4 wins → z=−3.87, minority=4 < 30.
for (let i = 0; i < 40; i++) {
  const slug = `synth-u${String(i + 1).padStart(3, '0')}`
  lines.push(line(slug, 1765400000 + i * 900, 'UP', 300, 300, 0.38, 0.4))
  outcomes[slug] = i < 4 ? '0' : '1'
}

// --- Gate blocks with MIXED spread states (pooling test): per side, cell
// (850s, [0.98,0.995]) gets 20 T lines (bid 0.98 ask 0.99) + 20 W lines
// (bid 0.95 ask 0.99); pooled winRate 39/40 = 0.9750.
for (let i = 0; i < 40; i++) {
  const slug = `synth-g${String(i + 1).padStart(3, '0')}` // UP tail
  lines.push(line(slug, 1765500000 + i * 900, 'UP', 850, 850, i < 20 ? 0.98 : 0.95, 0.99))
  outcomes[slug] = i < 39 ? '0' : '1'
}
for (let i = 0; i < 40; i++) {
  const slug = `synth-h${String(i + 1).padStart(3, '0')}` // DOWN tail
  lines.push(line(slug, 1766000000 + i * 900, 'DOWN', 850, 850, i < 20 ? 0.98 : 0.95, 0.99))
  outcomes[slug] = i < 39 ? '1' : '0'
}

// --- Spread exact-edge FP cases (n=1 cells; both directions documented):
// e001: 0.5305 − 0.52 = 0.010499999999999954 ≤ 0.0105 → T
// e002: 0.54 − 0.5295 = 0.010500000000000065 > 0.0105 → W
lines.push(line('synth-e001', 1765200000, 'UP', 450, 450, 0.52, 0.5305))
lines.push(line('synth-e002', 1765201800, 'UP', 750, 750, 0.5295, 0.54))
for (const s of ['synth-e001', 'synth-e002']) outcomes[s] = '0'

// --- Drift-ordering case (calib.ts convention preserved): FIRST occurrence
// of (d001,UP,450) is drift-invalid (ts 601 ≥ 600); the later valid line
// stays deduped → cell (450s,[0.50,0.650)) W stays EMPTY (bid 0.50 ask
// 0.52 → W). The off=600 line is valid → n=1 W cell at (600s).
lines.push(line('synth-d001', 1765300000, 'UP', 450, 601, 0.5, 0.52))
lines.push(line('synth-d001', 1765300000, 'UP', 450, 450, 0.5, 0.52))
lines.push(line('synth-d001', 1765300000, 'UP', 600, 600, 0.5, 0.52))
outcomes['synth-d001'] = '0'

// --- Unresolved-outcome exclusion: valid line, slug absent from outcomes.
lines.push(line('synth-r001', 1765310000, 'UP', 30, 30, 0.28, 0.3))

// --- Planted defects: 1 more drift line (total 2), 1 exact duplicate key,
// 2 out-of-band asks on a slug with no valid obs.
lines.push(line('synth-c001', 1765000000, 'UP', 300, 460, 0.5, 0.52))
lines.push(line('synth-c001', 1765000000, 'UP', 30, 30, 0.53, 0.54))
lines.push(line('synth-x001', 1765320000, 'UP', 30, 30, 0.98, 1.0))
lines.push(line('synth-x001', 1765320000, 'UP', 150, 150, 0.0, 0.005))

writeFileSync(LOG, lines.join('\n') + '\n')
writeFileSync(OUTCOMES, JSON.stringify(outcomes, null, 1))

const out = execFileSync('npx', ['tsx', 'fable-lab/tools/calib4.ts', LOG, '--outcomes', OUTCOMES], {
  encoding: 'utf8',
})
console.log(out)

// Line totals: UP = 200(c)+50(w)+200(m)+200(n)+40(u)+40(g)+2(e)+3(d001)
// +1(r001)+1(drift)+1(dup)+2(band) = 740; DOWN = 200(c)+40(h) = 240.
// Valid obs: UP o30=251 o150=200 o300=40 o450=1 o600=1 o750=201 o850=40
// (=734) + DOWN o30=200 o850=40 (=240) = 974 across 774 markets;
// 775 emitted any line (x001 band-only); joined 773 (r001 unresolved).
const EXPECT: Array<[string, string | RegExp]> = [
  ['line totals', 'gate line-totals: OK (lines=980, UP=740, DOWN=240)'],
  [
    'pipeline totals (drift=2, band=2, dedupe absorbed)',
    'parsed 974 valid observations across 774 markets (2 drift-discarded [ts past next offset], 2 ask outside [0.02,0.995]; 775 markets emitted any line)',
  ],
  ['UP coverage', 'per-offset market coverage UP: o30=251 o150=200 o300=40 o450=1 o600=1 o750=201 o850=40'],
  ['DOWN coverage', 'per-offset market coverage DOWN: o30=200 o150=0 o300=0 o450=0 o600=0 o750=0 o850=40'],
  ['unresolved exclusion', 'outcome joined for 773/774 markets (1 missing/unresolved — excluded)'],
  [
    'UP gate pooled across states + empty control',
    'gates UP: join-direction OK (pooled 850s tail winRate=0.9750, n=40); E14 positive control OK (empty)',
  ],
  [
    'DOWN gate pooled across states + empty control',
    'gates DOWN: join-direction OK (pooled 850s tail winRate=0.9750, n=40); E14 positive control OK (empty)',
  ],
  [
    'T candidate row with tfr=0.800',
    /30\s+\[0\.50,0\.650\)\s+T\s+200\s+0\.800\s+0\.5400\s+0\.7500 \+0\.2100 0\.0100 \+0\.2000 0\.0352 \+\s+5\.96\s+50\s+CANDIDATE\s*$/m,
  ],
  [
    'same-cell W complement unflagged (z −1.99)',
    /30\s+\[0\.50,0\.650\)\s+W\s+50\s+0\.5400\s+0\.4000 -0\.1400 0\.0053 -0\.1453 0\.0705\s+-1\.99\s+20\s*$/m,
  ],
  [
    'candidate list (anchored whole line, sub-windows hand-computed)',
    /^CANDIDATE cells: UP T \(30s, \[0\.50,0\.650\)\) \[W1\(→Dec\):n=70,d=0\.2171 W2\(Jan\):n=70,d=0\.2029 W3\(Feb\):n=60,d=0\.2100\]$/m,
  ],
  [
    'demoted row (T, W3 negative)',
    /150\s+\[0\.50,0\.650\)\s+T\s+200\s+1\.000\s+0\.5400\s+0\.7500 \+0\.2100 0\.0100 \+0\.2000 0\.0352 \+\s+5\.96\s+50\s+CANDIDATE-demoted\(subwindow-inconsistent\)/,
  ],
  [
    'demoted-na row (T, empty W3, tfr 0.995)',
    /750\s+\[0\.50,0\.650\)\s+T\s+200\s+0\.995\s+0\.5400\s+0\.7500 \+0\.2100 0\.0100 \+0\.2000 0\.0352 \+\s+5\.96\s+50\s+CANDIDATE-demoted\(subwindow-inconsistent\)/,
  ],
  [
    'DOWN W neg-flag row (z −8.23)',
    /30\s+\[0\.50,0\.650\)\s+W\s+200\s+0\.5400\s+0\.2500 -0\.2900 0\.0033 -0\.2933 0\.0352\s+-8\.23\s+50\s+NEG-FLAG\s*$/m,
  ],
  [
    'W underpowered neg-flag row (z −3.87 clears 3.75, minority 4)',
    /300\s+\[0\.35,0\.500\)\s+W\s+40\s+0\.4000\s+0\.1000 -0\.3000 0\.0016 -0\.3016 0\.0775\s+-3\.87\s+4\s+NEG-FLAG\(underpowered-E14\)/,
  ],
  [
    'neg-flag summary (anchored whole line; order UP-150-T, UP-300-W, UP-750-T, DOWN-30-W)',
    /^NEG-FLAG \/ demoted cells: demoted UP T \(150s, \[0\.50,0\.650\)\) \[W1\(→Dec\):n=70,d=0\.3171 W2\(Jan\):n=70,d=0\.3171 W3\(Feb\):n=60,d=-0\.0400\], UP W \(300s, \[0\.35,0\.500\)\) NEG-FLAG\(underpowered-E14\), demoted UP T \(750s, \[0\.50,0\.650\)\) \[W1\(→Dec\):n=100,d=0\.2100 W2\(Jan\):n=100,d=0\.2100 W3\(Feb\):n=0,d=na\], DOWN W \(30s, \[0\.50,0\.650\)\) NEG-FLAG$/m,
  ],
  ['edge 0.5305−0.52 → T', /450\s+\[0\.50,0\.650\)\s+T\s+1\s+1\.000\s+0\.5305\s+1\.0000/],
  ['edge 0.54−0.5295 → W', /750\s+\[0\.50,0\.650\)\s+W\s+1\s+0\.5400\s+1\.0000/],
  ['drift-first key stays dead (W cell never forms)', /450\s+\[0\.50,0\.650\)\s+W empty/],
  ['d001 valid off=600 line lands W', /600\s+\[0\.50,0\.650\)\s+W\s+1\s+0\.5200/],
  ['unresolved market drops out of grid', /30\s+\[0\.20,0\.350\)\s+T empty/],
]
let fails = 0
for (const [name, pat] of EXPECT) {
  const ok = typeof pat === 'string' ? out.includes(pat) : pat.test(out)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) fails++
}

// --- Reserve-mode fixture (balanced sides: 240 UP / 240 DOWN lines) ---
// UP off=150 T demote-block clone (wins 150/200 with W3 d<0) + mixed-state
// gate blocks + 200 DOWN filler at (150s,[0.20,0.350)) T with winRate =
// meanAsk = 0.30 (d=0, unflagged). In reserve mode the sub-window
// requirement is dropped → the cell must print CANDIDATE.
{
  const rlines: string[] = ['[backtest] synthetic reserve fixture — not a real run']
  const routcomes: Record<string, string> = {}
  const wins = [60, 60, 30]
  let mi = 0
  for (let b = 0; b < W_BASES.length; b++) {
    const [base, count] = W_BASES[b]
    for (let i = 0; i < count; i++, mi++) {
      const slug = `rsynth-m${String(mi + 1).padStart(3, '0')}`
      rlines.push(line(slug, base + i * 900, 'UP', 150, 150, 0.53, 0.54))
      routcomes[slug] = i < wins[b] ? '0' : '1'
    }
  }
  for (let i = 0; i < 40; i++) {
    const slug = `rsynth-g${String(i + 1).padStart(3, '0')}`
    rlines.push(line(slug, 1765500000 + i * 900, 'UP', 850, 850, i < 20 ? 0.98 : 0.95, 0.99))
    routcomes[slug] = i < 39 ? '0' : '1'
  }
  for (let i = 0; i < 40; i++) {
    const slug = `rsynth-h${String(i + 1).padStart(3, '0')}`
    rlines.push(line(slug, 1766000000 + i * 900, 'DOWN', 850, 850, i < 20 ? 0.98 : 0.95, 0.99))
    routcomes[slug] = i < 39 ? '1' : '0'
  }
  for (let i = 0; i < 200; i++) {
    const slug = `rsynth-f${String(i + 1).padStart(3, '0')}`
    rlines.push(line(slug, 1767000000 + i * 900, 'DOWN', 150, 150, 0.29, 0.3))
    routcomes[slug] = i < 60 ? '1' : '0'
  }
  writeFileSync(RLOG, rlines.join('\n') + '\n')
  writeFileSync(ROUT, JSON.stringify(routcomes, null, 1))

  const rout = execFileSync(
    'npx',
    ['tsx', 'fable-lab/tools/calib4.ts', RLOG, '--expect-totals', '480,240', '--outcomes', ROUT],
    { encoding: 'utf8' },
  )
  const RESERVE_EXPECT: Array<[string, string | RegExp]> = [
    ['reserve line totals', 'gate line-totals: OK (lines=480, UP=240, DOWN=240)'],
    ['reserve header (no sub-window)', 'reserve mode: no sub-window requirement'],
    [
      'reserve candidate (anchored: discovery-demoted cell promotes, no sub-window suffix)',
      /^CANDIDATE cells: UP T \(150s, \[0\.50,0\.650\)\)$/m,
    ],
    ['reserve filler cell on-diagonal', /150\s+\[0\.20,0\.350\)\s+T\s+200\s+1\.000\s+0\.3000\s+0\.3000 \+0\.0000/],
    ['reserve neg-flag summary empty', /^NEG-FLAG \/ demoted cells: none$/m],
  ]
  for (const [name, pat] of RESERVE_EXPECT) {
    const ok = typeof pat === 'string' ? rout.includes(pat) : pat.test(rout)
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
    if (!ok) fails++
  }

  // Reserve wrong-totals abort (exit 2, no table).
  let ok = false
  try {
    execFileSync('npx', ['tsx', 'fable-lab/tools/calib4.ts', RLOG, '--expect-totals', '480,239', '--outcomes', ROUT], {
      encoding: 'utf8',
    })
  } catch (err: any) {
    ok =
      err.status === 2 &&
      String(err.stderr).includes('ABORT — reserve totals gate failed') &&
      !String(err.stdout).includes('CAL-004 UP-side cell table')
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  reserve wrong-totals abort (exit 2, no table)`)
  if (!ok) fails++

  // Reserve-guard refusal: --expect-totals on a path containing
  // "CAL-001-discovery" (path also contains "synthetic" so the outcomes
  // guard passes first — isolates the reserve guard).
  const RGUARD = 'fable-lab/logs/calib4-synthetic-CAL-001-discovery-guard.log'
  copyFileSync(RLOG, RGUARD)
  let rguardOk = false
  try {
    execFileSync(
      'npx',
      ['tsx', 'fable-lab/tools/calib4.ts', RGUARD, '--expect-totals', '480,240', '--outcomes', ROUT],
      { encoding: 'utf8' },
    )
  } catch (err: any) {
    rguardOk = String(err.stderr).includes(
      'REFUSED: --expect-totals is the reserve mode and cannot run on the CAL-001 discovery log',
    )
  }
  console.log(`${rguardOk ? 'PASS' : 'FAIL'}  reserve-guard refusal on CAL-001-discovery path`)
  if (!rguardOk) fails++
  unlinkSync(RGUARD)
}

// --- Guard: --outcomes refused when the log path lacks "synthetic". ---
const GUARD = 'fable-lab/logs/calib4-guardtest.log'
copyFileSync(LOG, GUARD)
let guardOk = false
try {
  execFileSync('npx', ['tsx', 'fable-lab/tools/calib4.ts', GUARD, '--outcomes', OUTCOMES], { encoding: 'utf8' })
} catch (err: any) {
  guardOk = String(err.stderr).includes('REFUSED: --outcomes is only for synthetic fixtures')
}
console.log(`${guardOk ? 'PASS' : 'FAIL'}  outcomes-guard refusal`)
if (!guardOk) fails++
unlinkSync(GUARD)

// --- Gate-abort 1: join-direction winRate arm (UP tail mostly losing). ---
{
  const variant = { ...JSON.parse(readFileSync(OUTCOMES, 'utf8')) } as Record<string, string>
  for (let i = 0; i < 40; i++) variant[`synth-g${String(i + 1).padStart(3, '0')}`] = i < 10 ? '0' : '1'
  const V = 'fable-lab/logs/calib4-synthetic-outcomes-joinfail.json'
  writeFileSync(V, JSON.stringify(variant))
  let ok = false
  try {
    execFileSync('npx', ['tsx', 'fable-lab/tools/calib4.ts', LOG, '--outcomes', V], { encoding: 'utf8' })
  } catch (err: any) {
    ok =
      err.status === 2 &&
      String(err.stderr).includes('ABORT — join-direction gate failed (UP)') &&
      !String(err.stdout).includes('CAL-004 UP-side cell table')
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  join-direction gate abort (exit 2, no table)`)
  if (!ok) fails++
}

// --- Gate-abort 1b: join-direction n<30 arm (only 20 tail markets
// resolved, 19 wins → winRate 0.95 > 0.9, so only the n clause can fire).
{
  const variant = { ...JSON.parse(readFileSync(OUTCOMES, 'utf8')) } as Record<string, string>
  for (let i = 20; i < 40; i++) delete variant[`synth-g${String(i + 1).padStart(3, '0')}`]
  for (let i = 0; i < 20; i++) variant[`synth-g${String(i + 1).padStart(3, '0')}`] = i < 19 ? '0' : '1'
  const V = 'fable-lab/logs/calib4-synthetic-outcomes-lowN.json'
  writeFileSync(V, JSON.stringify(variant))
  let ok = false
  try {
    execFileSync('npx', ['tsx', 'fable-lab/tools/calib4.ts', LOG, '--outcomes', V], { encoding: 'utf8' })
  } catch (err: any) {
    ok =
      err.status === 2 &&
      String(err.stderr).includes('ABORT — join-direction gate failed (UP)') &&
      String(err.stderr).includes('n=20 winRate=0.9500') &&
      !String(err.stdout).includes('CAL-004 UP-side cell table')
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  join-direction gate n<30 arm abort (exit 2, no table)`)
  if (!ok) fails++
}

// --- Gate-abort 2: E14 positive-control failure (200 all-winning UP
// entries at (850s,[0.90,0.98)) → d=+0.10, se=sqrt(200·0.09)/200=0.0212,
// z=+4.71 ≥ 3.75). ---
{
  const extra: string[] = []
  const variantOutcomes = { ...JSON.parse(readFileSync(OUTCOMES, 'utf8')) } as Record<string, string>
  for (let i = 0; i < 200; i++) {
    const slug = `synth-p${String(i + 1).padStart(3, '0')}`
    extra.push(line(slug, 1766500000 + i * 900, 'UP', 850, 850, 0.88, 0.9))
    variantOutcomes[slug] = '0'
  }
  const VL = 'fable-lab/logs/calib4-synthetic-e14fail.log'
  const VO = 'fable-lab/logs/calib4-synthetic-outcomes-e14fail.json'
  writeFileSync(VL, lines.join('\n') + '\n' + extra.join('\n') + '\n')
  writeFileSync(VO, JSON.stringify(variantOutcomes))
  let ok = false
  try {
    execFileSync('npx', ['tsx', 'fable-lab/tools/calib4.ts', VL, '--outcomes', VO], { encoding: 'utf8' })
  } catch (err: any) {
    ok =
      err.status === 2 &&
      String(err.stderr).includes('ABORT — E14 positive-control gate failed (UP)') &&
      !String(err.stdout).includes('CAL-004 UP-side cell table')
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  E14 positive-control gate abort (exit 2, no table)`)
  if (!ok) fails++
}

if (fails > 0) {
  console.error(`SELFTEST FAILED: ${fails} assertion(s)`)
  process.exit(1)
}
console.log('SELFTEST OK')
