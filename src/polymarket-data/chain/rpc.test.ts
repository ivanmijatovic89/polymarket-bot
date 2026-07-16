import assert from 'node:assert/strict'
import test from 'node:test'
import { isRetryableRpcHttpStatus } from './rpc.js'

test('RPC retries transient HTTP statuses', () => {
  assert.equal(isRetryableRpcHttpStatus(408), true)
  assert.equal(isRetryableRpcHttpStatus(429), true)
  assert.equal(isRetryableRpcHttpStatus(500), true)
  assert.equal(isRetryableRpcHttpStatus(503), true)

  assert.equal(isRetryableRpcHttpStatus(400), false)
  assert.equal(isRetryableRpcHttpStatus(401), false)
  assert.equal(isRetryableRpcHttpStatus(404), false)
})
