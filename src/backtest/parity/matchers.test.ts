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

const kinds = (recs: TraceRecord[]) =>
  new Set(recs.filter((r) => r.t === 'event').map((r) => String(r.kind)))

const matcher = (over: Partial<Matcher>): Matcher =>
  MatcherSchema.parse({
    id: 'PE-0001',
    class: 'TS bug',
    subclass: 'accounting',
    money: 'no',
    counterfactual: 'not-required',
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
    assert.deepEqual(classifyMarket(diffTraces(a, a), kinds(a), []).verdict, {
      verdict: 'identical',
    })
    const b = [header, done(4), fin]
    const d = diffTraces(a, b)
    assert.deepEqual(classifyMarket(d, kinds(a), [matcher({})]).verdict, {
      verdict: 'classified',
      entries: ['PE-0001'],
    })
    assert.equal(classifyMarket(d, kinds(a), []).verdict.verdict, 'unclassified')
    // CL-1: exactly one matcher per divergence
    assert.equal(
      classifyMarket(d, kinds(a), [matcher({}), matcher({ id: 'PE-0002' })]).verdict.verdict,
      'unclassified',
    )
    // required event kinds must be present in the market
    assert.equal(
      classifyMarket(d, kinds(a), [matcher({ requiredEventKinds: ['fill'] })]).verdict.verdict,
      'unclassified',
    )
  })

  it('an open Rust-bug entry is reported for HR-8', () => {
    const a = [header, rej('invalid_price'), fin]
    const b = [header, rej('invalid_size'), fin]
    const c = classifyMarket(diffTraces(a, b), kinds(a), [
      matcher({
        class: 'Rust bug',
        status: 'open',
        kind: 'order_rejected',
        pathGlob: '$.reason',
        money: 'yes',
        counterfactual: 'n/a',
      }),
    ])
    assert.equal(c.verdict.verdict, 'classified')
    assert.equal(c.openRustBug, true)
  })

  it('a matched sequence divergence is never classified: unclassified, or masked when PM-4 allows it', () => {
    // spec: 60 HR-6, PM-1 (b) (a sequence shift leaves the rest unverified), PM-4
    const a = [header, done(5), done(5), fin]
    const b = [header, rej('invalid_price'), done(5), fin]
    const d = diffTraces(a, b)
    assert.equal(d.sequenceDivergence, 1)
    const seq = { recordType: 'event' as const, kind: 'order_done', pathGlob: '$' }
    const patchEntry = matcher({ ...seq, money: 'no', counterfactual: 'patch' })
    const c = classifyMarket(d, kinds(a), [patchEntry])
    assert.equal(c.verdict.verdict, 'unclassified')
    assert.match((c.verdict as { reason: string }).reason, /PE-0001 shifts the record sequence/)
    // A field-only-declared entry cannot excuse a sequence shift either.
    assert.equal(classifyMarket(d, kinds(a), [matcher({ ...seq })]).verdict.verdict, 'unclassified')
    // CL-5 float-boundary: masked, with the identical prefix ending at the divergence.
    assert.deepEqual(
      classifyMarket(d, kinds(a), [
        matcher({ ...seq, subclass: 'float-boundary', counterfactual: 'patch' }),
      ]).verdict,
      { verdict: 'masked', entries: ['PE-0001'], divergenceIndex: 1 },
    )
    // `n/a` (no patch can express it): masked, pending the user's acceptance at G2.
    assert.equal(
      classifyMarket(d, kinds(a), [matcher({ ...seq, counterfactual: 'n/a' })]).verdict.verdict,
      'masked',
    )
  })

  it('a money = yes entry needs a counterfactual even for a field-only divergence', () => {
    // spec: 60 PM-1 (a), PM-2, PM-4
    const a = [header, done(5), fin]
    const b = [header, done(4), fin]
    const d = diffTraces(a, b)
    assert.equal(d.sequenceDivergence, null)
    const c = classifyMarket(d, kinds(a), [matcher({ money: 'yes', counterfactual: 'patch' })])
    assert.equal(c.verdict.verdict, 'unclassified')
    assert.match((c.verdict as { reason: string }).reason, /money = yes/)
    // Intended model change with money = yes is held to the same rule.
    assert.equal(
      classifyMarket(d, kinds(a), [
        matcher({ class: 'Intended model change', money: 'yes', counterfactual: 'patch' }),
      ]).verdict.verdict,
      'unclassified',
    )
  })

  it('a matcher may not declare not-required with money = yes', () => {
    // spec: 60 §3.2 counterfactual field, PM-1
    assert.throws(() => matcher({ money: 'yes', counterfactual: 'not-required' }))
  })
})
