import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  compareTsTraces,
  computeTotals,
  renderSummary,
  type MarketEntry,
  type ParityManifest,
} from './manifest.js'
import { patchSetSha256 } from './oracleTree.js'

const entry = (slug: string, over: Partial<MarketEntry> = {}): MarketEntry => ({
  slug,
  inputs: { market: null, feedFiles: [], missing: [] },
  ts: { ok: true, durationMs: 1, traceSha256: `h-${slug}` },
  verdict: null,
  ...over,
})

const manifest = (markets: MarketEntry[], tree: 'head' | 'pin' = 'head'): ParityManifest =>
  ({
    format: 'pmb-parity-manifest',
    version: 1,
    cell: { name: 'T15-on', sha256: 'c' },
    gating: false,
    nonGatingReasons: ['x'],
    oracle: { pin: 'p', head: 'h', oracleTreeClean: true, oracleEnvSha256: 'e', tree },
    traceFormat: 'pmb-parity-trace/2',
    diffRulesVersion: 2,
    tolerance: null,
    modelConfigSha256: 'm',
    marketSet: { name: 'S15-CL', sha256: 's', size: 214, selected: markets.length },
    rust: null,
    markets,
    totals: computeTotals(markets),
    coverage: { exerciser: null },
  }) as unknown as ParityManifest

describe('manifest, totals and summary (60 HR-7, §3.1, §15.2)', () => {
  it('totals count every verdict class and TS failures', () => {
    const t = computeTotals([
      entry('a', { verdict: { verdict: 'identical' } }),
      entry('b', { verdict: { verdict: 'classified', entries: ['PE-0001'] } }),
      entry('c', { verdict: { verdict: 'unclassified', reason: 'r' } }),
      entry('d', {
        ts: { ok: false, durationMs: 0 },
        verdict: { verdict: 'excluded', reason: 'ts_failed' },
      }),
      entry('e'),
    ])
    assert.deepEqual(t, {
      markets: 5,
      identical: 1,
      identicalPatched: 0,
      classified: 1,
      masked: 0,
      unclassified: 1,
      excluded: 1,
      tsFailed: 1,
      pending: 1,
    })
  })

  it('the summary renders the PARITY.md matrix row with the manifest sha256', () => {
    const md = renderSummary([
      {
        file: '/x/manifest.json',
        sha256: 'abcdef0123456789',
        manifest: manifest([entry('a', { verdict: { verdict: 'identical' } })]),
      },
    ])
    assert.ok(
      md.includes(
        '| Cell | Markets | Identical | Identical (patched) | Classified | Masked | Unclassified | Excluded | Manifest |',
      ),
    )
    assert.ok(
      md.includes(
        '| T15-on (non-gating) | 1 | 1 | 0 | 0 | 0 | 0 | 0 | manifest.json `abcdef012345` |',
      ),
    )
    assert.ok(md.includes('manifest sha256: `abcdef0123456789`'))
  })

  it('TS self-parity compares TS trace bytes per market (OR-17)', () => {
    const a = manifest([entry('a'), entry('b')])
    const b = manifest(
      [entry('a'), entry('b', { ts: { ok: true, durationMs: 1, traceSha256: 'other' } })],
      'pin',
    )
    assert.deepEqual(
      compareTsTraces(a, b).map((r) => [r.slug, r.identical]),
      [
        ['a', true],
        ['b', false],
      ],
    )
  })

  it('the patch-set hash is null without patches (OR-12)', () => {
    assert.equal(patchSetSha256([]), null)
  })
})
