/**
 * Protocol-v2 runner tests with scripted fake binaries (20 §1-§5; 21 §12,
 * §19; WIP download/verify/memoize logic of `fef5f199:native.ts:46-84`).
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

import { buildEngineJob } from './buildEngineJob.js'
import type { EngineJob } from './contract/generated.js'
import { NativeError } from './errors.js'
import { REPO_ROOT } from './modelConfig.js'
import {
  MAX_STDOUT_BYTES,
  checkedInContractSha256,
  describeNative,
  describeNativeCached,
  ensureNativeArtifact,
  expectedExitCodes,
  nativeArtifactCachePath,
  nativeArtifactR2Key,
  resetNativeArtifactMemo,
  runArgs,
  runNativeJob,
  type NativeDescribe,
} from './runner.js'
import { echoingResult, makeDataRoot, nativeJob, scratchDir, writeBytes } from './testSupport.js'

interface FakeConfig {
  describe?: unknown
  describeExit?: number
  result?: unknown
  runExit?: number
  stderr?: string
  record?: string
  selfKill?: boolean
  bigMiB?: number
}

/** A scripted executable standing in for a native artifact. */
function fakeBin(cfg: FakeConfig): string {
  const dir = scratchDir('bin')
  const file = path.join(dir, 'fake-native')
  writeFileSync(
    file,
    `#!${process.execPath}
const fs = require('fs')
const cfg = ${JSON.stringify(cfg)}
const args = process.argv.slice(2)
if (cfg.record) fs.writeFileSync(cfg.record, JSON.stringify({ args, env: process.env, cwd: process.cwd(), job: args[0] === 'run' ? JSON.parse(fs.readFileSync(args[2], 'utf8')) : null }))
if (cfg.stderr) process.stderr.write(cfg.stderr)
if (args[0] === 'describe') {
  process.stdout.write(JSON.stringify(cfg.describe))
  process.exitCode = cfg.describeExit || 0
} else if (args[0] === 'run') {
  if (cfg.selfKill) process.kill(process.pid, 'SIGKILL')
  if (cfg.bigMiB) { const chunk = 'x'.repeat(1 << 20); for (let i = 0; i < cfg.bigMiB; i++) process.stdout.write(chunk) }
  const t = args.indexOf('--trace')
  if (t > 0) fs.writeFileSync(args[t + 1], 'trace')
  if (cfg.result !== undefined) process.stdout.write(typeof cfg.result === 'string' ? cfg.result : JSON.stringify(cfg.result))
  process.exitCode = cfg.runExit || 0
} else {
  process.stderr.write('unknown subcommand\\n')
  process.exitCode = 2
}
`,
  )
  chmodSync(file, 0o755)
  return file
}

function describeDoc(over: Partial<Record<string, unknown>> = {}): NativeDescribe {
  return {
    type: 'describe',
    protocolVersion: 2,
    binary: {
      engineVersion: '0.1.0',
      engineCommit: 'a'.repeat(40),
      engineDirty: false,
      sdkVersion: '0.1.0',
      rustc: '1.89.0',
      target: 'aarch64-apple-darwin',
      buildProfile: 'artifact',
      contractSha256: checkedInContractSha256(),
    },
    capabilities: {
      subcommands: ['describe', 'schema', 'selftest', 'run'],
      inputModes: ['telonex-delta'],
      profiles: ['ts-compat'],
      jobSchemaVersions: [1],
      outputSchemaVersions: [1],
      modelConfigVersions: [1],
      rulesTables: [{ version: 'rules-table-v1' }],
      features: ['parity_trace'],
      traceFormat: 'pmb-parity-trace/2',
      ledgerFormat: 'pmb-ledger/1',
      journalFormat: 'pmb-live-journal/1',
      maxCandidates: 1024,
      realOrders: false,
    },
    strategy: {
      id: 'feed-exerciser.rs',
      paramsSchema: {},
      results: [{ ok: true, params: { trade: false }, requiredFeeds: null }],
    },
    ...over,
  } as NativeDescribe
}

async function engineJob(): Promise<EngineJob> {
  const b = await buildEngineJob(nativeJob(), { dataRoot: makeDataRoot() }, { log: () => {} })
  assert.equal(b.kind, 'job')
  return b.job
}

async function failure(p: Promise<unknown>): Promise<NativeError['info']> {
  try {
    await p
  } catch (err) {
    assert.ok(err instanceof NativeError, String(err))
    return err.info
  }
  assert.fail('expected a NativeError')
}

describe('describe (20 §5.1, §1, §3)', () => {
  it('runs under the G6 environment and returns a compatible binary', async () => {
    // spec: 20 G6 (exact env, per-process temp cwd), §5.1 describe, §3 capabilities
    const record = path.join(scratchDir('rec'), 'call.json')
    const bin = fakeBin({ describe: describeDoc(), record })
    const doc = await describeNative(bin, { params: { trade: false } })
    assert.equal(doc.strategy.id, 'feed-exerciser.rs')
    const call = JSON.parse(readFileSync(record, 'utf8')) as {
      args: string[]
      env: Record<string, string>
      cwd: string
    }
    assert.deepEqual(call.args, ['describe', '--params', '{"trade":false}'])
    // macOS adds __CF_USER_TEXT_ENCODING to every new process; it is not inherited from us.
    const env = Object.fromEntries(Object.entries(call.env).filter(([k]) => !k.startsWith('__CF_')))
    assert.deepEqual(env, { TZ: 'UTC', LANG: 'C', RUST_BACKTRACE: '1' })
    assert.ok(!realpathSync(call.cwd).startsWith(realpathSync(REPO_ROOT)))
  })

  it('refuses other protocols, real-order builds, foreign contracts and targets', async () => {
    // spec: 20 §1 (refuse another protocolVersion; refuse realOrders: true), §3 contractSha256, D12 target
    const v1 = await failure(describeNative(fakeBin({ describe: { protocolVersion: 1, id: 'x' } })))
    assert.deepEqual([v1.class, v1.cause], ['invalid_input', 'version'])
    const v3 = await failure(
      describeNative(fakeBin({ describe: describeDoc({ protocolVersion: 3 }) })),
    )
    assert.equal(v3.cause, 'version')
    const real = describeDoc()
    real.capabilities.realOrders = true
    assert.equal(
      (await failure(describeNative(fakeBin({ describe: real })))).cause,
      'artifact_incompatible',
    )
    const foreign = describeDoc()
    foreign.binary.contractSha256 = '0'.repeat(64)
    assert.equal(
      (await failure(describeNative(fakeBin({ describe: foreign })))).cause,
      'artifact_incompatible',
    )
    const target = await failure(
      describeNative(fakeBin({ describe: describeDoc() }), { target: 'x86_64-unknown-linux-gnu' }),
    )
    assert.equal(target.cause, 'artifact_incompatible')
    const iterate = describeDoc()
    iterate.binary.buildProfile = 'iterate'
    const profile = await failure(
      describeNative(fakeBin({ describe: iterate }), { buildProfile: 'artifact' }),
    )
    assert.equal(profile.cause, 'artifact_incompatible')
  })

  it('reports rejected params as invalid_input: params with the binary messages', async () => {
    // spec: 20 §5.1 (--params invalid exits 2 with an error document)
    const doc = describeDoc()
    doc.strategy.results = [
      { ok: false, errors: [{ path: '/size', message: 'expected a number >= 1' }] },
    ]
    const info = await failure(
      describeNative(fakeBin({ describe: doc, describeExit: 2 }), { params: { size: 0 } }),
    )
    assert.deepEqual([info.class, info.cause], ['invalid_input', 'params'])
    assert.match(info.message, /\/size: expected a number >= 1/)
  })

  it('caches describe per binary and params for the process', async () => {
    // spec: 31 §8 step 5 (cache describe results per (sha, canonical raw params))
    const record = path.join(scratchDir('rec'), 'call.json')
    const bin = fakeBin({ describe: describeDoc(), record })
    const a = describeNativeCached(bin, { params: { b: 1, a: 2 } })
    const b = describeNativeCached(bin, { params: { a: 2, b: 1 } })
    assert.equal(a, b)
    await a
    const c = describeNativeCached(bin, { params: { a: 3 } })
    assert.notEqual(a, c)
    await c
  })

  it('passes a params list through --params-file', async () => {
    // spec: 20 §5.1 (--params-file: one result per element, exit 0)
    const record = path.join(scratchDir('rec'), 'call.json')
    const doc = await describeNative(fakeBin({ describe: describeDoc(), record }), {
      paramsList: [{ a: 1 }, { a: 2 }],
    })
    assert.equal(doc.type, 'describe')
    const call = JSON.parse(readFileSync(record, 'utf8')) as { args: string[] }
    assert.equal(call.args[1], '--params-file')
    assert.ok(!existsSync(call.args[2]!), 'the params file is removed afterwards')
  })
})

describe('run (20 §5.4, §4; 21 §12, §19)', () => {
  it('runs `run --job <file>` and returns the validated result', async () => {
    // spec: 20 §5.4 (run --job --trace --trace-level), §4 exit 0; 21 §19 TS shim validation
    const job = await engineJob()
    const record = path.join(scratchDir('rec'), 'call.json')
    const trace = path.join(scratchDir('trace'), 'a.jsonl.gz')
    const bin = fakeBin({ result: echoingResult(job), record })
    const out = await runNativeJob(bin, job, {
      engineVersion: '0.1.0',
      tracePath: trace,
      traceLevel: 'feeds',
    })
    assert.equal(out.exitCode, 0)
    assert.equal(out.result.status, 'ok')
    assert.ok(out.finishedAtMs >= out.startedAtMs)
    assert.equal(readFileSync(trace, 'utf8'), 'trace')
    const call = JSON.parse(readFileSync(record, 'utf8')) as { args: string[]; job: unknown }
    assert.deepEqual(call.args.slice(3), ['--trace', trace, '--trace-level', 'feeds'])
    assert.deepEqual(call.job, job)
    assert.ok(!existsSync(call.args[2]!), 'the job file is removed afterwards')
  })

  it('returns an error result whose exit code matches its class', async () => {
    // spec: 20 §5.4 (non-zero exit = the class's code, error document still printed), §4
    const job = await engineJob()
    const r = echoingResult(job, 'group-error-data-missing.json')
    const out = await runNativeJob(fakeBin({ result: r, runExit: 3 }), job, {
      engineVersion: '0.1.0',
    })
    assert.equal(out.exitCode, 3)
    assert.equal(out.result.error?.class, 'data_missing')
    assert.deepEqual(expectedExitCodes(out.result), [3])
  })

  it('fails a status that disagrees with the exit code, or an echo mismatch, as invalid_output', async () => {
    // spec: 20 §5.4 exit codes; 21 §12 echo assertions, §19
    const job = await engineJob()
    const ok = echoingResult(job)
    const a = await failure(
      runNativeJob(fakeBin({ result: ok, runExit: 7 }), job, { engineVersion: '0.1.0' }),
    )
    assert.deepEqual([a.class, a.cause], ['invalid_output', 'schema'])
    const b = await failure(runNativeJob(fakeBin({ result: ok }), job, { engineVersion: '0.2.0' }))
    assert.deepEqual([b.class, b.cause], ['invalid_output', 'echo_mismatch'])
    const c = await failure(
      runNativeJob(fakeBin({ result: 'not json' }), job, { engineVersion: '0.1.0' }),
    )
    assert.deepEqual([c.class, c.cause], ['invalid_output', 'schema'])
  })

  it('classifies exits without a document by exit code or signal', async () => {
    // spec: 20 §4 (exit code → class; signal → killed, message names it; last stderr line)
    const job = await engineJob()
    const panic = await failure(
      runNativeJob(fakeBin({ runExit: 101, stderr: 'thread main panicked\n' }), job, {
        engineVersion: '0.1.0',
      }),
    )
    assert.deepEqual([panic.class, panic.cause], ['engine_fault', 'panic'])
    assert.match(panic.message, /thread main panicked/)
    const missing = await failure(
      runNativeJob(fakeBin({ runExit: 3 }), job, { engineVersion: '0.1.0' }),
    )
    assert.equal(missing.class, 'data_missing')
    const killed = await failure(
      runNativeJob(fakeBin({ selfKill: true }), job, { engineVersion: '0.1.0' }),
    )
    assert.deepEqual([killed.class, killed.cause], ['killed', 'signal'])
    assert.match(killed.message, /SIGKILL/)
  })

  it('kills a binary whose stdout exceeds 64 MiB', async () => {
    // spec: 20 G9 (64 MiB cap; invalid_output: line_too_large)
    const job = await engineJob()
    const info = await failure(
      runNativeJob(fakeBin({ bigMiB: MAX_STDOUT_BYTES / (1 << 20) + 1 }), job, {
        engineVersion: '0.1.0',
      }),
    )
    assert.deepEqual([info.class, info.cause], ['invalid_output', 'line_too_large'])
  })

  it('takes exactly one candidate and builds the 20 §5.4 arguments', async () => {
    // spec: 20 §5.4 (input: one EngineJob with exactly one candidate; flags)
    const job = await engineJob()
    const two = {
      ...job,
      run: {
        ...job.run,
        candidates: [job.run.candidates[0]!, { ...job.run.candidates[0]!, key: 'b', index: 1 }],
      },
    }
    assert.equal(
      (await failure(runNativeJob('/bin/false', two, { engineVersion: '0.1.0' }))).cause,
      'params',
    )
    assert.deepEqual(
      runArgs('/j.json', {
        tracePath: '/t',
        traceLevel: 'decisions',
        ledgerPath: '/l',
        stackMb: 16,
        tapeDir: '/tape',
      }),
      [
        'run',
        '--job',
        '/j.json',
        '--trace',
        '/t',
        '--trace-level',
        'decisions',
        '--ledger',
        '/l',
        '--stack-mb',
        '16',
        '--tape-dir',
        '/tape',
      ],
    )
  })
})

describe('native artifact cache (20 §1; WIP native.ts:46-84)', () => {
  const bytes = Buffer.from('#!/bin/sh\necho native\n')
  const sha = createHash('sha256').update(bytes).digest('hex')
  const ref = { sha256: sha, r2Url: `r2://bucket/${nativeArtifactR2Key(sha)}` }

  it('downloads once per machine and verifies once per process', async () => {
    // spec: 20 §1 identity = sha256 of the binary; WIP memoize logic (one promise per sha)
    resetNativeArtifactMemo()
    const cacheRoot = scratchDir('cache')
    let downloads = 0
    const download = async (_u: string, to: string) => {
      downloads++
      writeBytes(to, 0)
      writeFileSync(to, bytes)
    }
    const a = ensureNativeArtifact(ref, { cacheRoot, download })
    const b = ensureNativeArtifact(ref, { cacheRoot, download })
    assert.equal(a, b)
    const bin = await a
    assert.equal(bin, nativeArtifactCachePath(sha, cacheRoot))
    assert.equal(downloads, 1)
    resetNativeArtifactMemo()
    await ensureNativeArtifact(ref, { cacheRoot, download })
    assert.equal(downloads, 1, 'cached on disk')
  })

  it('re-downloads a corrupt cached copy once and refuses a corrupt fresh one', async () => {
    // spec: 40 §6.1 item 3 (re-download once; a fresh mismatch is data_defect: integrity_mismatch)
    resetNativeArtifactMemo()
    const cacheRoot = scratchDir('cache')
    writeBytes(nativeArtifactCachePath(sha, cacheRoot), 5)
    let downloads = 0
    await ensureNativeArtifact(ref, {
      cacheRoot,
      download: async (_u, to) => {
        downloads++
        writeFileSync(to, bytes)
      },
    })
    assert.equal(downloads, 1)
    resetNativeArtifactMemo()
    const bad = await failure(
      ensureNativeArtifact(ref, {
        cacheRoot: scratchDir('cache'),
        download: async (_u, to) => writeBytes(to, 3),
      }),
    )
    assert.deepEqual([bad.class, bad.cause], ['data_defect', 'integrity_mismatch'])
    const down = await failure(
      ensureNativeArtifact(ref, {
        cacheRoot: scratchDir('cache'),
        download: async () => {
          throw new Error('503')
        },
      }),
    )
    assert.deepEqual([down.class, down.cause], ['runtime', 'r2_download'])
    const shape = await failure(
      ensureNativeArtifact({ sha256: 'nope', r2Url: 'r2://b/k' }, { cacheRoot }),
    )
    assert.equal(shape.cause, 'artifact_incompatible')
  })
})
