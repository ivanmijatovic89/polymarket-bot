/**
 * signal2-selftest.ts — committed selftest for tools/signal2.ts
 * (SIGNAL-CROSS-EPISODE.md freeze, session 60). Builds synthetic shard
 * logs + outcome JSONs under fable-lab/logs/ (paths contain "synthetic"),
 * runs signal2.ts as a child process, and asserts against HAND-COMPUTED
 * values (whole-line anchored where the line is deterministic — U47b
 * precedent). Covers:
 *   A. tiny hand-computed case: prevAgree assignment, streak buckets
 *      (+1/+2/+3p/−1 and indeterminable), pooled contrast arithmetic
 *   B. planted conditional signal: persistent outcomes at flat asks →
 *      family-1 CANDIDATE both sides with correct signs
 *   C. flipped-join abort (G1 exit 2)
 *   D. chain-coverage abort (G3 exit 2)
 *   E. --outcomes refusal on non-synthetic paths (exit 1)
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const logsDir = join(here, '..', 'logs', 'signal2-selftest')
mkdirSync(logsDir, { recursive: true })
const TOOL = join(here, 'signal2.ts')

let pass = 0
let fail = 0
function assert(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`PASS ${name}`) }
  else { fail++; console.error(`FAIL ${name}`) }
}

const FEATTAIL =
  'l1Imb=0.5 l5Imb=0.5 l10Imb=0.5 dTot5=100 dTot10=200 nTicks=10 rate60=1 vol=0.01 ' +
  'nz=5 flips=2 range=0.02 posR=0.5 move60=0 firstMid=0.5 firstTs=1 crossedN=0'

function line(epoch: number, off: number, upAsk: number, dnAsk: number, ts?: number): string {
  const upBid = (upAsk - 0.01).toFixed(4)
  const dnBid = (dnAsk - 0.01).toFixed(4)
  return (
    `[diag-signal] slug=btc-updown-15m-${epoch} epoch=${epoch} off=${off} ts=${(ts ?? off).toFixed(1)} ` +
    `upBid=${upBid} upAsk=${upAsk.toFixed(4)} dnBid=${dnBid} dnAsk=${dnAsk.toFixed(4)} ${FEATTAIL}`
  )
}

function run(logPath: string, outcomesPath: string): { out: string; code: number } {
  const res = spawnSync('npx', ['tsx', TOOL, logPath, '--outcomes', outcomesPath], {
    cwd: join(here, '..', '..'),
    encoding: 'utf8',
    timeout: 120_000,
  })
  return { out: `${res.stdout}\n${res.stderr}`, code: res.status ?? -1 }
}

// ---------------------------------------------------------------
// A. tiny hand-computed case (single offset 300, UP side focus)
//
// Chain (epoch steps of 900): outcomes by epoch
//   e0=10000*900? use epochs 9000000, 9000900, ... to keep slug arithmetic simple.
// Markets emitting samples: E3..E6. Predecessors E0..E5 as needed.
//   epochs:   E0=9000000 E1=9000900 E2=9001800 E3=9002700 E4=9003600
//             E5=9004500 E6=9005400
//   outcomes: E0=UP E1=UP E2=UP E3=UP E4=DOWN E5=UP E6=UP
//
// Sampled markets (off=300, upAsk=0.50, dnAsk=0.51):
//   E3: lags E2,E1,E0 = UP,UP,UP  → UP-side: agree=1, run=3 → +3p ; won(UP@E3)=1 → r=+0.50
//   E4: lags E3,E2,E1 = UP,UP,UP  → UP-side: agree=1, +3p ; won=0 → r=−0.50
//   E5: lags E4,E3,E2 = DOWN,UP,… → UP-side: agree=0, run(DOWN)=1 → −1 ; won=1 → r=+0.50
//   E6: lags E5,E4,E3 = UP,DOWN,… → UP-side: agree=1, run(UP)=1 → +1 ; won=1 → r=+0.50
// UP pooled contrast: agree arm {+0.5,−0.5,+0.5} mean=1/6, disagree arm {+0.5} n=1
//   → arms below MIN_ARM_N ⇒ "o300 UP: n<min — na" (asserted). The
//   arithmetic itself is asserted in B where arms are large.
// Streak accounting asserted via the coverage line:
//   E3,E4,E5,E6 all have determinable lag-1 and runLen ⇒ 8 samples
//   (2 sides × 4 markets), lag1=8/8, streak=8/8.
// Plus one indeterminable market E7=9006300 with missing lag-1 (E6 present
// — make lag-1 missing by using epoch 9008100 whose lag-1 9007200 is
// absent): agree=null, bucket=null → lag1 coverage 8/10 = 0.8 < 0.95
// ⇒ G3 abort. So case A runs TWICE: A1 without the orphan (gates pass),
// A2 with it (G3 exit 2 — that doubles as test D).
// ---------------------------------------------------------------
{
  const E = (k: number): number => 9000000 + 900 * k
  const outcomes: Record<string, string> = {}
  const dir: Record<number, '0' | '1'> = { 0: '0', 1: '0', 2: '0', 3: '0', 4: '1', 5: '0', 6: '0' }
  for (const [k, v] of Object.entries(dir)) outcomes[`btc-updown-15m-${E(Number(k))}`] = v
  const lines = [3, 4, 5, 6].map((k) => line(E(k), 300, 0.5, 0.51))
  const logA1 = join(logsDir, 'synthetic-a1.log')
  const outA = join(logsDir, 'synthetic-a1-outcomes.json')
  writeFileSync(logA1, `${lines.join('\n')}\n`)
  writeFileSync(outA, JSON.stringify(outcomes))
  const { out, code } = run(logA1, outA)
  assert('A1 exit 0', code === 0)
  assert('A1 parse line', out.includes('parsed 4 deduped (slug,off) rows across 4 markets (0 malformed, 0 drift-discarded)'))
  assert('A1 coverage line', out.includes('samples valid=8 (unresolved-current rows=0, ask-out-of-range=0); lag1-determinable=8 (1.0000), streak-determinable=8 (1.0000)'))
  assert('A1 G1 not evaluable (no high asks)', out.includes('G1 join-direction UP: n=0 < 30'))
  // G2 UP: residuals {+.5,−.5,+.5,+.5} mean=0.25 sd: deviations {.25,−.75,.25,.25}
  //   m2=0.0625*3+0.5625=0.75 → sd=√(0.75/3)=0.5 → z=0.25/(0.5/2)=1.00
  assert('A1 G2 UP hand-computed', out.includes('G2 global fairness UP: n=4 mean=0.25000 z=1.00'))
  // DOWN mirrors with ask 0.51: residuals {−.51,+.49,−.51,−.51} mean=−0.26, sd=0.5 → z=−1.04
  assert('A1 G2 DOWN hand-computed', out.includes('G2 global fairness DOWN: n=4 mean=-0.26000 z=-1.04'))
  assert('A1 pooled contrast na (arms < 30)', out.includes('o300 UP: n<min — na'))
  // streak buckets: UP side E3→+3p E4→+3p E5→−1 E6→+1 ⇒ counts +3p:2, −1:1, +1:1 (all < 30 ⇒ na with n printed)
  assert('A1 streak +3p count', out.includes('o300 UP +3p: n=2 — na'))
  assert('A1 streak +1 count', out.includes('o300 UP +1: n=1 — na'))
  assert('A1 streak -1 count', out.includes('o300 UP -1: n=1 — na'))
  // DOWN side signs flip: E3,E4 → −3p; E5 → +1; E6 → −1
  assert('A1 streak DOWN -3p count', out.includes('o300 DOWN -3p: n=2 — na'))
  assert('A1 zero candidates', out.includes('SUMMARY: candidates f1=0 f2=0 f3=0'))
}

// D (= A2). Add an orphan market whose lag-1 is absent → lag-1 coverage
// 8/10 = 0.80 < 0.95 → G3 exit 2.
{
  const E = (k: number): number => 9000000 + 900 * k
  const outcomes: Record<string, string> = {}
  const dir: Record<number, '0' | '1'> = { 0: '0', 1: '0', 2: '0', 3: '0', 4: '1', 5: '0', 6: '0' }
  for (const [k, v] of Object.entries(dir)) outcomes[`btc-updown-15m-${E(Number(k))}`] = v
  const orphan = E(9) // lag-1 = E(8) absent from outcomes
  outcomes[`btc-updown-15m-${orphan}`] = '0'
  const lines = [3, 4, 5, 6].map((k) => line(E(k), 300, 0.5, 0.51))
  lines.push(line(orphan, 300, 0.5, 0.51))
  const logD = join(logsDir, 'synthetic-d.log')
  const outD = join(logsDir, 'synthetic-d-outcomes.json')
  writeFileSync(logD, `${lines.join('\n')}\n`)
  writeFileSync(outD, JSON.stringify(outcomes))
  const { out, code } = run(logD, outD)
  assert('D G3 abort exit 2', code === 2)
  assert('D G3 message', out.includes('GATE G3 FAILED: lag-1 chain coverage 0.8000'))
}

// ---------------------------------------------------------------
// B. planted conditional signal. 1,000 consecutive markets, outcomes
// alternate in blocks so that the outcome ALWAYS repeats the previous
// one except every 10th market (persistence 90%). Asks flat 0.50/0.51.
// Expected: buying the side that agrees with lag-1 wins ~90% → residual
// +0.4 vs −0.4 for disagree → pooled contrast hugely positive on UP and
// DOWN alike → family-1 CANDIDATE (+ sign) both sides. Also G1 needs
// high-ask samples: append 40 markets sampled at upAsk=0.95 whose
// outcome is UP (winners) so G1 UP evaluates and passes; their lag-1
// is present (chain kept intact).
// ---------------------------------------------------------------
{
  const E = (k: number): number => 8000000 + 900 * k
  const outcomes: Record<string, string> = {}
  const dirs: ('0' | '1')[] = []
  let cur: '0' | '1' = '0'
  for (let k = 0; k < 1000; k++) {
    if (k > 0 && k % 10 === 0) cur = cur === '0' ? '1' : '0'
    dirs.push(cur)
    outcomes[`btc-updown-15m-${E(k)}`] = cur
  }
  const lines: string[] = []
  for (let k = 3; k < 1000; k++) lines.push(line(E(k), 300, 0.5, 0.51))
  // G1 block: 40 UP-winning markets at high ask, chained after the block
  for (let k = 1000; k < 1040; k++) {
    outcomes[`btc-updown-15m-${E(k)}`] = '0'
    lines.push(line(E(k), 300, 0.95, 0.06))
  }
  const logB = join(logsDir, 'synthetic-b.log')
  const outB = join(logsDir, 'synthetic-b-outcomes.json')
  writeFileSync(logB, `${lines.join('\n')}\n`)
  writeFileSync(outB, JSON.stringify(outcomes))
  const { out, code } = run(logB, outB)
  assert('B exit 0', code === 0)
  assert('B G1 UP evaluated and passed', /G1 join-direction UP: n=40 winRate=1\.0000/.test(out))
  const f1up = /o300 UP: d=([\d.-]+) z=([\d.-]+) n1=\d+ n0=\d+ {2}<< CANDIDATE/.exec(out)
  const f1dn = /o300 DOWN: d=([\d.-]+) z=([\d.-]+) n1=\d+ n0=\d+ {2}<< CANDIDATE/.exec(out)
  assert('B family1 UP candidate with + sign', f1up !== null && Number(f1up[1]) > 0.5)
  assert('B family1 DOWN candidate with + sign', f1dn !== null && Number(f1dn[1]) > 0.5)
  const sm = /SUMMARY: candidates f1=(\d+) f2=(\d+) f3=(\d+)/.exec(out)
  assert('B summary parses', sm !== null)
  assert('B f1 has 2 candidates', sm !== null && sm[1] === '2')
  // streak +3p (long agree runs) must also be strongly positive → f3 > 0
  assert('B f3 nonzero (streak echoes)', sm !== null && Number(sm[3]) > 0)
}

// C. flipped join: same planted log, outcomes inverted → the 40 high-ask
// UP samples now all LOSE → G1 winRate 0 → exit 2.
{
  const E = (k: number): number => 8000000 + 900 * k
  const flippedPath = join(logsDir, 'synthetic-b-outcomes-flipped.json')
  const orig = JSON.parse(
    execFileSync('cat', [join(logsDir, 'synthetic-b-outcomes.json')], { encoding: 'utf8' }),
  ) as Record<string, string>
  const flipped: Record<string, string> = {}
  for (const [k, v] of Object.entries(orig)) flipped[k] = v === '0' ? '1' : '0'
  writeFileSync(flippedPath, JSON.stringify(flipped))
  const { out, code } = run(join(logsDir, 'synthetic-b.log'), flippedPath)
  assert('C flipped join exit 2', code === 2)
  assert('C G1 failure message', out.includes('GATE G1 FAILED (UP): flipped/broken outcome join'))
  void E
}

// E. refusal guard: non-synthetic log path with --outcomes → exit 1.
{
  const plain = join(logsDir, 'plain-a1.log')
  writeFileSync(plain, `${line(9000000, 300, 0.5, 0.51)}\n`)
  const { out, code } = run(plain, join(logsDir, 'synthetic-a1-outcomes.json'))
  assert('E refusal exit 1', code === 1)
  assert('E refusal message', out.includes('REFUSED: --outcomes is only for synthetic fixtures'))
}

console.log(`\n${pass} PASS, ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
