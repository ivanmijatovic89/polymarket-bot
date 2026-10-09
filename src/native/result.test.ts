/**
 * Result validation and mapping tests (21 §11-§14, §19; 20 §4).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildEngineJob } from './buildEngineJob.js'
import type { EngineJob, EngineResult } from './contract/generated.js'
import {
  NativeError,
  classOfExitCode,
  exitCodesOfClass,
  oneLine,
  reasonText,
  retryActionFor,
} from './errors.js'
import {
  mapEngineResult,
  shortCircuitOutput,
  toRunSingleMarketOutput,
  validateEngineResult,
} from './result.js'
import { echoingResult, makeDataRoot, nativeJob } from './testSupport.js'

async function job(candidates?: number): Promise<EngineJob> {
  const extra =
    candidates === undefined
      ? {}
      : {
          candidates: Array.from({ length: candidates }, (_, i) => ({
            key: `cand-${i}`,
            index: i,
            params: { n: i },
            execution: null,
          })),
        }
  const b = await buildEngineJob(
    nativeJob({}, extra),
    { dataRoot: makeDataRoot() },
    { log: () => {} },
  )
  assert.equal(b.kind, 'job')
  return b.job
}

function thrown(fn: () => unknown): NativeError['info'] {
  try {
    fn()
  } catch (err) {
    assert.ok(err instanceof NativeError, String(err))
    return err.info
  }
  assert.fail('expected a NativeError')
}

const stamps = {
  machineId: 'a1b2c3d4e5f6',
  workerChildId: 101,
  startedAtMs: 1_000,
  finishedAtMs: 1_300,
  commitSha: 'deadbeef',
}

describe('validateEngineResult (21 §19 TS shim)', () => {
  it('accepts a schema-valid result that echoes the job', async () => {
    // spec: 21 §19 (Ajv + custom keywords, then §12 echo assertions)
    const j = await job()
    const r = echoingResult(j)
    assert.equal(validateEngineResult(j, r, { engineVersion: '0.1.0' }), r)
  })

  it('fails a schema violation as invalid_output: schema', async () => {
    // spec: 21 §19, §18 N6 (decimalScale), 20 §4.1
    const j = await job()
    const r = echoingResult(j)
    r.candidates[0]!.output!.marketStats!.pnl = 1.234
    assert.deepEqual(
      ((i) => [i.class, i.cause])(
        thrown(() => validateEngineResult(j, r, { engineVersion: '0.1.0' })),
      ),
      ['invalid_output', 'schema'],
    )
    const extra = { ...echoingResult(j), extra: 1 }
    assert.equal(
      thrown(() => validateEngineResult(j, extra, { engineVersion: '0.1.0' })).cause,
      'schema',
    )
  })

  it('fails an echo difference as invalid_output: echo_mismatch', async () => {
    // spec: 21 §12 (engineVersion recorded at submission; slug; candidate keys)
    const j = await job()
    const info = thrown(() => validateEngineResult(j, echoingResult(j), { engineVersion: '9.9.9' }))
    assert.deepEqual([info.class, info.cause], ['invalid_output', 'echo_mismatch'])
    const r = echoingResult(j)
    r.candidates[0]!.key = 'other'
    assert.equal(
      thrown(() => validateEngineResult(j, r, { engineVersion: '0.1.0' })).cause,
      'echo_mismatch',
    )
  })
})

describe('mapping to RunSingleMarketOutput (21 §11-§14)', () => {
  it('maps a single candidate with the shim stamps', async () => {
    // spec: 21 §11 table (idx, durationMs from TS), §12 (execution stamps)
    const j = await job()
    const out = toRunSingleMarketOutput(echoingResult(j), { idx: 7, stamps })
    assert.equal(out.idx, 7)
    assert.equal(out.slug, j.market.slug)
    assert.equal(out.durationMs, 300)
    assert.equal(out.eventsProcessed, 4824)
    assert.deepEqual(out.marketStats?.execution, {
      ...stamps,
      durationMs: 300,
      eventsProcessed: 4824,
      eventsByType: { book: 1, price_change: 4823 },
    })
  })

  it('splits the span of a group and isolates candidate faults', async () => {
    // spec: 21 §12 durationMs floor(w × span / k); §14 (candidate strategy_fault fails only that candidate)
    const j = await job(3)
    const r = echoingResult(j)
    r.candidates[2] = { ...r.candidates[0]!, key: 'cand-2', index: 2 }
    r.candidates[1] = {
      key: r.candidates[1]!.key,
      index: 1,
      status: 'error',
      modelConfigSha256: r.candidates[1]!.modelConfigSha256,
      error: { class: 'strategy_fault', cause: 'panic', message: 'boom' },
    }
    const outcomes = mapEngineResult(r, { idx: 0, stamps, weight: 2 })
    assert.deepEqual(
      outcomes.map((o) => [o.key, o.ok]),
      [
        ['cand-0', true],
        ['cand-1', false],
        ['cand-2', true],
      ],
    )
    const first = outcomes[0]!
    assert.ok(first.ok)
    if (first.ok) assert.equal(first.output.durationMs, 200)
    const tooLarge = structuredClone(r)
    tooLarge.candidates[1]!.error = {
      class: 'strategy_fault',
      cause: 'result_too_large',
      message: 'x',
    }
    assert.equal(
      thrown(() => mapEngineResult(tooLarge, { idx: 0, stamps })).cause,
      'result_too_large',
    )
  })

  it('throws a group-level error and a single candidate error with their class', async () => {
    // spec: 21 §14 (group error fails every candidate; single-candidate error fails the job)
    const j = await job()
    const g: EngineResult = echoingResult(j, 'group-error-data-missing.json')
    const gi = thrown(() => mapEngineResult(g, { idx: 0, stamps }))
    assert.deepEqual([gi.class, gi.cause], ['data_missing', 'day_file_missing'])
    const r = echoingResult(j)
    r.candidates[0] = {
      key: r.candidates[0]!.key,
      index: 0,
      status: 'error',
      modelConfigSha256: r.candidates[0]!.modelConfigSha256,
      error: { class: 'strategy_fault', cause: 'cascade_limit', message: 'loop' },
    }
    assert.equal(
      thrown(() => toRunSingleMarketOutput(r, { idx: 0, stamps })).cause,
      'cascade_limit',
    )
  })

  it('renders a TS short-circuit with zero events and no stats', () => {
    // spec: 21 §13 (shim short-circuits with eventsProcessed 0)
    assert.deepEqual(
      shortCircuitOutput({ kind: 'short_circuit', slug: 's', skipReason: 'no_resolution' }, 4, 2),
      {
        idx: 4,
        slug: 's',
        marketStats: null,
        eventsProcessed: 0,
        eventsByType: {},
        durationMs: 2,
        skipReason: 'no_resolution',
      },
    )
  })
})

describe('error classes (20 §4)', () => {
  it('maps exit codes and classes both ways', () => {
    // spec: 20 §4 exit code table
    assert.equal(classOfExitCode(3), 'data_missing')
    assert.equal(classOfExitCode(101), 'engine_fault')
    assert.equal(classOfExitCode(0), null)
    assert.equal(classOfExitCode(42), null)
    assert.deepEqual(exitCodesOfClass('engine_fault'), [8, 101])
    assert.deepEqual(exitCodesOfClass('killed'), [])
  })

  it('writes the reason text and keeps messages to one line', () => {
    // spec: 20 §4.2 reason text; §4 one line of at most 1,000 characters; §4.1 cause pattern
    const e = new NativeError('data_defect', 'upstream_hole', 'Chainlink hole\nfor 412 s')
    assert.equal(e.message, 'data_defect: upstream_hole: Chainlink hole | for 412 s')
    assert.equal(reasonText(e.info), e.message)
    assert.equal(oneLine('x'.repeat(2000)).length, 1000)
    assert.throws(() => new NativeError('runtime', 'Bad Cause', 'x'))
  })

  it('never burns retries on deterministic classes', () => {
    // spec: 20 §4.3 retry policy; 21 §14 requirement native-error-classification
    assert.deepEqual(retryActionFor('runtime'), { action: 'retry', budgetFactor: 1 })
    assert.deepEqual(retryActionFor('data_missing'), { action: 'retry', budgetFactor: 1 })
    assert.deepEqual(retryActionFor('timeout'), { action: 'retry', budgetFactor: 2 })
    assert.deepEqual(retryActionFor('timeout', 1), { action: 'unrecoverable', alert: false })
    for (const c of ['invalid_input', 'data_defect', 'strategy_fault', 'killed'] as const) {
      assert.deepEqual(retryActionFor(c), { action: 'unrecoverable', alert: false }, c)
    }
    assert.deepEqual(retryActionFor('engine_fault'), { action: 'unrecoverable', alert: true })
    assert.deepEqual(retryActionFor('invalid_output'), { action: 'unrecoverable', alert: true })
    assert.deepEqual(retryActionFor('canceled'), { action: 'release' })
  })
})
