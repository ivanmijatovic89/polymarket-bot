import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import {
  MAX_JSON_CONTAINER_DEPTH,
  isJsonValue,
  validProtocolIdentifier,
  type JsonValue,
} from './contracts.js'
import { NativeRuntimeError, runNativeOperation, type NativeClientOptions } from './nativeClient.js'

const fixture = fileURLToPath(new URL('./fixtures/fakeRuntime.mjs', import.meta.url))
const parentFixture = fileURLToPath(new URL('./fixtures/exitingParent.mts', import.meta.url))
const request = { operation: 'describe_runtime', requestId: 'test-request', input: null }

function options(mode: string, overrides: Partial<NativeClientOptions> = {}): NativeClientOptions {
  return { executablePath: process.execPath, args: [fixture, mode], timeoutMs: 5000, ...overrides }
}
function errorCode(code: string) {
  return (error: unknown): boolean => error instanceof NativeRuntimeError && error.code === code
}
async function readPid(file: string): Promise<number> {
  for (let i = 0; i < 200; i++) {
    try {
      return Number(await readFile(file, 'utf8'))
    } catch {
      await delay(10)
    }
  }
  throw new Error('Fixture did not start')
}
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('returns a correlated success envelope and preserves JSON values', async () => {
  const input: JsonValue = {
    text: 'price €',
    nullable: null,
    nested: [false, 0, { quantity: 1.25 }],
  }
  const result = await runNativeOperation(options('success', { expectedEngineVersion: '0.1.0' }), {
    ...request,
    input,
  })
  assert.equal(result.requestId, request.requestId)
  assert.deepEqual(result.result, input)
})

test('JSON validation rejects cycles but permits repeated independent references', async () => {
  const cycle: { value?: unknown } = {}
  cycle.value = cycle
  assert.equal(isJsonValue(cycle), false)
  const shared = { count: 1 }
  const input = { first: shared, second: shared }
  assert.equal(isJsonValue(input), true)
  const response = await runNativeOperation(options('success'), { ...request, input })
  assert.deepEqual(response.result, input)
})

test('rejects serialization hooks and accessors without executing them', async () => {
  let calls = 0
  const custom = {}
  Object.defineProperty(custom, 'toJSON', {
    value: () => {
      calls++
      return { changed: true }
    },
  })
  const getter = {}
  Object.defineProperty(getter, 'value', {
    enumerable: true,
    get: () => {
      calls++
      return 1
    },
  })
  const arrayGetter = [1]
  Object.defineProperty(arrayGetter, '0', {
    enumerable: true,
    get: () => {
      calls++
      return 1
    },
  })
  const arrayHook: unknown[] = []
  Object.defineProperty(arrayHook, 'toJSON', {
    value: () => {
      calls++
      return []
    },
  })
  const arrayIgnored = [1]
  Object.defineProperty(arrayIgnored, 'metadata', { enumerable: true, value: true })
  const symbolArray = [1]
  Object.defineProperty(symbolArray, Symbol('hidden'), { value: true })
  const hidden = {}
  Object.defineProperty(hidden, 'metadata', { value: true })
  class CustomizedArray extends Array<JsonValue> {
    toJSON() {
      calls++
      return 'changed'
    }
  }
  const subclass = new CustomizedArray()
  subclass.push(1)
  const proxy = new Proxy(
    {},
    {
      ownKeys: () => {
        calls++
        return []
      },
    },
  )
  for (const input of [
    custom,
    getter,
    arrayGetter,
    arrayHook,
    arrayIgnored,
    symbolArray,
    hidden,
    proxy,
    subclass,
  ]) {
    assert.equal(isJsonValue(input), false)
    await assert.rejects(
      runNativeOperation(options('success'), { ...request, input: input as JsonValue }),
      errorCode('invalid_request'),
    )
  }
  assert.equal(calls, 0)
})

test('rejects inherited serialization hooks without invoking getters', () => {
  let calls = 0
  const original = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON')
  try {
    Object.defineProperty(Object.prototype, 'toJSON', {
      configurable: true,
      get: () => {
        calls++
        return () => 'changed'
      },
    })
    assert.equal(isJsonValue({ value: 1 }), false)
    assert.equal(isJsonValue([1]), false)
    assert.equal(calls, 0)
  } finally {
    if (original) Object.defineProperty(Object.prototype, 'toJSON', original)
    else Reflect.deleteProperty(Object.prototype, 'toJSON')
  }
})

function nestedContainers(depth: number): JsonValue {
  let value: JsonValue = true
  for (let i = 0; i < depth; i++) value = { nested: value }
  return value
}

test('enforces the shared nesting limit within input/result including reused subtrees', async () => {
  const accepted = nestedContainers(MAX_JSON_CONTAINER_DEPTH)
  assert.equal(isJsonValue(accepted), true)
  const result = await runNativeOperation(options('success'), { ...request, input: accepted })
  assert.deepEqual(result.result, accepted)
  const tooDeep = nestedContainers(MAX_JSON_CONTAINER_DEPTH + 1)
  await assert.rejects(
    runNativeOperation(options('success'), { ...request, input: tooDeep }),
    errorCode('invalid_request'),
  )
  const shared = nestedContainers(MAX_JSON_CONTAINER_DEPTH - 1)
  assert.equal(isJsonValue({ first: shared, second: shared }), true)
  assert.equal(isJsonValue({ deep: { shared }, shallow: shared }), false)
  assert.equal(isJsonValue({ shallow: shared, deep: { shared } }), false)
})

test('wire identifiers match Rust Unicode controls, whitespace and UTF-8 byte bounds', async () => {
  for (const id of ['', ' ', '\u2003', '\u0085', 'bad\u009fidentifier', '\ud800', '\udfff']) {
    assert.equal(validProtocolIdentifier(id, 128), false)
    await assert.rejects(
      runNativeOperation(options('success'), { ...request, requestId: id }),
      errorCode('invalid_request'),
    )
  }
  for (const id of ['  request  ', 'request €', '\u200b', '\ufeff', '😀'.repeat(32)]) {
    assert.equal(validProtocolIdentifier(id, 128), true)
    const response = await runNativeOperation(options('success'), { ...request, requestId: id })
    assert.equal(response.requestId, id)
  }
  assert.equal(validProtocolIdentifier('😀'.repeat(33), 128), false)
})

test('rejects lone Unicode surrogates in input values and object keys', async () => {
  for (const input of ['\ud800', '\udfff', { ['\ud800']: 'value' }, { key: '\udfff' }]) {
    await assert.rejects(
      runNativeOperation(options('success'), { ...request, input }),
      errorCode('invalid_request'),
    )
  }
})

test('decodes fragmented multibyte UTF-8 response without corrupting strings', async () => {
  const result = await runNativeOperation(options('fragmented'), { ...request, input: 'price €' })
  assert.equal(result.result, 'price €')
})

test('waits for clean process close after receiving the response', async () => {
  const started = Date.now()
  await runNativeOperation(options('delayed_exit'), request)
  assert.ok(Date.now() - started >= 120)
})

test('streams input through a slow reader and drains large diagnostics', async () => {
  const input = { payload: 'x'.repeat(1024 * 1024) }
  const result = await runNativeOperation(options('slow_input'), { ...request, input })
  assert.deepEqual(result.result, input)
  await runNativeOperation(options('diagnostics'), request)
})

for (const [mode, code] of [
  ['malformed', 'invalid_response'],
  ['bom', 'invalid_response'],
  ['invalid_utf8', 'invalid_response'],
  ['invalid_unicode_result', 'invalid_response'],
  ['invalid_unicode_key', 'invalid_response'],
  ['control_identifier', 'invalid_response'],
  ['blank_identifier', 'invalid_response'],
  ['wrong_protocol', 'invalid_response'],
  ['wrong_engine', 'invalid_response'],
  ['wrong_engine_protocol', 'invalid_response'],
  ['extra_field', 'invalid_response'],
  ['invalid_error', 'invalid_response'],
  ['nonfinite', 'invalid_response'],
  ['wrong_id', 'request_mismatch'],
  ['null_id', 'invalid_response'],
  ['duplicate', 'invalid_response'],
  ['blank_line', 'invalid_response'],
  ['incomplete', 'incomplete_response'],
  ['no_response', 'incomplete_response'],
] as const) {
  test(`rejects ${mode} output`, async () => {
    await assert.rejects(runNativeOperation(options(mode), request), errorCode(code))
  })
}

test('rejects a version different from the explicitly pinned release', async () => {
  await assert.rejects(
    runNativeOperation(options('success', { expectedEngineVersion: '0.2.0' }), request),
    errorCode('engine_mismatch'),
  )
})

test('propagates structured deterministic native failure without fallback', async () => {
  await assert.rejects(runNativeOperation(options('remote_error'), request), (error: unknown) => {
    assert.ok(error instanceof NativeRuntimeError)
    assert.equal(error.code, 'unsupported_operation')
    assert.equal(error.retryable, false)
    assert.equal(error.message, 'Operation is unsupported.')
    return true
  })
})

test('rejects nonzero exit even after a valid response without exposing diagnostics', async () => {
  await assert.rejects(runNativeOperation(options('nonzero'), request), (error: unknown) => {
    assert.ok(error instanceof NativeRuntimeError)
    assert.equal(error.code, 'process_exit')
    assert.equal(error.message.includes('private-diagnostic'), false)
    return true
  })
})

test('rejects a missing executable', async () => {
  await assert.rejects(
    runNativeOperation({ executablePath: '/missing/native-runtime-executable' }, request),
    errorCode('process_error'),
  )
})

test('bounds output before parsing it', async () => {
  await assert.rejects(
    runNativeOperation(options('oversized', { maxOutputBytes: 1024 }), request),
    errorCode('output_limit'),
  )
})

test('bounds input and rejects invalid JSON or identifiers before spawning', async () => {
  await assert.rejects(
    runNativeOperation(options('success', { maxInputBytes: 128 }), {
      ...request,
      input: 'x'.repeat(128),
    }),
    errorCode('input_limit'),
  )
  const circular: { self?: unknown } = {}
  circular.self = circular
  for (const input of [
    NaN,
    Infinity,
    undefined,
    circular,
    { value: undefined },
    new Date(),
    [, 1],
  ]) {
    await assert.rejects(
      runNativeOperation(options('success'), { ...request, input: input as JsonValue }),
      errorCode('invalid_request'),
    )
  }
  for (const requestId of ['', 'x'.repeat(129), 'bad\nidentifier']) {
    await assert.rejects(
      runNativeOperation(options('success'), { ...request, requestId }),
      errorCode('invalid_request'),
    )
  }
  await assert.rejects(
    runNativeOperation(options('success'), { ...request, operation: 'x'.repeat(65) }),
    errorCode('invalid_request'),
  )
})

test('rejects invalid executable and limit configuration before spawning', async () => {
  await assert.rejects(
    runNativeOperation({ executablePath: 'native-runtime' }, request),
    errorCode('invalid_configuration'),
  )
  for (const timeoutMs of [0, -1, NaN, 1.5, 2 ** 31]) {
    await assert.rejects(
      runNativeOperation(options('success', { timeoutMs }), request),
      errorCode('invalid_configuration'),
    )
  }
  await assert.rejects(
    runNativeOperation(options('success', { maxInputBytes: 65 * 1024 * 1024 }), request),
    errorCode('invalid_configuration'),
  )
})

test('pre-aborted request does not launch a runtime', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    runNativeOperation(options('hang', { signal: controller.signal }), request),
    errorCode('canceled'),
  )
})

for (const reason of ['cancel', 'timeout'] as const) {
  test(`${reason} kills and reaps a runtime that ignores SIGTERM`, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'native-client-'))
    const pidFile = path.join(directory, 'child.pid')
    const controller = new AbortController()
    let pid: number | undefined
    const exitListeners = process.listenerCount('exit')
    try {
      const result = runNativeOperation(
        options('ignore_term', {
          args: [fixture, 'ignore_term', pidFile],
          signal: controller.signal,
          timeoutMs: reason === 'timeout' ? 800 : 5000,
          killGraceMs: 20,
        }),
        request,
      )
      // Attach the rejection handler immediately, before waiting for the PID file.
      const assertion = assert.rejects(
        result,
        errorCode(reason === 'cancel' ? 'canceled' : 'timeout'),
      )
      pid = await readPid(pidFile)
      if (reason === 'cancel') controller.abort()
      await assertion
      assert.equal(alive(pid), false, 'request settles only after the runtime is gone')
      assert.equal(
        process.listenerCount('exit'),
        exitListeners,
        'parent cleanup listener is removed',
      )
    } finally {
      if (pid !== undefined && alive(pid)) process.kill(pid, 'SIGKILL')
      await rm(directory, { recursive: true, force: true })
    }
  })
}

test('normal parent process exit kills its outstanding runtime', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'native-client-parent-'))
  const pidFile = path.join(directory, 'child.pid')
  let pid: number | undefined
  const parent = spawn(process.execPath, ['--import', 'tsx', parentFixture, fixture, pidFile], {
    stdio: 'ignore',
  })
  const closed = new Promise<number | null>((resolve) => parent.once('close', resolve))
  try {
    pid = await readPid(pidFile)
    assert.equal(await closed, 0)
    for (let i = 0; i < 100 && alive(pid); i++) await delay(10)
    assert.equal(alive(pid), false)
  } finally {
    if (parent.exitCode === null) parent.kill('SIGKILL')
    if (pid !== undefined && alive(pid)) process.kill(pid, 'SIGKILL')
    await rm(directory, { recursive: true, force: true })
  }
})
