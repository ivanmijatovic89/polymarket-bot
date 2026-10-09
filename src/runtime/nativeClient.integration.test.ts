import assert from 'node:assert/strict'
import {
  execFileSync,
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdtemp, open, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { MAX_JSON_CONTAINER_DEPTH, MAX_NATIVE_REQUEST_BYTES, type JsonValue } from './contracts.js'
import { NativeRuntimeError, runNativeOperation } from './nativeClient.js'

const executablePath =
  process.env.PMB_NATIVE_TEST_BINARY ??
  fileURLToPath(
    new URL('../../native/trading-runtime/target/debug/polymarket-runtime', import.meta.url),
  )
const parentFixture = fileURLToPath(new URL('./fixtures/nativeParent.mts', import.meta.url))
const options = { executablePath, expectedEngineVersion: '0.1.0' }

async function requireNativeBinary(): Promise<void> {
  try {
    await access(executablePath, constants.X_OK)
  } catch {
    assert.fail(
      'Native integration tests require a built executable. Run cargo build --locked --manifest-path native/trading-runtime/Cargo.toml first.',
    )
  }
}
function object(value: JsonValue): { [key: string]: JsonValue } {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value))
  return value
}
function nativeMarket(pnl: number, marketStartMs: number): JsonValue {
  return {
    marketId: String(marketStartMs),
    slug: `btc-updown-15m-${marketStartMs / 1000}`,
    finalOutcome: 'UP',
    pnl,
    feesPaid: 0,
    tradeCount: 1,
    tradeAsMaker: 0,
    tradeAsTaker: 1,
    avgEntryPriceUp: null,
    avgEntryPriceDown: null,
    upShares: 0,
    downShares: 0,
    mergableShares: 0,
    cost: 0,
    splitCost: 0,
    intentMeta: [],
    marketStartMs,
  }
}
function closed(child: ChildProcess) {
  const result = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Native fixture did not close')), 5000)
      child.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('close', (code, signal) => {
        clearTimeout(timeout)
        resolve({ code, signal })
      })
    },
  )
  // The fixture may fail before the readiness wait finishes; avoid an unhandled rejection.
  void result.catch(() => {})
  return result
}
function waitForResponse(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(
      () => reject(new Error('Native guardian fixture did not respond')),
      5000,
    )
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
      if (output.includes('\n')) {
        clearTimeout(timeout)
        try {
          assert.equal(
            (JSON.parse(output.slice(0, output.indexOf('\n'))) as { status: string }).status,
            'success',
          )
          resolve()
        } catch (error) {
          reject(error)
        }
      }
    })
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', () => {
      clearTimeout(timeout)
      reject(new Error('Native guardian fixture exited before responding'))
    })
  })
}
async function readPid(file: string): Promise<number> {
  for (let i = 0; i < 400; i++) {
    try {
      return Number(await readFile(file, 'utf8'))
    } catch {
      await delay(10)
    }
  }
  throw new Error('Native parent fixture did not become ready')
}
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('real executable describes only implemented capabilities and shared limits', async () => {
  await requireNativeBinary()
  const response = await runNativeOperation(options, { operation: 'describe_runtime', input: {} })
  const result = object(response.result)
  assert.deepEqual(result.operations, ['describe_runtime', 'aggregate'])
  assert.deepEqual(result.inputModes, [])
  assert.deepEqual(result.strategies, [])
  assert.equal(result.liveTrading, false)
  assert.equal(result.maxRequestBytes, MAX_NATIVE_REQUEST_BYTES)
  assert.equal(result.maxInputContainerDepth, MAX_JSON_CONTAINER_DEPTH)
})

test('real whole-operation aggregation returns batch and chronological segment DTOs', async () => {
  await requireNativeBinary()
  const day = 86_400_000
  const start = 1_609_459_200_000
  const response = await runNativeOperation(options, {
    operation: 'aggregate',
    input: {
      markets: [
        nativeMarket(1, start + day),
        nativeMarket(-1, start),
        nativeMarket(2, start + 2 * day),
      ],
      initialCapital: 1000,
    },
  })
  const result = object(response.result)
  const batch = object(result.batchStats!)
  assert.equal(batch.marketsTotal, 3)
  assert.equal(batch.pnlTotal, 2)
  assert.equal(batch.capitalFinal, 1002)
  assert.equal(batch.streakMaxWin, 1)
  assert.ok(Array.isArray(result.segments))
  const all = object(result.segments[0]!)
  assert.equal(all.segmentKind, 'all')
  assert.equal(object(all.stats!).streakMaxWin, 2)
})

test('real native validation returns identified deterministic failure', async () => {
  await requireNativeBinary()
  await assert.rejects(
    runNativeOperation(options, { operation: 'aggregate', input: {} }),
    (error: unknown) =>
      error instanceof NativeRuntimeError && error.code === 'invalid_request' && !error.retryable,
  )
})

test('real parser accepts the maximum input nesting with a correlated response', async () => {
  await requireNativeBinary()
  let input: JsonValue = true
  for (let i = 0; i < MAX_JSON_CONTAINER_DEPTH; i++) input = { nested: input }
  await assert.rejects(
    runNativeOperation(options, { requestId: 'depth-boundary', operation: 'unsupported', input }),
    (error: unknown) =>
      error instanceof NativeRuntimeError && error.code === 'unsupported_operation',
  )
})

test('native guardian exits on watchdog EOF while request stdin remains open', async () => {
  await requireNativeBinary()
  const child = spawn(executablePath, ['--parent-watch-fd', '3'], {
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  })
  const result = closed(child)
  child.stderr.resume()
  try {
    const ready = waitForResponse(child)
    child.stdin.write(
      JSON.stringify({
        protocolVersion: 1,
        requestId: 'ready',
        operation: 'describe_runtime',
        input: {},
      }) + '\n',
    )
    await ready
    assert.equal(child.stdin.writableEnded, false)
    child.stdio[3]!.destroy()
    assert.deepEqual(await result, { code: 130, signal: null })
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    child.stdin.destroy()
    child.stdio[3]?.destroy()
    await result.catch(() => {})
  }
})

async function hardParentLoss(guarded: boolean): Promise<void> {
  await requireNativeBinary()
  const directory = await mkdtemp(path.join(os.tmpdir(), 'native-hard-parent-'))
  const pidFile = path.join(directory, 'child.pid')
  const inputFile = path.join(directory, 'input.fifo')
  execFileSync('mkfifo', [inputFile])
  // A separate descriptor owner survives intermediate-parent SIGKILL. Using child.stdin
  // here would be a false positive: Node destroys that pipe when its child exits.
  const inputOwner = await open(inputFile, constants.O_RDWR)
  const parent = spawn(
    process.execPath,
    ['--import', 'tsx', parentFixture, executablePath, pidFile, guarded ? 'guarded' : 'unguarded'],
    { stdio: [inputOwner.fd, 'pipe', 'pipe'] },
  )
  parent.stdout!.resume()
  parent.stderr!.resume()
  const parentClosed = closed(parent)
  await inputOwner.write(
    JSON.stringify({
      protocolVersion: 1,
      requestId: 'guardian-ready',
      operation: 'describe_runtime',
      input: {},
    }) + '\n',
  )
  let pid: number | undefined
  try {
    pid = await readPid(pidFile)
    assert.equal(alive(pid), true)
    parent.kill('SIGKILL')
    assert.deepEqual(await parentClosed, { code: null, signal: 'SIGKILL' })
    assert.equal(
      (await inputOwner.stat()).isFIFO(),
      true,
      'independent native stdin owner survives',
    )
    if (guarded) {
      for (let i = 0; i < 200 && alive(pid); i++) await delay(10)
      assert.equal(alive(pid), false, 'native fd3 guardian must exit after the parent vanishes')
    } else {
      await delay(100)
      assert.equal(alive(pid), true, 'negative control proves stdin EOF cannot pass this test')
    }
  } finally {
    if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL')
    if (pid !== undefined && alive(pid)) process.kill(pid, 'SIGKILL')
    await inputOwner.close()
    await parentClosed.catch(() => {})
    await rm(directory, { recursive: true, force: true })
  }
}

test('hard SIGKILL of the parent does not leave a native runtime orphan', async () => {
  await hardParentLoss(true)
})

test('parent-loss fixture without a guardian remains alive instead of receiving stdin EOF', async () => {
  await hardParentLoss(false)
})
