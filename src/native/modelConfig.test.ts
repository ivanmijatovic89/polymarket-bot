/**
 * ModelConfig resolution tests (21 §6.3, 13 §7.3-§7.4, D57, D58).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

import { modelConfigSha256 } from './contract/canonicalJson.js'
import { NativeError } from './errors.js'
import {
  CONTRACT_DIR,
  applyMergePatch,
  ignoredNativeEnvKnobs,
  isDecimalString,
  numberToDecimalString,
  resolveModelConfig,
  validateModelConfig,
} from './modelConfig.js'
import { tsCompatDefault } from './testSupport.js'

const NO_ENV = {}

function causeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    assert.ok(err instanceof NativeError, String(err))
    assert.equal(err.info.class, 'invalid_input')
    return err.info.cause
  }
  assert.fail('expected a NativeError')
}

describe('resolveModelConfig (21 §6.3)', () => {
  it('resolves the ts-compat defaults with the 0/20 compat fallback', () => {
    // spec: 21 §6.3 table (seed 0, capital 500, compatLatency 0/20); D58 (2)
    const r = resolveModelConfig({ inputMode: 'telonex-delta', flags: {}, env: NO_ENV })
    const want = tsCompatDefault()
    want.execution.compatLatency = { delayMs: 0, jitterMs: 20 }
    assert.deepEqual(r.modelConfig, want)
    assert.equal(r.modelConfigSha256, modelConfigSha256(want))
    assert.deepEqual(r.compatLatencySource, { delayMs: 'default', jitterMs: 'default' })
    assert.deepEqual(
      r.sources.map((s) => s.path),
      ['native/contract/defaults/model-config-v1.json'],
    )
    assert.match(r.sources[0]!.sha256, /^[0-9a-f]{64}$/)
    assert.deepEqual(r.warnings, [])
  })

  it('reproduces the committed ts-compat default and its pinned hash with 0/0 flags', () => {
    // spec: 21 §3 CI item 6, D57, D58 (1)
    const r = resolveModelConfig({
      inputMode: 'telonex-delta',
      flags: { latencyDelayMs: 0, latencyJitterMs: 0 },
      env: NO_ENV,
    })
    assert.deepEqual(r.modelConfig, tsCompatDefault())
    const hashes = JSON.parse(
      readFileSync(path.join(CONTRACT_DIR, 'fixtures', 'hashes.json'), 'utf8'),
    ) as { modelConfigSha256: Record<string, string> }
    assert.equal(r.modelConfigSha256, hashes.modelConfigSha256['ts-compat-default.json'])
  })

  it('takes compatLatency from flags, then the producer env, then the fallback', () => {
    // spec: 21 §6.3 execution.compatLatency row; 20 §5.6
    const env = { BACKTEST_LATENCY_DELAY: '140', BACKTEST_LATENCY_JITTER: '5' }
    const fromEnv = resolveModelConfig({ inputMode: 'telonex-delta', flags: {}, env })
    assert.deepEqual(fromEnv.modelConfig.execution.compatLatency, { delayMs: 140, jitterMs: 5 })
    assert.deepEqual(fromEnv.compatLatencySource, { delayMs: 'env', jitterMs: 'env' })
    const fromFlag = resolveModelConfig({
      inputMode: 'telonex-delta',
      flags: { latencyDelayMs: 90 },
      env,
    })
    assert.deepEqual(fromFlag.modelConfig.execution.compatLatency, { delayMs: 90, jitterMs: 5 })
    assert.deepEqual(fromFlag.compatLatencySource, { delayMs: 'flag', jitterMs: 'env' })
  })

  it('fails loud on an unparsable latency env value (R14)', () => {
    // spec: R14; 21 §6.3 (D-PENDING: TS silently falls back to 0)
    assert.equal(
      causeOf(() =>
        resolveModelConfig({
          inputMode: 'telonex-delta',
          flags: {},
          env: { BACKTEST_LATENCY_DELAY: 'abc' },
        }),
      ),
      'flag',
    )
    assert.equal(
      causeOf(() =>
        resolveModelConfig({
          inputMode: 'telonex-delta',
          flags: { latencyDelayMs: -1 },
          env: NO_ENV,
        }),
      ),
      'flag',
    )
  })

  it('parses --seed and --starting-capital into the 21 §6.1 representation', () => {
    // spec: 21 §6.2 seed in [0, 2^53 - 1]; 21 §6.1 decimal strings; §18 N4
    const r = resolveModelConfig({
      inputMode: 'telonex-delta',
      flags: { seed: '42', startingCapital: 250.5 },
      env: NO_ENV,
    })
    assert.equal(r.modelConfig.seed, 42)
    assert.equal(r.modelConfig.capital.startingCapitalUsdc, '250.5')
    const bad = (flags: Parameters<typeof resolveModelConfig>[0]['flags']) =>
      causeOf(() => resolveModelConfig({ inputMode: 'telonex-delta', flags, env: NO_ENV }))
    assert.equal(bad({ seed: -1 }), 'flag')
    assert.equal(bad({ seed: 2 ** 53 }), 'flag')
    assert.equal(bad({ seed: '1e3' }), 'flag')
    assert.equal(bad({ startingCapital: 0.1234567 }), 'flag')
    assert.equal(bad({ startingCapital: '0' }), 'flag')
    assert.equal(bad({ startingCapital: '-5' }), 'flag')
    assert.equal(bad({ startingCapital: '5.10' }), 'flag')
  })

  it('refuses realistic before M3b and unknown profiles', () => {
    // spec: D57 (realistic defaults land in M3b); 20 §5.6 --native-profile
    assert.equal(
      causeOf(() =>
        resolveModelConfig({
          profile: 'realistic',
          inputMode: 'telonex-delta',
          flags: {},
          env: NO_ENV,
        }),
      ),
      'profile',
    )
    assert.equal(
      causeOf(() =>
        resolveModelConfig({ profile: 'fast', inputMode: 'telonex-delta', flags: {}, env: NO_ENV }),
      ),
      'profile',
    )
  })

  it('applies --model-config-override last and keeps calibrations consistent', () => {
    // spec: 21 §6.3 (merge patch; modelConfigVersion/profile/seed only via flags; calibration ids)
    const base = { inputMode: 'telonex-delta' as const, flags: {}, env: NO_ENV }
    const r = resolveModelConfig({ ...base, overrides: { runner: { maxEventsPerDrain: 100 } } })
    assert.equal(r.modelConfig.runner.maxEventsPerDrain, 100)
    assert.equal(
      causeOf(() => resolveModelConfig({ ...base, overrides: { seed: 3 } })),
      'flag',
    )
    assert.equal(
      causeOf(() => resolveModelConfig({ ...base, overrides: { profile: 'realistic' } })),
      'flag',
    )
    const latency = { binance: { latency: { kind: 'constant', ms: 90 } } }
    assert.equal(
      causeOf(() => resolveModelConfig({ ...base, overrides: { feeds: latency } })),
      'model_config',
    )
    const custom = resolveModelConfig({
      ...base,
      overrides: { feeds: { ...latency, calibrationId: 'custom' } },
    })
    assert.deepEqual(custom.modelConfig.feeds.binance.latency, { kind: 'constant', ms: 90 })
  })

  it('rejects non-compat execution axes in ts-compat', () => {
    // spec: 13 §7.3 (ts-compat requires the compat values)
    assert.equal(
      causeOf(() =>
        resolveModelConfig({
          inputMode: 'telonex-delta',
          flags: {},
          env: NO_ENV,
          overrides: { execution: { models: { fee: 'schedule' } } },
        }),
      ),
      'model_config',
    )
  })

  it('checks the binary capabilities and picks its newest rules table', () => {
    // spec: 21 §6.3 rulesTableVersion row; 20 §3 modelConfigVersions; 11 VR3
    const base = { inputMode: 'telonex-delta' as const, flags: {}, env: NO_ENV }
    const r = resolveModelConfig({
      ...base,
      capabilities: { modelConfigVersions: [1], rulesTableVersions: ['rules-table-v1'] },
    })
    assert.equal(r.modelConfig.rules.rulesTableVersion, 'rules-table-v1')
    assert.equal(
      causeOf(() =>
        resolveModelConfig({
          ...base,
          capabilities: { modelConfigVersions: [2], rulesTableVersions: ['rules-table-v1'] },
        }),
      ),
      'version',
    )
    assert.equal(
      causeOf(() =>
        resolveModelConfig({
          ...base,
          capabilities: { modelConfigVersions: [1], rulesTableVersions: [] },
        }),
      ),
      'rules_table_version',
    )
  })

  it('warns once per ignored producer env knob', () => {
    // spec: 20 §5.6 "Every other BACKTEST_* knob, MAX_EVENTS_PER_DRAIN"
    const env = {
      BACKTEST_LATENCY_DELAY: '0',
      BACKTEST_PRICE_TO_BEAT_LATENCY_MS: '2000',
      MAX_EVENTS_PER_DRAIN: '10',
      PATH: '/bin',
    }
    assert.deepEqual(ignoredNativeEnvKnobs(env), [
      'BACKTEST_PRICE_TO_BEAT_LATENCY_MS',
      'MAX_EVENTS_PER_DRAIN',
    ])
    const r = resolveModelConfig({ inputMode: 'telonex-delta', flags: {}, env })
    assert.equal(r.warnings.length, 2)
    assert.match(r.warnings[0]!, /BACKTEST_PRICE_TO_BEAT_LATENCY_MS/)
  })
})

describe('ModelConfig validation and helpers (21 §6.1, §6.3)', () => {
  it('accepts the committed parity cell configs and rejects broken ones', () => {
    // spec: 21 §6.3 whole-object validation; 60 §4.1 cells use the ts-compat defaults
    for (const cell of ['T15-on', 'T15-off']) {
      const raw = JSON.parse(
        readFileSync(path.join(CONTRACT_DIR, '..', 'parity', 'cells', `${cell}.json`), 'utf8'),
      ) as { modelConfig: unknown }
      assert.doesNotThrow(() => validateModelConfig(raw.modelConfig), cell)
    }
    const extra = { ...tsCompatDefault(), extra: 1 }
    assert.equal(
      causeOf(() => validateModelConfig(extra)),
      'model_config',
    )
    const clocked = {
      ...tsCompatDefault(),
      clock: { marketData: { calibrationId: 'x', delay: { kind: 'constant', ms: 0 } } },
    }
    assert.equal(
      causeOf(() => validateModelConfig(clocked)),
      'model_config',
    )
  })

  it('implements RFC 7396 merge patches', () => {
    // spec: 21 §6.3 (--model-config-override is an RFC 7396 JSON merge patch)
    assert.deepEqual(applyMergePatch({ a: 1, b: { c: 2, d: 3 } }, { b: { c: null, e: 4 } }), {
      a: 1,
      b: { d: 3, e: 4 },
    })
    assert.deepEqual(applyMergePatch({ a: [1, 2] }, { a: [3] }), { a: [3] })
    assert.equal(applyMergePatch({ a: 1 }, 'x'), 'x')
  })

  it('renders numbers as decimal strings without silent rounding', () => {
    // spec: 21 §6.1 regex (D69 A-03), §18 N4
    assert.equal(numberToDecimalString(500), '500')
    assert.equal(numberToDecimalString(0.1), '0.1')
    assert.equal(numberToDecimalString(12.345678), '12.345678')
    assert.throws(() => numberToDecimalString(1e-7))
    assert.throws(() => numberToDecimalString(Number.NaN))
    assert.ok(isDecimalString('0.000001'))
    assert.ok(!isDecimalString('-0'))
    assert.ok(!isDecimalString('1.0'))
    assert.ok(!isDecimalString('0.0000001'))
  })
})
