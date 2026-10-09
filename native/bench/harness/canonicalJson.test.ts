import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canonicalize,
  JsonSyntaxError,
  parseJsonPreserving,
  readLiteral,
  readValue,
  resultSections,
  setDigest,
  sha256Hex,
} from './canonicalJson.js'

describe('parseJsonPreserving + canonicalize', () => {
  it('keeps number and string lexemes verbatim and sorts keys', () => {
    const text = '{ "b": 1.10, "a": [ 1e-7, -0, "x\\u00e9\\n" ], "c": {"z": null, "y": true} }'
    assert.equal(
      canonicalize(parseJsonPreserving(text)),
      '{"a":[1e-7,-0,"x\\u00e9\\n"],"b":1.10,"c":{"y":true,"z":null}}',
    )
  })

  it('keeps money tokens exact beyond f64 precision', () => {
    const text = '{"usdc": 12345678901234567.123456}'
    assert.equal(canonicalize(parseJsonPreserving(text)), '{"usdc":12345678901234567.123456}')
  })

  const bad = [
    '{"a":1,"a":2}',
    '{"a":01}',
    '[1,]',
    '{"a":1} x',
    '"\u0001"',
    '{a:1}',
    '"\\x"',
    'tru',
    '+1',
    '.5',
  ]
  for (const text of bad) {
    it(`rejects ${JSON.stringify(text)}`, () => {
      assert.throws(() => parseJsonPreserving(text), JsonSyntaxError)
    })
  }
})

const RESULT = (engineCommit: string, wallMs: number, pnl: string): string =>
  JSON.stringify({
    outputSchemaVersion: 1,
    status: 'ok',
    error: null,
    echo: { engineVersion: '1.0.0', engineCommit, strategyId: 's', seed: 0 },
    market: { slug: 'btc-updown-15m-1780925400' },
    candidates: [{ key: 'k', index: 0, status: 'ok', output: { pnlUsdc: 'PNL' } }],
    resultDigest: `digest-${engineCommit}-${pnl}`,
    diagnostics: { wallMs, inputPath: 'v1' },
  }).replace('"PNL"', pnl)

describe('resultSections', () => {
  it('ignores diagnostics in the deterministic section', () => {
    const a = resultSections(RESULT('c1', 10, '1'))
    const b = resultSections(RESULT('c1', 99, '1'))
    assert.equal(a.deterministic, b.deterministic)
    assert.ok(!a.deterministic.includes('diagnostics'))
    assert.equal(readLiteral(a.root, 'diagnostics', 'inputPath'), 'v1')
    assert.equal(readLiteral(a.root, 'status'), 'ok')
    assert.equal(readLiteral(a.root, 'missing'), undefined)
    const c = resultSections(
      '{"candidates":[{"status":"ok","n":[1,2]}],"diagnostics":{"cache":{"hits":2}}}',
    )
    assert.equal(readLiteral(c.root, 'candidates', 0, 'status'), 'ok')
    assert.equal(readLiteral(c.root, 'candidates', 1, 'status'), undefined)
    assert.equal(readLiteral(c.root, 'candidates', 'status'), undefined)
    assert.deepEqual(readValue(c.root, 'diagnostics', 'cache'), { hits: 2 })
  })

  it('drops build identity only from the cross-binary section', () => {
    const a = resultSections(RESULT('c1', 10, '1'))
    const b = resultSections(RESULT('c2', 10, '1'))
    assert.notEqual(a.deterministic, b.deterministic)
    assert.equal(a.crossBinary, b.crossBinary)
    assert.ok(a.crossBinary.includes('"strategyId":"s"'))
  })

  it('still sees a real output difference across binaries', () => {
    const a = resultSections(RESULT('c1', 10, '1'))
    const b = resultSections(RESULT('c1', 10, '2'))
    assert.notEqual(a.crossBinary, b.crossBinary)
  })

  it('requires an object with diagnostics', () => {
    assert.throws(() => resultSections('[1]'), JsonSyntaxError)
    assert.throws(() => resultSections('{"status":"ok"}'), /diagnostics/)
  })
})

describe('setDigest', () => {
  it('is independent of completion order and sensitive to content', () => {
    const e = [
      { idx: 1, candidate: 0, sha256: 'b' },
      { idx: 0, candidate: 0, sha256: 'a' },
    ]
    assert.equal(setDigest(e), setDigest([...e].reverse()))
    assert.equal(setDigest(e), sha256Hex('0\t0\ta\n1\t0\tb\n'))
    assert.notEqual(setDigest(e), setDigest([{ idx: 0, candidate: 0, sha256: 'a' }]))
  })
})
