import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadMachineHealth, probeMachineHealth } from './missionControlCache'

const machine = { machineId: 'aaaabbbbcccc', name: 'worker-x', runtimeUrl: 'http://100.0.0.1:3053' }

function fakeFetch(handler: (url: string) => Promise<Response>): typeof fetch {
  return ((input: RequestInfo | URL) => handler(String(input))) as typeof fetch
}

test('a 200 /health means online and ready', async () => {
  const health = await probeMachineHealth(
    machine,
    fakeFetch(async (url) => {
      assert.equal(url, 'http://100.0.0.1:3053/health')
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }),
  )
  assert.deepEqual(health, {
    machineId: 'aaaabbbbcccc',
    name: 'worker-x',
    online: true,
    ready: true,
    error: null,
  })
})

test('a 503 /health means online but initializing', async () => {
  const health = await probeMachineHealth(
    machine,
    fakeFetch(async () => new Response(JSON.stringify({ ok: false }), { status: 503 })),
  )
  assert.equal(health.online, true)
  assert.equal(health.ready, false)
  assert.equal(health.error, 'initializing')
})

test('an unexpected status and a network failure both mean offline with a reason', async () => {
  const badStatus = await probeMachineHealth(
    machine,
    fakeFetch(async () => new Response('nope', { status: 500 })),
  )
  assert.equal(badStatus.online, false)
  assert.equal(badStatus.error, 'HTTP 500')

  const failed = await probeMachineHealth(
    machine,
    fakeFetch(async () => {
      throw new Error('connect ETIMEDOUT')
    }),
  )
  assert.equal(failed.online, false)
  assert.match(failed.error ?? '', /ETIMEDOUT/u)
})

test('loadMachineHealth probes every machine in parallel and never rejects', async () => {
  const second = { machineId: 'ddddeeeeffff', name: 'worker-y', runtimeUrl: 'http://100.0.0.2:3053' }
  const healths = await loadMachineHealth(
    [machine, second],
    fakeFetch(async (url) =>
      url.includes('100.0.0.1')
        ? new Response(JSON.stringify({ ok: true }), { status: 200 })
        : Promise.reject(new Error('unreachable')),
    ),
  )
  assert.equal(healths.length, 2)
  assert.equal(healths[0]?.online, true)
  assert.equal(healths[1]?.online, false)
})
