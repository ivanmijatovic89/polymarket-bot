import assert from 'node:assert/strict'
import test from 'node:test'
import { isRetryableRpcFailure, isRetryableRpcHttpStatus } from './rpc.js'

test('RPC retries transient HTTP statuses', () => {
  assert.equal(isRetryableRpcHttpStatus(408), true)
  assert.equal(isRetryableRpcHttpStatus(429), true)
  assert.equal(isRetryableRpcHttpStatus(500), true)
  assert.equal(isRetryableRpcHttpStatus(503), true)

  assert.equal(isRetryableRpcHttpStatus(400), false)
  assert.equal(isRetryableRpcHttpStatus(401), false)
  assert.equal(isRetryableRpcHttpStatus(404), false)
})

test('RPC retries an HTTP 408 after it has been converted to an error', () => {
  assert.equal(isRetryableRpcFailure(new Error('batch HTTP 408')), true)
  assert.equal(isRetryableRpcFailure(new Error('eth_getLogs HTTP 429')), true)
  assert.equal(isRetryableRpcFailure(new Error('eth_getLogs HTTP 400')), false)
  assert.equal(isRetryableRpcFailure(new Error('eth_getLogs RPC -32600: invalid request')), false)
})
