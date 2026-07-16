import test from 'node:test'
import assert from 'node:assert/strict'
import { RateLimiter } from './rateLimiter.js'

/** Deterministic clock + sleep so the limiter can be tested without real time. */
function fakeClock() {
  let nowMs = 0
  return {
    now: () => nowMs,
    sleep: async (ms: number) => {
      nowMs += ms
    },
    advance: (ms: number) => {
      nowMs += ms
    },
    get t() {
      return nowMs
    },
  }
}

test('burst is allowed immediately, then requests are paced at the configured rate', async () => {
  const clock = fakeClock()
  const limiter = new RateLimiter(10, 10, clock.now, clock.sleep)

  for (let i = 0; i < 10; i++) await limiter.acquire()
  assert.equal(clock.t, 0, 'the initial burst should not sleep')

  await limiter.acquire()
  // 11th token at 10 rps: needs ~100ms of refill.
  assert.ok(clock.t >= 100, `expected >=100ms of waiting, got ${clock.t}`)
})

test('tokens refill over elapsed time without sleeping', async () => {
  const clock = fakeClock()
  const limiter = new RateLimiter(5, 1, clock.now, clock.sleep)

  await limiter.acquire()
  clock.advance(1000) // 1s at 5 rps refills the (1-token) bucket
  const before = clock.t
  await limiter.acquire()
  assert.equal(clock.t, before, 'a refilled bucket should not sleep')
})

test('rate must be positive', () => {
  assert.throws(() => new RateLimiter(0), /ratePerSecond/)
})
