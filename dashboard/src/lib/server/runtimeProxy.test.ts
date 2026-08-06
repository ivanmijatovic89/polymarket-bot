import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { NextRequest } from 'next/server'
import { runtimeAuthHeaders } from './runtimeMachines'
import { forwardToDaemon } from './runtimeProxy'

const machine = { machineId: 'aaaabbbbcccc', name: 'worker-x', runtimeUrl: 'http://100.0.0.1:3053' }
const originalFetch = globalThis.fetch
const originalToken = process.env.GLOBAL_RUNTIME_TOKEN

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalToken === undefined) delete process.env.GLOBAL_RUNTIME_TOKEN
  else process.env.GLOBAL_RUNTIME_TOKEN = originalToken
})

test('runtimeAuthHeaders carries the server-side token only when configured', () => {
  assert.deepEqual(runtimeAuthHeaders({} as NodeJS.ProcessEnv), {})
  assert.deepEqual(
    runtimeAuthHeaders({ GLOBAL_RUNTIME_TOKEN: ' secret ' } as unknown as NodeJS.ProcessEnv),
    { authorization: 'Bearer secret' },
  )
})

test('forwardToDaemon preserves method, body, and query, and attaches the bearer token', async () => {
  process.env.GLOBAL_RUNTIME_TOKEN = 'fleet-secret'
  const calls: { url: string; method: string; body: string | undefined; auth: string | null }[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body === undefined ? undefined : String(init.body),
      auth: headers.get('authorization'),
    })
    return new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  const request = new NextRequest('http://dashboard.local/api/mission-control/run/7/inbox?x=1', {
    method: 'POST',
    body: JSON.stringify({ message: 'hello' }),
    headers: { 'content-type': 'application/json' },
  })
  const response = await forwardToDaemon(request, machine, 'runs/7/inbox')

  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), { ok: true })
  const seen = calls[0]
  assert.ok(seen)
  assert.equal(seen.url, 'http://100.0.0.1:3053/runs/7/inbox?x=1')
  assert.equal(seen.method, 'POST')
  assert.equal(seen.body, JSON.stringify({ message: 'hello' }))
  assert.equal(seen.auth, 'Bearer fleet-secret')
})

test('a connection failure becomes a named 503 for the machine', async () => {
  globalThis.fetch = (async () => {
    throw new Error('connect ECONNREFUSED 100.0.0.1:3053')
  }) as typeof fetch

  const request = new NextRequest('http://dashboard.local/api/mission-control/run/7/start', {
    method: 'POST',
  })
  const response = await forwardToDaemon(request, machine, 'runs/7/start')
  assert.equal(response.status, 503)
  const payload = (await response.json()) as { error: string }
  assert.match(payload.error, /worker-x \(aaaabbbbcccc\) is unreachable/u)
  assert.match(payload.error, /ECONNREFUSED/u)
})
