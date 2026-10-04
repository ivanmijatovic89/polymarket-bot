import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ApiClient } from './api.js'

const page = (data: unknown[], cursor: string | null) =>
  Response.json({ data, pagination: { next_cursor: cursor } })
const options = { requestsPerSecond: 100000, sleep: async () => {} }

test('empty pages do not terminate a walk; filters and repeated identical rows survive', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'research-api-'))
  const urls: URL[] = []
  const client = new ApiClient({
    ...options,
    fetch: (async (url) => {
      const u = new URL(String(url))
      urls.push(u)
      return !u.searchParams.has('cursor')
        ? page([], 'next')
        : page([{ id: 'same' }, { id: 'same' }], null)
    }) as typeof fetch,
  })
  try {
    const rows = await client.walk('/v2/trades', { condition: 'c', taker_only: false }, dir)
    assert.equal(rows.length, 2)
    assert.equal(urls[1]!.searchParams.get('condition'), 'c')
    assert.equal(urls[1]!.searchParams.get('taker_only'), 'false')
    await client.walk('/v2/trades', { condition: 'c', taker_only: false }, dir)
    assert.equal(urls.length, 2, 'complete checkpoint must not redownload')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('interruption resumes from the committed page without duplicating it', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'research-resume-'))
  try {
    const first = new ApiClient({
      ...options,
      attempts: 1,
      fetch: (async (url) => {
        if (new URL(String(url)).searchParams.has('cursor')) throw new Error('interrupted')
        return page([{ id: 'a' }], 'second')
      }) as typeof fetch,
    })
    await assert.rejects(first.walk('/v2/activity', { user: 'wallet' }, dir), /interrupted/)
    const second = new ApiClient({
      ...options,
      fetch: (async (url) => {
        assert.equal(new URL(String(url)).searchParams.get('cursor'), 'second')
        return page([{ id: 'b' }], null)
      }) as typeof fetch,
    })
    assert.deepEqual(await second.walk('/v2/activity', { user: 'wallet' }, dir), [
      { id: 'a' },
      { id: 'b' },
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('429 and retryable 503 retry, while invalid requests fail visibly', async () => {
  let calls = 0
  const delays: number[] = []
  const client = new ApiClient({
    ...options,
    sleep: async (ms) => {
      delays.push(ms)
    },
    fetch: (async () => {
      calls++
      if (calls === 1) return new Response('busy', { status: 429, headers: { 'Retry-After': '2' } })
      if (calls === 2) return new Response('timeout', { status: 503 })
      return Response.json({ data: [] })
    }) as typeof fetch,
  })
  await client.get('/v2/trades')
  assert.equal(calls, 3)
  assert.equal(client.stats.retries, 2)
  assert.ok(delays.some((n) => n >= 2000))
  const invalid = new ApiClient({
    ...options,
    fetch: (async () => new Response('bad query', { status: 400 })) as typeof fetch,
  })
  await assert.rejects(invalid.get('/v2/activity'), /HTTP 400/)
  assert.equal(invalid.stats.requests, 1)
})

test('a repeated cursor fails rather than claiming completion', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'research-loop-'))
  try {
    const client = new ApiClient({
      ...options,
      fetch: (async () => page([{ id: 1 }], 'same')) as typeof fetch,
    })
    await assert.rejects(client.walk('/v2/trades', {}, dir), /repeated cursor/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('mixed endpoint traffic respects both family and total request budgets', async () => {
  let now = 1_000_000
  const starts: { endpoint: string; time: number }[] = []
  const client = new ApiClient({
    requestsPerSecond: 36,
    now: () => now,
    sleep: async (ms) => {
      now += ms
    },
    fetch: (async (input) => {
      starts.push({ endpoint: new URL(String(input)).pathname, time: now })
      return Response.json({ data: [] })
    }) as typeof fetch,
  })
  for (let i = 0; i < 240; i++) {
    await client.get(i % 2 ? '/v2/activity' : '/v2/positions')
  }
  for (const endpoint of ['/v2/activity', '/v2/positions']) {
    const times = starts.filter((row) => row.endpoint === endpoint).map((row) => row.time)
    for (let i = 1; i < times.length; i++) assert.ok(times[i]! - times[i - 1]! >= 1000 / 18 - 0.01)
  }
  assert.ok(now - starts[0]!.time >= (239 * 1000) / 36 - 0.01)
  assert.ok(
    now - starts[0]!.time < (240 * 1000) / 18,
    'mixed families must not be limited to one family budget',
  )
})
