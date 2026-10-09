import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { diffTraces } from './diff.js'
import { MatcherSchema, classifyMarket, globToRegExp, type Matcher } from './matchers.js'
import type { TraceRecord } from './trace.js'

const header: TraceRecord = {
  t: 'header',
  format: 'pmb-parity-trace',
  version: 2,
  slug: 's',
  candidateKey: 'k',
  profile: 'ts-compat',
}
const fin: TraceRecord = {
  t: 'final',
  stats: null,
  skipReason: 'no_activity',
  eventsProcessed: 1,
  eventsByType: {},
  unrounded: null,
}
const rej = (reason: string): TraceRecord => ({
  t: 'event',
  seq: 0,
  kind: 'order_rejected',
  ts: 1,
  cid: 'x1',
  reason,
})
const done = (filledSize: number): TraceRecord => ({
  t: 'event',
  seq: 0,
  kind: 'order_done',
  ts: 1,
  cid: 'x1',
  reason: 'filled',
  filledSize,
})

const matcher = (over: Partial<Matcher>): Matcher =>
  MatcherSchema.parse({
    id: 'PE-0001',
    class: 'TS bug',
    status: 'accepted',
    recordType: 'event',
    kind: 'order_done',
    pathGlob: '$.filledSize',
    ...over,
  })

describe('matchers and verdicts (60 §3.2, HR-6)', () => {
  it('globs match within and across path segments', () => {
    assert.ok(globToRegExp('$.stats.*').test('$.stats.pnl'))
    assert.equal(globToRegExp('$.stats.*').test('$.stats.intentMeta[0].x'), false)
    assert.ok(globToRegExp('$.stats.**').test('$.stats.intentMeta[0].x'))
  })

  it('identical traces are identical; matched field-only divergences are classified; others unclassified', () => {
    const a = [header, done(5), fin]
    assert.deepEqual(classifyMarket(diffTraces(a, a), a, []).verdict, { verdict: 'identical' })
    const b = [header, done(4), fin]
    const d = diffTraces(a, b)
    assert.deepEqual(classifyMarket(d, a, [matcher({})]).verdict, {
      verdict: 'classified',
      entries: ['PE-0001'],
    })
    assert.equal(classifyMarket(d, a, []).verdict.verdict, 'unclassified')
    // CL-1: exactly one matcher per divergence
    assert.equal(
      classifyMarket(d, a, [matcher({}), matcher({ id: 'PE-0002' })]).verdict.verdict,
      'unclassified',
    )
    // required event kinds must be present in the market
    assert.equal(
      classifyMarket(d, a, [matcher({ requiredEventKinds: ['fill'] })]).verdict.verdict,
      'unclassified',
    )
  })

  it('an open Rust-bug entry is reported for HR-8', () => {
    const a = [header, rej('invalid_price'), fin]
    const b = [header, rej('invalid_size'), fin]
    const c = classifyMarket(diffTraces(a, b), a, [
      matcher({ class: 'Rust bug', status: 'open', kind: 'order_rejected', pathGlob: '$.reason' }),
    ])
    assert.equal(c.verdict.verdict, 'classified')
    assert.equal(c.openRustBug, true)
  })
})
