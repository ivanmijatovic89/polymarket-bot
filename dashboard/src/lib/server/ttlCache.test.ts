import assert from 'node:assert/strict'
import test from 'node:test'
import { createTtlCache } from './ttlCache'

test('returns a cached value until the TTL expires', async () => {
  let time = 1_000
  let calls = 0
  const cache = createTtlCache(30_000, () => time)
  const load = async () => ++calls

  assert.equal(await cache.get(load), 1)
  time += 29_999
  assert.equal(await cache.get(load), 1)
  assert.equal(calls, 1)

  time += 1
  assert.equal(await cache.get(load), 2)
  assert.equal(calls, 2)
})

test('deduplicates concurrent cache misses', async () => {
  let calls = 0
  let resolveLoad: ((value: number) => void) | undefined
  const cache = createTtlCache<number>(30_000)
  const load = () => {
    calls += 1
    return new Promise<number>((resolve) => {
      resolveLoad = resolve
    })
  }

  const first = cache.get(load)
  const second = cache.get(load)

  assert.equal(calls, 1)
  resolveLoad?.(42)
  assert.deepEqual(await Promise.all([first, second]), [42, 42])
})

test('does not cache a failed load', async () => {
  let calls = 0
  const cache = createTtlCache(30_000)
  const load = async () => {
    calls += 1
    if (calls === 1) throw new Error('temporary failure')
    return 'recovered'
  }

  await assert.rejects(cache.get(load), /temporary failure/)
  assert.equal(await cache.get(load), 'recovered')
  assert.equal(calls, 2)
})

test('clear invalidates the current value', async () => {
  let calls = 0
  const cache = createTtlCache(30_000)
  const load = async () => ++calls

  assert.equal(await cache.get(load), 1)
  cache.clear()
  assert.equal(await cache.get(load), 2)
})
