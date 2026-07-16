import assert from 'node:assert/strict'
import test from 'node:test'
import { isRetryableHttpStatus } from './http.js'

test('retries transient HTTP statuses only', () => {
  assert.equal(isRetryableHttpStatus(408), true)
  assert.equal(isRetryableHttpStatus(429), true)
  assert.equal(isRetryableHttpStatus(500), true)
  assert.equal(isRetryableHttpStatus(503), true)

  assert.equal(isRetryableHttpStatus(400), false)
  assert.equal(isRetryableHttpStatus(401), false)
  assert.equal(isRetryableHttpStatus(404), false)
})
