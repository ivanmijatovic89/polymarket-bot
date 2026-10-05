import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ApiClient } from './api.js'
import { discoverDay, parseDate } from './catalog.js'
import { writeJson } from './files.js'
import { syncDataset } from './sync.js'
import { verifyDataset } from './verify.js'

const day = '2026-06-17'
const start = parseDate(day)
const omitted = 15
const slug = (index: number) => `btc-updown-15m-${start + index * 900}`
const condition = (index: number) => `0x${(index + 1).toString(16).padStart(64, '0')}`
function fixture(mode: 'recover' | 'missing' | 'unavailable' | 'wrong-slug') {
  let now = 1_000_000
  const direct: string[] = []
  const market = (index: number) => ({
    slug: slug(index),
    conditionId: condition(index),
    active: index !== omitted,
    closed: true,
    clobTokenIds: JSON.stringify([`up-${index}`, `down-${index}`]),
    outcomes: '["Up","Down"]',
    events: [{ id: String(index + 1) }],
  })
  const client = new ApiClient({
    requestsPerSecond: 100000,
    attempts: 1,
    now: () => now,
    sleep: async (ms) => {
      now += ms
    },
    fetch: (async (input) => {
      const url = new URL(String(input))
      const selected = url.searchParams.get('condition')?.split(',') ?? []
      if (url.pathname === '/markets')
        return Response.json(
          url.searchParams
            .getAll('slug')
            .map((value) => (Number(value.split('-').at(-1)) - start) / 900)
            .filter((index) => index !== omitted)
            .map(market),
        )
      if (url.pathname.startsWith('/markets/slug/')) {
        direct.push(url.pathname)
        if (mode === 'missing') return new Response('not found', { status: 404 })
        if (mode === 'unavailable') return new Response('unavailable', { status: 503 })
        return Response.json(market(mode === 'wrong-slug' ? omitted + 1 : omitted))
      }
      if (url.pathname === '/v2/resolutions')
        return Response.json({
          data: selected.map((id) => ({
            condition_id: id,
            status: 'resolved',
            payouts: [1000000, 0],
          })),
        })
      if (url.pathname === '/v2/status') return Response.json({ data: {} })
      if (url.pathname === '/v2/live-volume')
        return Response.json({
          data: {
            taker_volume_total: 0,
            conditions: url.searchParams
              .get('event_id')!
              .split(',')
              .map((id) => ({
                condition_id: condition(Number(id) - 1),
                taker_volume: 0,
              })),
          },
        })
      if (['/v2/trades', '/v2/positions', '/v2/activity'].includes(url.pathname))
        return Response.json({ data: [], pagination: { next_cursor: null } })
      throw new Error(`Unexpected endpoint: ${url.pathname}`)
    }) as typeof fetch,
  })
  return { client, direct }
}

test('direct Gamma lookup recovers an inactive market omitted by both list filters', async () => {
  const { client, direct } = fixture('recover')
  const catalog = await discoverDay(client, day)
  assert.deepEqual(catalog.missing, [])
  assert.equal(catalog.markets.length, 96)
  assert.deepEqual(direct, [`/markets/slug/${slug(omitted)}`])
  const recovered = catalog.markets.find((row) => row.slug === slug(omitted))!
  assert.equal(recovered.condition_id, condition(omitted))
  assert.equal(recovered.event_id, String(omitted + 1))
  assert.equal(recovered.resolved, true)
})

test('a direct 404 remains an explicit catalog gap', async () => {
  const catalog = await discoverDay(fixture('missing').client, day)
  assert.deepEqual(catalog.missing, [slug(omitted)])
  assert.equal(catalog.markets.length, 95)
})

test('a failed or mismatched direct lookup cannot masquerade as a missing market', async () => {
  await assert.rejects(discoverDay(fixture('unavailable').client, day), /HTTP 503/)
  await assert.rejects(discoverDay(fixture('wrong-slug').client, day), /unexpected market/)
})

test('resume retries a cached catalog gap before publishing the day', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'research-catalog-resume-'))
  try {
    const oldCatalog = await discoverDay(fixture('missing').client, day)
    const generation = 'interrupted-catalog'
    await writeJson(path.join(root, 'work', day, 'state.json'), {
      generation,
      asOf: Math.floor(Date.now() / 1000),
      startedAt: new Date().toISOString(),
    })
    await writeJson(path.join(root, 'work', day, generation, 'catalog.json'), oldCatalog)
    const { client, direct } = fixture('recover')
    const [snapshot] = await syncDataset({
      root,
      from: day,
      to: '2026-06-18',
      concurrency: 4,
      requestsPerSecond: 12,
      minFreeGiB: 1,
      client,
      log: () => {},
    })
    assert.equal(snapshot!.generation, generation)
    assert.deepEqual(snapshot!.missing_markets, [])
    assert.equal(direct.length, 1)
    const verified = await verifyDataset(root, day, '2026-06-18')
    assert.equal(verified.valid, true, JSON.stringify(verified))
    assert.equal(verified.days[0]!.checks.market_rows, 96)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
