/**
 * spec-selftest.ts — mechanical validation of lib/spec.ts (the shared
 * experiment-spec parser) on SYNTHETIC fixtures with hand-computed
 * expectations.
 *
 * Usage: npx tsx fable-lab/tools/spec-selftest.ts
 *
 * Motivation (AUDIT-COVERAGE residue R5): spec.ts feeds the frozen-spec →
 * command path (validate-experiment.ts + submit.ts) — a parsing defect
 * there silently changes what a "frozen" spec executes as. It already had
 * one real bug of exactly this kind (U10: `$` under the `m` flag truncated
 * wrapped fields, so only 2 of 4 --param pairs reached the command). That
 * bug's fixtures lived in the session, not in a committed test; this pins
 * the contract:
 *
 *   - field() wrapping: values continue across indented lines and stop at
 *     the next `- **` field, at `## `, or at TRUE end-of-input (the U10
 *     regression case), with whitespace collapsed
 *   - parseSpecFile extraction: expId/title (em-dash form), Registered,
 *     lineage_cells via numOrNull, mechanism class, hypothesis/prediction,
 *     strategy path + id from backticks, ALL --param pairs (order
 *     preserved), holdout boundary AND end from the Holdout clause,
 *     placeholder scan (<...>/EXP-NNN/NNN, deduped, spec section only —
 *     tokens after `## Runs` are NOT placeholders)
 *   - fallback arms: missing title/fields → null, no placeholders → []
 *   - resolveSpecPath: passthrough for existing paths, EXP-prefix lookup
 *     in the real registry, throw on unresolvable ids
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSpecFile, resolveSpecPath, specBasename } from './lib/spec.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASE = join(HERE, '..', 'logs', 'spec-selftest')
rmSync(BASE, { recursive: true, force: true })
mkdirSync(BASE, { recursive: true })

let fails = 0
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — got ${a}, want ${e}`}`)
}

// ---------- fixture 1: full spec, every extracted field populated ----------
const FULL = join(BASE, 'EXP-201-full.md')
writeFileSync(
  FULL,
  [
    '# EXP-201 — spec parser fixture',
    '',
    '- **Registered:** 2026-07-11 (U75 fixture)',
    '- **lineage_cells:** 3 cells',
    '- **Mechanism class:** `fixture-mech`',
    '- **Hypothesis (who loses and why):** first line',
    '  wrapped second line',
    '- **Falsifiable prediction:** win rate > mean ask',
    '- **Strategy:** `fable-lab/strategies/x/EXP-201.ts` id `fable-exp-201`',
    '- **Primary parameter cell:** `--param a=1 --param b=[0.1,0.2]',
    '  --param c=x --param d=4`',
    '- **Simulator-bias exposure (CAPABILITIES §4):** none',
    '- **Decision rules:** Holdout: `market_start_ms` >= 1777237200000 and <= 1780000000000',
    '- placeholders here: <fill-me> then EXP-NNN then NNN then <fill-me> again',
    '',
    '## Runs',
    '',
    '<not-a-placeholder> — tokens after "## Runs" must not be scanned',
  ].join('\n') + '\n',
)
const full = parseSpecFile(FULL)
check('expId', full.expId, 'EXP-201')
check('title', full.title, 'spec parser fixture')
check('registered', full.registered, '2026-07-11 (U75 fixture)')
check('lineage_cells: first number of "3 cells"', full.lineageCells, 3)
check('mechanism class (backticks verbatim)', full.mechanismClass, '`fixture-mech`')
check(
  'wrapped field continues + whitespace collapsed (U10 class)',
  full.hypothesis,
  'first line wrapped second line',
)
check('prediction', full.prediction, 'win rate > mean ask')
check('strategy path (first backticked .ts)', full.strategyPath, 'fable-lab/strategies/x/EXP-201.ts')
check('strategy id', full.strategyId, 'fable-exp-201')
check(
  'ALL 4 --param pairs across the wrap, order preserved (U10 regression)',
  full.primaryParams,
  ['a=1', 'b=[0.1,0.2]', 'c=x', 'd=4'],
)
check('holdout boundary', full.holdoutBoundaryMs, 1777237200000)
check('holdout end', full.holdoutEndMs, 1780000000000)
check(
  'placeholders: deduped, EXP-NNN absorbs its NNN, post-"## Runs" excluded',
  full.unresolvedPlaceholders,
  ['<fill-me>', 'EXP-NNN', 'NNN'],
)
check('specBasename', specBasename(full), 'EXP-201-full.md')

// ---------- fixture 2: EOF-terminated wrapped field (the exact U10 bug) ----
// The pre-U10 regex ended the lazy match at the FIRST line end (`$` under
// `m`), so only the params on the label line survived. The fix requires the
// value to run to true end-of-input when no next field/section follows.
const EOFFIX = join(BASE, 'EXP-202-eof.md')
writeFileSync(
  EOFFIX,
  '# EXP-202 — eof fixture\n- **Primary parameter cell:** `--param a=1\n  --param b=2 --param c=3 --param d=4`',
)
const eoffix = parseSpecFile(EOFFIX)
check('EOF-terminated wrap keeps all 4 params (U10 bug pinned)', eoffix.primaryParams, [
  'a=1',
  'b=2',
  'c=3',
  'd=4',
])

// ---------- fixture 3: fallback arms ----------
const BARE = join(BASE, 'EXP-203-bare.md')
writeFileSync(BARE, '# EXP-203 bare fixture without em-dash\nno fields at all\n')
const bare = parseSpecFile(BARE)
check('no em-dash title → expId null', bare.expId, null)
check('title null', bare.title, null)
check('missing field → null', bare.mechanismClass, null)
check('missing lineage → null', bare.lineageCells, null)
check('no strategy → null path', bare.strategyPath, null)
check('no params → []', bare.primaryParams, [])
check('no holdout clause → null', bare.holdoutBoundaryMs, null)
check('no placeholders → []', bare.unresolvedPlaceholders, [])

// ---------- resolveSpecPath arms ----------
check('existing path passthrough', resolveSpecPath(FULL), FULL)
let resolved = ''
try {
  resolved = basename(resolveSpecPath('EXP-001'))
} catch {
  resolved = 'THREW'
}
check('EXP-prefix lookup hits the real registry', resolved.startsWith('EXP-001'), true)
let threw = false
try {
  resolveSpecPath('EXP-999')
} catch {
  threw = true
}
check('unresolvable id throws', threw, true)

if (fails > 0) {
  console.error(`SELFTEST FAILED: ${fails} assertion(s)`)
  process.exit(1)
}
console.log('spec selftest: all assertions pass')
