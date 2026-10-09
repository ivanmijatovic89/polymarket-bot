/**
 * End-to-end shim path with a scripted binary (21 §9, §11-§13, §19; 20 §5.4).
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { describe, it } from 'node:test'

import { buildEngineJob } from './buildEngineJob.js'
import { NativeError } from './errors.js'
import { NATIVE_CHILD_ID_BASE, executeNativeMarketJob } from './execute.js'
import {
  echoingResult,
  fakeBin,
  makeDataRoot,
  nativeJob,
  scratchDir,
  writeBytes,
} from './testSupport.js'

const host = { machineId: 'a1b2c3d4e5f6', slot: 2, commitSha: 'feedface' }

describe('executeNativeMarketJob (21 §11-§13; 20 §5.4)', () => {
  it('builds, runs, validates and maps one market with the shim stamps', async () => {
    // spec: 21 §12 (workerChildId 100 + slot, shim times, commitSha), §11 mapping, §19 validation
    const dataRoot = makeDataRoot()
    const job = nativeJob()
    const b = await buildEngineJob(job, { dataRoot }, { log: () => {} })
    assert.equal(b.kind, 'job')
    if (b.kind !== 'job') return
    const bin = fakeBin({ result: echoingResult(b.job) })
    const out = await executeNativeMarketJob(job, {
      binPath: bin,
      dataRoots: { dataRoot },
      engineVersion: '0.1.0',
      host,
      build: { log: () => {} },
    })
    assert.equal(out.idx, job.idx)
    assert.equal(out.slug, job.slug)
    const exec = out.marketStats?.execution
    assert.ok(exec)
    assert.equal(exec.machineId, host.machineId)
    assert.equal(exec.workerChildId, NATIVE_CHILD_ID_BASE + host.slot)
    assert.equal(exec.commitSha, host.commitSha)
    assert.equal(exec.durationMs, exec.finishedAtMs - exec.startedAtMs)
    assert.equal(out.durationMs, exec.durationMs)
  })

  it('refuses a bad slot with a classified error', async () => {
    // spec: 20 §4 (one closed class vocabulary for shim-side failures), 21 §12 (slot)
    await assert.rejects(
      executeNativeMarketJob(nativeJob(), {
        binPath: '/nonexistent/binary',
        dataRoots: { dataRoot: makeDataRoot() },
        engineVersion: '0.1.0',
        host: { ...host, slot: -1 },
      }),
      (err: unknown) =>
        err instanceof NativeError &&
        err.info.class === 'invalid_input' &&
        err.info.cause === 'args',
    )
  })

  it('short-circuits without spawning the binary', async () => {
    // spec: 21 §13 (no spawn, eventsProcessed 0)
    const out = await executeNativeMarketJob(nativeJob({ marketResolution: null }), {
      binPath: '/nonexistent/binary',
      dataRoots: { dataRoot: makeDataRoot({ input: false, days: false }) },
      engineVersion: '0.1.0',
      host,
      now: (() => {
        let t = 1000
        return () => (t += 5)
      })(),
    })
    assert.deepEqual(out, {
      idx: 3,
      slug: nativeJob().slug,
      marketStats: null,
      eventsProcessed: 0,
      eventsByType: {},
      durationMs: 5,
      skipReason: 'no_resolution',
    })
  })

  it('throws the engine error class and removes per-job temp files', async () => {
    // spec: 21 §14 (single-candidate error fails the job), §9 step 1 (r2 temp file deleted afterwards)
    const tempRoot = scratchDir('tmp')
    const job = nativeJob({}, { readFrom: 'r2' })
    const dataRoot = makeDataRoot({ input: false })
    const build = {
      tempRoot,
      download: async (_u: string, to: string, bytes: number) => writeBytes(to, bytes),
      log: () => {},
    }
    const b = await buildEngineJob(job, { dataRoot }, build)
    assert.equal(b.kind, 'job')
    if (b.kind !== 'job') return
    await b.cleanup()
    const result = echoingResult(b.job, 'group-error-data-missing.json')
    try {
      await executeNativeMarketJob(job, {
        binPath: fakeBin({ result, runExit: 3 }),
        dataRoots: { dataRoot },
        engineVersion: '0.1.0',
        host,
        build,
      })
      assert.fail('expected a NativeError')
    } catch (err) {
      assert.ok(err instanceof NativeError, String(err))
      assert.deepEqual([err.info.class, err.info.cause], ['data_missing', 'day_file_missing'])
    }
    assert.deepEqual(readdirSync(tempRoot), [])
    assert.ok(!existsSync(b.job.market.input.path))
  })

  it('refuses a candidate group on the process-per-job path', async () => {
    // spec: 20 §5.4 (run takes exactly one candidate), §5.5 run-group (M4)
    const c = (key: string, index: number) => ({ key, index, params: { k: key }, execution: null })
    await assert.rejects(
      executeNativeMarketJob(nativeJob({}, { candidates: [c('a', 0), c('b', 1)] }), {
        binPath: '/nonexistent',
        dataRoots: { dataRoot: makeDataRoot() },
        engineVersion: '0.1.0',
        host,
      }),
      /run-group or serve/,
    )
  })
})
