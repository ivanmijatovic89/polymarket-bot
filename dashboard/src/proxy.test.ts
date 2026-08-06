import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NextRequest } from 'next/server'
import { proxy } from './proxy'

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
