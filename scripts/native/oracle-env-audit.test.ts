/**
 * Extractor tests for scripts/native/oracle-env-audit.ts (60 §2.3 OR-7).
 * Run: npx tsx --test scripts/native/oracle-env-audit.test.ts
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { audit, extractEnvReads, parseAllowlist, parseEnginePathsFile } from './oracle-env-audit.js'

const names = (src: string) => extractEnvReads(src, 'x.ts').reads.map((r) => r.name)

describe('extractEnvReads', () => {
  it('finds dot, optional-chain and bracket-literal reads with their lines', () => {
    const src = [
      "const a = process.env.ALPHA ?? '1'",
      'const b = process.env?.BETA',
      "const c = process.env['GAMMA']",
      'const d = process.env[`DELTA`]',
      "const e = process['env'].EPSILON",
      'const f = globalThis.process.env.ZETA',
      'const g = (process.env as Record<string, string>).ETA!',
    ].join('\n')
    const res = extractEnvReads(src, 'x.ts')
    assert.deepEqual(
      res.reads.map((r) => [r.name, r.line, r.kind]),
      [
        ['ALPHA', 1, 'property'],
        ['BETA', 2, 'property'],
        ['GAMMA', 3, 'element'],
        ['DELTA', 4, 'element'],
        ['EPSILON', 5, 'property'],
        ['ZETA', 6, 'property'],
        ['ETA', 7, 'property'],
      ],
    )
    assert.deepEqual(res.opaque, [])
  })

  it('finds destructured names (renamed, defaulted, quoted keys)', () => {
    const src = "const { A, B: b, C = 'x', 'D-E': de } = process.env"
    assert.deepEqual(names(src), ['A', 'B', 'C', 'D-E'])
  })

  it('flags a rest binding as opaque', () => {
    const res = extractEnvReads('const { A, ...rest } = process.env', 'x.ts')
    assert.deepEqual(
      res.reads.map((r) => r.name),
      ['A'],
    )
    assert.equal(res.opaque.length, 1)
    assert.match(res.opaque[0].reason, /rest binding/)
  })

  it('follows aliases of process.env', () => {
    const src = [
      'const env = process.env',
      'const x = env.ALIASED',
      "const y = env['QUOTED']",
      'const { DESTR } = env',
      'function f(o: { env: string }) { return o.env }',
    ].join('\n')
    const res = extractEnvReads(src, 'x.ts')
    assert.deepEqual(
      res.reads.map((r) => r.name),
      ['ALIASED', 'QUOTED', 'DESTR'],
    )
    assert.deepEqual(res.opaque, [])
  })

  it('handles `in` checks', () => {
    assert.deepEqual(names("if ('HAS_IT' in process.env) {}"), ['HAS_IT'])
  })

  it('resolves helper call sites for process.env[param] (function and arrow helpers)', () => {
    const src = [
      'function envInt(name: string, fallback: number): number {',
      '  const raw = process.env[name]?.trim()',
      '  return raw ? Number(raw) : fallback',
      '}',
      'const a = envInt("ONE", 1)',
      'const num = (fallback: number, key: string) => Number(process.env[key] ?? fallback)',
      "const b = num(2, 'TWO')",
    ].join('\n')
    const res = extractEnvReads(src, 'x.ts')
    assert.deepEqual(
      res.reads.map((r) => [r.name, r.line, r.kind, r.via]),
      [
        ['ONE', 5, 'helper-call', 'envInt'],
        ['TWO', 7, 'helper-call', 'num'],
      ],
    )
    assert.deepEqual(res.opaque, [])
  })

  it('follows helper chains and flags non-literal helper arguments', () => {
    const src = [
      'function envInt(name: string) { return Number(process.env[name]) }',
      'function latency(knob: string) { return envInt(knob) }',
      "latency('CHAINED')",
      'const k = pick()',
      'envInt(k)',
    ].join('\n')
    const res = extractEnvReads(src, 'x.ts')
    assert.deepEqual(
      res.reads.map((r) => r.name),
      ['CHAINED'],
    )
    assert.equal(res.opaque.length, 1)
    assert.equal(res.opaque[0].line, 5)
    assert.match(res.opaque[0].reason, /non-literal/)
  })

  it('flags exported helpers (cross-file calls are not resolved)', () => {
    const src = [
      'export function readKnob(name: string) { return process.env[name] }',
      "readKnob('LOCAL')",
    ].join('\n')
    const res = extractEnvReads(src, 'x.ts')
    assert.deepEqual(
      res.reads.map((r) => r.name),
      ['LOCAL'],
    )
    assert.equal(res.opaque.length, 1)
    assert.match(res.opaque[0].reason, /exported env helper `readKnob`/)
  })

  it('flags unresolvable dynamic keys and whole-object uses', () => {
    const src = [
      "for (const k of ['A', 'B']) console.log(process.env[k])",
      'spawn(cmd, { env: process.env })',
      'const copy = { ...process.env }',
      'Object.keys(process.env)',
    ].join('\n')
    const res = extractEnvReads(src, 'x.ts')
    assert.deepEqual(res.reads, [])
    assert.deepEqual(
      res.opaque.map((o) => o.line),
      [1, 2, 3, 4],
    )
  })

  it('ignores strings and comments that mention process.env', () => {
    const src = [
      '// process.env.IN_COMMENT',
      "const s = 'process.env.IN_STRING'",
      '/** process.env.IN_JSDOC */',
      'const t = `process.env.IN_TEMPLATE`',
    ].join('\n')
    const res = extractEnvReads(src, 'x.ts')
    assert.deepEqual(res.reads, [])
    assert.deepEqual(res.opaque, [])
  })

  it('parses JavaScript files', () => {
    assert.deepEqual(
      extractEnvReads('const x = process.env.JS_VAR', 'x.mjs').reads.map((r) => r.name),
      ['JS_VAR'],
    )
  })
})

describe('parseEnginePathsFile', () => {
  it('keeps the engine section and stops at the input-format section', () => {
    const text = [
      '# Engine-semantics paths (60 OR-2)',
      'src/trading/',
      'src/market  # book engine',
      '',
      '- src/polymarket/upDownSlugWindow.ts',
      '# Input-format paths',
      'src/telonex/',
    ].join('\n')
    assert.deepEqual(parseEnginePathsFile(text), [
      'src/trading',
      'src/market',
      'src/polymarket/upDownSlugWindow.ts',
    ])
    assert.deepEqual(parseEnginePathsFile('[engine]\nsrc/a\n[input-format]\nsrc/b\n'), ['src/a'])
  })
})

describe('parseAllowlist', () => {
  it('requires a reason and rejects duplicates', () => {
    assert.deepEqual(parseAllowlist('# header\nFOO  # because\n\n'), [
      { name: 'FOO', reason: 'because', line: 2 },
    ])
    assert.throws(() => parseAllowlist('FOO\n'), /expected "NAME  # reason"/)
    assert.throws(() => parseAllowlist('FOO # a\nFOO # b\n'), /duplicate entry FOO/)
  })
})

describe('audit', () => {
  const makeRepo = (files: Record<string, string>) => {
    const root = mkdtempSync(path.join(tmpdir(), 'env-audit-'))
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
      writeFileSync(path.join(root, rel), text)
    }
    return root
  }

  it('passes when every read is pinned or allowlisted, and skips tests and input-format paths', () => {
    const root = makeRepo({
      'native/parity/engine-paths.txt': 'src/engine\n# input-format paths\nsrc/conv\n',
      'native/parity/oracle-env-allowlist.txt':
        'LIVE_ONLY  # never read in backtests\nGONE  # stale\n',
      'src/engine/a.ts':
        'const a = process.env.MAX_EVENTS_PER_DRAIN\nconst b = process.env.LIVE_ONLY\n',
      'src/engine/a.test.ts': 'process.env.TEST_ONLY',
      'src/conv/c.ts': 'process.env.CONVERTER_KNOB',
    })
    const r = audit(root)
    assert.equal(r.ok, true)
    assert.equal(r.filesScanned, 1)
    assert.deepEqual(
      r.variables.map((v) => [v.name, v.status]),
      [
        ['LIVE_ONLY', 'allowlisted'],
        ['MAX_EVENTS_PER_DRAIN', 'or7'],
      ],
    )
    assert.deepEqual(r.staleAllowlist, ['GONE'])
  })

  it('fails on an unlisted variable and on an allowlisted OR-7 knob', () => {
    const root = makeRepo({
      'native/parity/engine-paths.txt': 'src/engine\n',
      'native/parity/oracle-env-allowlist.txt': 'WEB_UI_ORDERBOOK_LEVELS  # wrong place\n',
      'src/engine/a.ts':
        'const x = process.env.NEW_KNOB\nconst y = process.env.WEB_UI_ORDERBOOK_LEVELS\n',
    })
    const r = audit(root)
    assert.equal(r.ok, false)
    assert.deepEqual(
      r.variables.filter((v) => v.status === 'unlisted').map((v) => [v.name, v.locations]),
      [['NEW_KNOB', ['src/engine/a.ts:1']]],
    )
    assert.deepEqual(r.allowlistOverlapsOr7, ['WEB_UI_ORDERBOOK_LEVELS'])
  })
})
