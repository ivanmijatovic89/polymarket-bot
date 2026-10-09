import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { ORACLE_ENV_KEYS, REPO_ROOT } from './cell.js'
import {
  ENGINE_PATHS_FILE,
  ORACLE_ALLOWLIST_FILE,
  ORACLE_ENV_ALLOWLIST_FILE,
  auditEnvReads,
  isAllowlisted,
  listSourceFiles,
  parseEnginePaths,
  parseEnvAllowlist,
  parseOracleAllowlist,
  scanEnvReads,
} from './oracle.js'

describe('engine paths and oracle allowlist (60 OR-2, OR-3)', () => {
  it('engine-paths.txt lists the OR-2 engine paths and an input-format section', () => {
    // spec: 60 OR-2
    const p = parseEnginePaths(readFileSync(ENGINE_PATHS_FILE, 'utf8'))
    assert.deepEqual(p.engine, [
      'src/trading',
      'src/strategy',
      'src/market',
      'src/backtest',
      'src/parquet',
      'src/polymarket/upDownSlugWindow.ts',
      'src/polymarket/gammaMarketMeta.ts',
    ])
    assert.ok(p.inputFormat.some((x) => x.startsWith('src/telonex/')))
    assert.throws(() => parseEnginePaths('src/x\n'), /outside a section/)
    assert.throws(() => parseEnginePaths('[other]\n'), /unknown section/)
  })

  it('the allowlist holds the parity tooling, the artifact kind and the simulator guard (OR-3)', () => {
    // spec: 60 OR-3
    const a = parseOracleAllowlist(readFileSync(ORACLE_ALLOWLIST_FILE, 'utf8'))
    assert.ok(isAllowlisted('src/backtest/parity/diff.ts', a))
    assert.ok(isAllowlisted('src/strategy/artifacts/types.ts', a))
    assert.ok(isAllowlisted('src/backtest/simulator/resolveMarket.ts', a))
    assert.equal(isAllowlisted('src/trading/OrderManager.ts', a), false)
    assert.equal(isAllowlisted('src/backtest/paritything.ts', a), false)
  })
})

describe('oracle env audit (60 OR-7)', () => {
  it('finds literal, bracket and helper env reads, and dynamic access', () => {
    const text = [
      'const a = process.env.FOO',
      "const b = process.env['BAR']",
      "const c = envInt('BAZ_MS', 3)",
      'const d = process.env[name]',
      '// process.env.COMMENTED',
      ' * process.env.DOC',
    ].join('\n')
    const reads = scanEnvReads('f.ts', text)
    assert.deepEqual(
      reads.map((r) => [r.line, r.name]),
      [
        [1, 'FOO'],
        [2, 'BAR'],
        [3, 'BAZ_MS'],
        [4, null],
      ],
    )
  })

  it('flags reads that are neither knobs nor allowlisted, and dynamic reads outside allowlisted helpers', () => {
    const allow = parseEnvAllowlist('var NEUTRAL  # reason\ndynamic helper.ts  # helper\n')
    const reads = [
      ...scanEnvReads(
        'a.ts',
        'process.env.KNOB\nprocess.env.NEUTRAL\nprocess.env.NEW_KNOB\nprocess.env[x]',
      ),
      ...scanEnvReads('helper.ts', 'process.env[name]'),
    ]
    const res = auditEnvReads(reads, ['KNOB'], allow)
    assert.deepEqual(
      res.violations.map((v) => `${v.file}:${v.line}:${v.name}`),
      ['a.ts:3:NEW_KNOB', 'a.ts:4:null'],
    )
    assert.throws(() => parseEnvAllowlist('var X\n'), /reason/)
  })

  it('the engine paths of this checkout pass the audit (every read is an OR-7 knob or allowlisted)', () => {
    // spec: 60 OR-7 (`npm run native:oracle:env-audit`)
    const p = parseEnginePaths(readFileSync(ENGINE_PATHS_FILE, 'utf8'))
    const files = listSourceFiles([...p.engine, ...p.inputFormat])
    assert.ok(files.length > 50)
    const reads = files.flatMap((f) =>
      scanEnvReads(f, readFileSync(path.join(REPO_ROOT, f), 'utf8')),
    )
    const allow = parseEnvAllowlist(readFileSync(ORACLE_ENV_ALLOWLIST_FILE, 'utf8'))
    const res = auditEnvReads(reads, ORACLE_ENV_KEYS, allow)
    assert.deepEqual(res.violations, [])
    // the OR-7 table knobs are really read under the engine paths
    for (const k of [
      'MAX_EVENTS_PER_DRAIN',
      'BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS',
      'BACKTEST_PRICE_TO_BEAT_LATENCY_MS',
    ])
      assert.ok(
        reads.some((r) => r.name === k),
        k,
      )
  })
})
