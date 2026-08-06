import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { NextRequest } from 'next/server'
import { MISSION_CONTROL_HEADER, proxy } from './proxy'

const originalToken = process.env.GLOBAL_RUNTIME_TOKEN
const originalMissionToken = process.env.MISSION_CONTROL_TOKEN

afterEach(() => {
  restore('GLOBAL_RUNTIME_TOKEN', originalToken)
  restore('MISSION_CONTROL_TOKEN', originalMissionToken)
})

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function request(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://127.0.0.1:3051/api/mission-control/run/7/stop', {
    method: 'POST',
    headers,
  })
}

test('a same-origin dashboard request passes through', () => {
  assert.equal(
    proxy(
      request({
        host: '127.0.0.1:3051',
        origin: 'http://127.0.0.1:3051',
        'sec-fetch-site': 'same-origin',
      }),
    ),
    undefined,
  )
  // Address-bar navigations and curl (no Origin, sec-fetch-site: none) too.
  assert.equal(proxy(request({ host: 'localhost:3051' })), undefined)
})

test('a cross-site POST from another page is rejected (CSRF)', async () => {
  const response = proxy(
    request({ host: '127.0.0.1:3051', 'sec-fetch-site': 'cross-site' }),
  )
  assert.equal(response?.status, 403)
  assert.match(((await response?.json()) as { error: string }).error, /cross-site/u)

  // Same-site (a sibling localhost port) is not same-origin either.
  assert.equal(proxy(request({ host: '127.0.0.1:3051', 'sec-fetch-site': 'same-site' }))?.status, 403)
})

test('a mismatched Origin is rejected even without Fetch Metadata', () => {
  assert.equal(
    proxy(request({ host: '127.0.0.1:3051', origin: 'http://evil.example' }))?.status,
    403,
  )
  assert.equal(proxy(request({ host: '127.0.0.1:3051', origin: 'not a url' }))?.status, 403)
})

test('a rebound hostname is rejected even though it resolves to loopback', () => {
  // DNS rebinding: the page is "same-origin" with attacker.test, which now
  // points at 127.0.0.1 — but the Host header gives it away.
  const response = proxy(
    request({ host: 'attacker.test:3051', 'sec-fetch-site': 'same-origin' }),
  )
  assert.equal(response?.status, 403)

  // A missing Host is equally unacceptable.
  assert.equal(proxy(new NextRequest('http://127.0.0.1:3051/api/mission-control/runs'))?.status, 403)
})

test('loopback hosts are recognized in their usual spellings', () => {
  for (const host of ['127.0.0.1:3051', 'localhost:3051', 'LOCALHOST:3051', '[::1]:3051']) {
    assert.equal(proxy(request({ host })), undefined, host)
  }
})

test('with a token configured, an unauthenticated local request is rejected', async () => {
  process.env.MISSION_CONTROL_TOKEN = 'fleet-secret'
  // This is the sandboxed-session shape: local, no browser headers, no token.
  const denied = proxy(request({ host: '127.0.0.1:3051' }))
  assert.equal(denied?.status, 401)
  assert.match(((await denied?.json()) as { error: string }).error, /shared token/u)

  assert.equal(
    proxy(request({ host: '127.0.0.1:3051', [MISSION_CONTROL_HEADER]: 'wrong' }))?.status,
    401,
  )
  assert.equal(
    proxy(request({ host: '127.0.0.1:3051', [MISSION_CONTROL_HEADER]: 'fleet-secret' })),
    undefined,
  )
})

test('the browser cookie satisfies the token check', () => {
  process.env.MISSION_CONTROL_TOKEN = 'fleet-secret'
  const authorized = new NextRequest('http://127.0.0.1:3051/api/mission-control/runs', {
    headers: { host: '127.0.0.1:3051', cookie: 'mission_control_token=fleet-secret' },
  })
  assert.equal(proxy(authorized), undefined)

  const wrong = new NextRequest('http://127.0.0.1:3051/api/mission-control/runs', {
    headers: { host: '127.0.0.1:3051', cookie: 'mission_control_token=nope' },
  })
  assert.equal(proxy(wrong)?.status, 401)
})

test('the dashboard secret is independent of the daemon token', () => {
  // The daemon's token must NOT gate the dashboard: the multi-machine setup
  // requires GLOBAL_RUNTIME_TOKEN, but a local dashboard may stay open.
  process.env.GLOBAL_RUNTIME_TOKEN = 'fleet-secret'
  delete process.env.MISSION_CONTROL_TOKEN
  assert.equal(proxy(request({ host: '127.0.0.1:3051' })), undefined)

  process.env.MISSION_CONTROL_TOKEN = 'dashboard-secret'
  assert.equal(proxy(request({ host: '127.0.0.1:3051' }))?.status, 401)
  assert.equal(
    proxy(request({ host: '127.0.0.1:3051', [MISSION_CONTROL_HEADER]: 'dashboard-secret' })),
    undefined,
  )
})
