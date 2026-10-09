/**
 * Native contract tests, TS side (21 §3 CI items 2, 4, 5 and 6; run by
 * `npm run native:test:ts`). The Rust side of the same fixtures is
 * `native/crates/pmb-contract/tests/fixtures.rs`.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

import {
  CanonicalJsonError,
  canonicalJson,
  contractSha256,
  modelConfigSha256,
} from './canonicalJson.js'
import { candidateModelConfigSha256, checkEcho, effectiveModelConfig } from './echo.js'
import { GENERATED_PATH, REPO_ROOT, generate, readBundle } from './gen.js'
import { candidateDurationMs, toEngineMarketOutput, toRunSingleMarketOutput } from './mapping.js'
import { checkMarketStatsRow, invalidMarketStatsReason } from './marketStatsRow.js'
import type { RunSingleMarketOutput } from '../../backtest/runSingleMarket.js'
import { computeMarketStats, type MarketStats } from '../../backtest/stats/marketStats.js'
import type { EngineJob, EngineResult } from './generated.js'
import { createContractValidators, hasDecimalScale } from './validate.js'

const CONTRACT_DIR = path.join(REPO_ROOT, 'native/contract')

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function jsonFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(dir, f))
}

interface Hashes {
  contractSha256: string
  modelConfigSha256: Record<string, string>
}

const hashes = readJson(path.join(CONTRACT_DIR, 'fixtures/hashes.json')) as Hashes

describe('canonical JSON (21 §6.1)', () => {
  it('sorts keys at every level and strips whitespace', () => {
    // spec: 21 §6.1 canonical JSON
    assert.equal(
      canonicalJson({ b: [3, { z: 1, a: 'x' }], a: true, B: null }),
      '{"B":null,"a":true,"b":[3,{"a":"x","z":1}]}',
    )
  })

  it('rejects floats, unsafe integers, -0 and escapes in strict mode', () => {
    // spec: 21 §6.1 representation, §18 N1/N2
    for (const bad of [{ a: 1.5 }, { a: 2 ** 53 }, { a: -0 }, { a: 'q"q' }, { a: 'é' }]) {
      assert.throws(() => canonicalJson(bad), CanonicalJsonError)
    }
  })

  it('escapes like serde_json in escaped mode and keeps keys ASCII', () => {
    // spec: 21 §3 contractSha256 (same bytes as pmb-contract canonical.rs)
    assert.equal(canonicalJson({ a: '§\u0001\n"' }, 'escaped'), '{"a":"§\\u0001\\n\\""}')
    assert.throws(() => canonicalJson({ é: 1 }, 'escaped'), CanonicalJsonError)
  })
})

describe('cross-language hashes (21 §3 CI item 6, 60 §7.2)', () => {
  it('reproduces modelConfigSha256 of every committed default ModelConfig', () => {
    // spec: 21 §6.1, D57 (only ts-compat-default.json until M3b)
    const dir = path.join(CONTRACT_DIR, 'model-configs')
    const files = jsonFiles(dir)
    assert.deepEqual(
      files.map((f) => path.basename(f)),
      Object.keys(hashes.modelConfigSha256).sort(),
    )
    for (const file of files) {
      assert.equal(
        modelConfigSha256(readJson(file)),
        hashes.modelConfigSha256[path.basename(file)],
        path.basename(file),
      )
    }
  })

  it('the defaults file plus seed 0 gives the committed default configs', () => {
    // spec: 21 §6.3 (defaults without seed), 10 RNG-1 (default seed 0), D57
    const defaults = readJson(path.join(CONTRACT_DIR, 'defaults/model-config-v1.json')) as Record<
      string,
      Record<string, unknown>
    >
    assert.deepEqual(Object.keys(defaults), ['ts-compat'])
    for (const [profile, config] of Object.entries(defaults)) {
      assert.equal(config.profile, profile)
      assert.equal(
        modelConfigSha256({ ...config, seed: 0 }),
        hashes.modelConfigSha256[`${profile}-default.json`],
      )
    }
  })

  it('reproduces contractSha256 of the committed schema bundle', () => {
    // spec: 21 §3 Schema files, 20 §3 contractSha256
    assert.equal(contractSha256(readBundle()), hashes.contractSha256)
  })
})

describe('generated TS types (21 §3 CI item 2)', () => {
  it('generated.ts equals the generator output', async () => {
    // spec: 21 §3 TS types and validators (no hand-mirrored types)
    assert.equal(readFileSync(GENERATED_PATH, 'utf8'), await generate())
  })
})

type Doc = Record<string, unknown> | unknown[]

function unescapePointer(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~')
}

function parentOf(doc: unknown, pointer: string): { parent: Doc; key: string } {
  const tokens = pointer.split('/').slice(1).map(unescapePointer)
  const key = tokens.pop()
  assert.ok(key !== undefined, `bad pointer ${pointer}`)
  let node: unknown = doc
  for (const t of tokens) {
    node = Array.isArray(node) ? node[Number(t)] : (node as Record<string, unknown>)[t]
  }
  assert.ok(node !== null && typeof node === 'object', `no parent for ${pointer}`)
  return { parent: node as Doc, key }
}

interface InvalidCase {
  name: string
  rule: string
  set?: Record<string, unknown>
  remove?: string[]
  expect: { class: string; cause: string }
  jsonSchema: 'reject' | 'accept'
}

function applyCase(base: unknown, c: InvalidCase): unknown {
  const doc = structuredClone(base)
  for (const [pointer, value] of Object.entries(c.set ?? {})) {
    const { parent, key } = parentOf(doc, pointer)
    if (Array.isArray(parent)) parent[Number(key)] = value
    else parent[key] = value
  }
  for (const pointer of c.remove ?? []) {
    const { parent, key } = parentOf(doc, pointer)
    assert.ok(!Array.isArray(parent) && key in parent, `${c.name}: nothing at ${pointer}`)
    delete (parent as Record<string, unknown>)[key]
  }
  return doc
}

describe('fixtures validate against the JSON Schema bundle (21 §3 CI item 4, §19)', () => {
  const validators = createContractValidators()
  const kinds = [
    { dir: 'jobs', validate: validators.engineJob },
    { dir: 'results', validate: validators.engineResult },
  ] as const

  for (const { dir, validate } of kinds) {
    it(`valid ${dir} fixtures pass`, () => {
      // spec: 21 §3 CI item 4 (validate in TS)
      for (const file of jsonFiles(path.join(CONTRACT_DIR, 'fixtures', dir, 'valid'))) {
        assert.ok(
          validate(readJson(file)),
          `${path.basename(file)}: ${JSON.stringify(validators.lastErrors())}`,
        )
      }
    })

    it(`invalid ${dir} cases get the documented JSON Schema verdict`, () => {
      // spec: 21 §19 (TS shim: ajv against the schema plus custom keywords)
      const casesDir = path.join(CONTRACT_DIR, 'fixtures', dir, 'invalid')
      const cases = readJson(path.join(casesDir, 'cases.json')) as {
        base: string
        cases: InvalidCase[]
      }
      const base = readJson(path.join(casesDir, cases.base))
      assert.ok(cases.cases.length >= 10)
      for (const c of cases.cases) {
        const accepted = validate(applyCase(base, c))
        assert.equal(
          accepted ? 'accept' : 'reject',
          c.jsonSchema,
          `${dir} case ${JSON.stringify(c.name)} (${c.rule})`,
        )
      }
    })
  }

  it('the committed default ModelConfig passes the modelConfig schema', () => {
    // spec: 21 §6.3 (the resolver validates against the generated schema)
    for (const file of jsonFiles(path.join(CONTRACT_DIR, 'model-configs'))) {
      assert.ok(validators.modelConfig(readJson(file)), path.basename(file))
    }
  })

  it('serve messages get the documented verdicts', () => {
    // spec: 20 §6.2 (serveIn/serveOut schemas, 20 §5.2)
    const doc = readJson(path.join(CONTRACT_DIR, 'fixtures/serve/messages.json')) as {
      in: unknown[]
      out: unknown[]
      invalidIn: Array<{ message: unknown; jsonSchema: 'reject' | 'accept' }>
      invalidOut: unknown[]
    }
    for (const msg of doc.in) {
      assert.ok(validators.serveIn(msg), JSON.stringify(validators.lastErrors()))
    }
    for (const msg of doc.out) {
      assert.ok(validators.serveOut(msg), JSON.stringify(validators.lastErrors()))
    }
    for (const c of doc.invalidIn) {
      const verdict = validators.serveIn(c.message) ? 'accept' : 'reject'
      assert.equal(verdict, c.jsonSchema, JSON.stringify(c.message))
    }
    for (const msg of doc.invalidOut) {
      assert.ok(!validators.serveOut(msg), JSON.stringify(msg))
    }
  })

  it('decimalScale accepts values at the scale and rejects finer ones', () => {
    // spec: 21 §18 N6
    assert.ok(hasDecimalScale(2, -12.35))
    assert.ok(hasDecimalScale(2, 1e9 + 0.01))
    assert.ok(hasDecimalScale(4, 0.5123))
    assert.ok(!hasDecimalScale(2, -12.345))
    assert.ok(!hasDecimalScale(4, 0.51234))
  })

  it('decimalScale is exact across the column ranges (D-PENDING N6 form)', () => {
    // spec: 21 §18 N6, §11 column ranges (|x| < 1e10 or < 1e12 at 2 dp, (0, 1) at 4 dp)
    for (const x of [2338135560.26, 154627778778.55, 1234567890.13, -9999999999.99]) {
      assert.ok(hasDecimalScale(2, x), String(x))
    }
    // A deterministic sweep of k-dp decimals parsed as JSON would parse them.
    let seed = 0x2545f491
    const next = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
      return seed
    }
    for (let i = 0; i < 20_000; i++) {
      const int = (next() % 1_000_000) * 1_000_000 + (next() % 1_000_000) // < 1e12
      const cents = next() % 100
      const x = Number(`${int}.${String(cents).padStart(2, '0')}`)
      assert.ok(hasDecimalScale(2, x), String(x))
      const ticks = 1 + (next() % 9999)
      const p = Number(`0.${String(ticks).padStart(4, '0')}`)
      assert.ok(hasDecimalScale(4, p), String(p))
      if (int < 1e9) {
        const finer = Number(`${int}.${String(cents).padStart(2, '0')}5`)
        assert.ok(!hasDecimalScale(2, finer), String(finer))
      }
    }
  })
})

describe('echo assertions (21 §12)', () => {
  const job = readJson(
    path.join(CONTRACT_DIR, 'fixtures/jobs/valid/telonex-delta-ts-compat.json'),
  ) as EngineJob
  const engineVersion = '0.1.0'

  function matchingResult(): EngineResult {
    const r = readJson(
      path.join(CONTRACT_DIR, 'fixtures/results/valid/ok-ts-compat.json'),
    ) as EngineResult
    assert.ok(r.echo && r.market)
    r.echo.modelConfigSha256 = modelConfigSha256(job.run.modelConfig)
    r.echo.strategyId = job.run.strategyId
    r.market.slug = job.market.slug
    const shas = candidateModelConfigSha256(job)
    r.candidates = r.candidates.slice(0, job.run.candidates.length).map((c, i) => ({
      ...c,
      key: job.run.candidates[i]!.key,
      index: i,
      modelConfigSha256: shas[i]!,
    }))
    return r
  }

  it('accepts a result that echoes the request', () => {
    // spec: 21 §12
    assert.equal(checkEcho(job, matchingResult(), { engineVersion }), null)
  })

  it('lets only a pre-read group error omit the echo', () => {
    // spec: 21 §10 (echo null only before the job is read), §12
    const preRead = readJson(
      path.join(CONTRACT_DIR, 'fixtures/results/valid/group-error-invalid-input.json'),
    ) as EngineResult
    assert.equal(checkEcho(job, preRead, { engineVersion }), null)
    const late = structuredClone(preRead)
    late.error = { class: 'data_defect', cause: 'upstream_hole', message: 'x' }
    assert.equal(checkEcho(job, late, { engineVersion })?.cause, 'echo_mismatch')
    const ok = matchingResult()
    ok.echo = null
    assert.equal(checkEcho(job, ok, { engineVersion })?.cause, 'echo_mismatch')
  })

  it('fails every echoed field that differs as invalid_output: echo_mismatch', () => {
    // spec: 21 §12, §19 TS shim, 20 §4.1 echo_mismatch
    const mutations: Array<[string, (r: EngineResult) => void]> = [
      ['echo.profile', (r) => (r.echo!.profile = 'realistic')],
      ['echo.seed', (r) => (r.echo!.seed = 1)],
      ['echo.rulesTableVersion', (r) => (r.echo!.rulesTableVersion = 'rules-table-v2')],
      ['echo.snapshotParserVersion', (r) => (r.echo!.snapshotParserVersion = 1)],
      ['echo.modelConfigSha256', (r) => (r.echo!.modelConfigSha256 = '0'.repeat(64))],
      ['echo.engineVersion', (r) => (r.echo!.engineVersion = '0.1.1')],
      ['market.slug', (r) => (r.market!.slug = 'btc-updown-15m-1780272900')],
      ['candidates.length', (r) => r.candidates.push({ ...r.candidates[0]!, index: 1 })],
      ['candidates[0].key', (r) => (r.candidates[0]!.key = 'other')],
      [
        'candidates[0].modelConfigSha256',
        (r) => (r.candidates[0]!.modelConfigSha256 = 'f'.repeat(64)),
      ],
    ]
    for (const [what, mutate] of mutations) {
      const r = matchingResult()
      mutate(r)
      const failure = checkEcho(job, r, { engineVersion })
      assert.ok(failure, what)
      assert.equal(failure.class, 'invalid_output')
      assert.equal(failure.cause, 'echo_mismatch')
      assert.ok(failure.message.startsWith(`${what}:`), failure.message)
    }
  })

  it('hashes a candidate execution variant as its effective ModelConfig', () => {
    // spec: 21 §1.1 effective ModelConfig, §8 C4
    const run = job.run.modelConfig
    const variant = {
      ...run.execution,
      compatLatency: { delayMs: 0, jitterMs: 0 },
    }
    assert.equal(effectiveModelConfig(run, null), run)
    assert.notEqual(modelConfigSha256(effectiveModelConfig(run, variant)), modelConfigSha256(run))
    assert.deepEqual(effectiveModelConfig(run, variant).feeds, run.feeds)
  })
})

describe('mapping to RunSingleMarketOutput (21 §11, §12)', () => {
  const result = readJson(
    path.join(CONTRACT_DIR, 'fixtures/results/valid/ok-ts-compat.json'),
  ) as EngineResult
  const stamps = {
    machineId: 'a1b2c3d4e5f6',
    workerChildId: 101,
    startedAtMs: 1791500000000,
    finishedAtMs: 1791500000210,
    durationMs: 210,
    commitSha: 'deadbeef',
  }

  it('stamps execution on non-null stats and keeps the engine fields', () => {
    // spec: 21 §11 table, §12 (execution stamped for every non-null marketStats)
    const out = result.candidates[0]!.output!
    const mapped = toRunSingleMarketOutput(out, 7, stamps)
    assert.equal(mapped.idx, 7)
    assert.equal(mapped.durationMs, 210)
    assert.deepEqual(mapped.eventsByType, { book: 1, price_change: 4823 })
    assert.equal(mapped.marketStats?.pnl, -12.35)
    assert.deepEqual(mapped.marketStats?.execution, {
      ...stamps,
      eventsProcessed: out.eventsProcessed,
      eventsByType: { book: 1, price_change: 4823 },
    })
    assert.ok(!('rules' in (mapped.marketStats ?? {})))
    const zero = toRunSingleMarketOutput(result.candidates[1]!.output!, 7, stamps)
    assert.equal(zero.skipReason, 'no_activity')
    assert.equal(zero.marketStats?.skipReason, 'no_in_window_activity')
  })

  it('fails loud on rules provenance TS cannot store yet', () => {
    // spec: 11 §13.8, R14
    const out = structuredClone(result.candidates[0]!.output!)
    out.marketStats!.rules = {
      source: 'fallback',
      rulesTableVersion: 'rules-table-v1',
      snapshotParserVersion: null,
      feeEra: 'e',
      feeCurve: 'c',
      feeSource: 's',
      unverifiedRules: [],
    }
    assert.throws(() => toRunSingleMarketOutput(out, 0, stamps))
  })

  it('splits a group span by token weight and candidate count', () => {
    // spec: 21 §12 durationMs, 40 §7.1, 41 §7.4
    assert.equal(candidateDurationMs(1000, 1210), 210)
    assert.equal(candidateDurationMs(1000, 1210, { weight: 2, candidates: 3 }), 140)
    assert.equal(candidateDurationMs(1000, 1001, { weight: 1, candidates: 3 }), 0)
    assert.throws(() => candidateDurationMs(1210, 1000))
  })
})

describe('MarketStats DB-contract check (21 §19 TS aggregator)', () => {
  const result = readJson(
    path.join(CONTRACT_DIR, 'fixtures/results/valid/ok-ts-compat.json'),
  ) as EngineResult
  const stamps = {
    machineId: 'a1b2c3d4e5f6',
    workerChildId: 101,
    startedAtMs: 0,
    finishedAtMs: 1,
    durationMs: 1,
    commitSha: 'deadbeef',
  }
  const row = () => toRunSingleMarketOutput(result.candidates[0]!.output!, 0, stamps).marketStats!

  it('accepts the rows of the valid fixture', () => {
    // spec: 21 §19, §11
    for (const c of result.candidates) {
      const stats = c.output && toRunSingleMarketOutput(c.output, 0, stamps).marketStats
      if (stats) assert.equal(checkMarketStatsRow(stats), null)
    }
  })

  it('names the field and reason of every violation', () => {
    // spec: 21 §11 ranges and quantization, §17, §18 N1/N6, §14 reason text
    const cases: Array<[string, unknown]> = [
      ['marketId', ''],
      ['finalOutcome', 'Up'],
      ['pnl', 1e10],
      ['pnl', -12.345],
      ['pnl', Number.NaN],
      ['tradeCount', -1],
      ['tradeAsTaker', 2 ** 31],
      ['feesPaid', -0.01],
      ['avgEntryPriceUp', 1],
      ['avgEntryPriceDown', 0.51234],
      ['upShares', 1e12],
      ['downShares', -1],
      ['cost', Number.POSITIVE_INFINITY],
      ['splitCost', -1],
      ['intentMeta', null],
      ['skipReason', 'no_trades'],
      ['rules', { source: 'captured' }],
    ]
    // 255 astral characters are 510 UTF-16 units but 255 varchar characters.
    assert.equal(checkMarketStatsRow({ ...row(), marketId: '\u{1F600}'.repeat(255) }), null)
    cases.push(['marketId', '\u{1F600}'.repeat(256)])
    for (const [field, value] of cases) {
      const bad = { ...row(), [field]: value } as MarketStats
      const v = checkMarketStatsRow(bad)
      assert.equal(v?.field, field, `${field}=${String(value)}`)
      assert.ok(invalidMarketStatsReason(v).startsWith(`invalid_market_stats: ${field}: `))
    }
  })
})

describe('TS-engine RunSingleMarketOutput fixtures (21 §3 CI item 5)', () => {
  const validators = createContractValidators()
  const doc = readJson(path.join(CONTRACT_DIR, 'fixtures/ts-engine/run-single-market.json')) as {
    stats: Array<{
      name: string
      eventsProcessed: number
      eventsByType: Record<string, number>
      input: Parameters<typeof computeMarketStats>[0]
    }>
    nullStats: Array<{ name: string; output: RunSingleMarketOutput }>
  }
  const stamps = {
    machineId: 'a1b2c3d4e5f6',
    workerChildId: 2,
    startedAtMs: 1791500000000,
    finishedAtMs: 1791500000300,
    durationMs: 300,
    commitSha: 'deadbeef',
  }

  /** The output runSingleMarket assembles around computeMarketStats. */
  function tsEngineOutput(s: (typeof doc.stats)[number], idx: number): RunSingleMarketOutput {
    const input = s.input
    const stats = computeMarketStats(input)
    const hasPositions = ['UP', 'DOWN'].some(
      (o) => (input.finalPositions[input.tokenMap[o]!]?.qty ?? 0) > 0,
    )
    const zero = !hasPositions && input.trades.length === 0
    const execution = {
      ...stamps,
      eventsProcessed: s.eventsProcessed,
      eventsByType: s.eventsByType,
    }
    return {
      idx,
      slug: input.slug,
      marketStats: {
        ...stats,
        ...(zero ? { skipReason: 'no_in_window_activity' as const } : {}),
        execution,
      },
      eventsProcessed: s.eventsProcessed,
      eventsByType: { ...s.eventsByType },
      durationMs: stamps.durationMs,
      ...(zero ? { skipReason: 'no_activity' as const } : {}),
    }
  }

  it('every TS-engine output validates against the EngineMarketOutput schema', () => {
    // spec: 21 §3 CI item 5, §11 (TS stamps idx, durationMs, execution, recorderV4Capture)
    assert.ok(doc.stats.length >= 3 && doc.nullStats.length >= 3)
    const outputs = [
      ...doc.stats.map((s, i) => ({ name: s.name, out: tsEngineOutput(s, i) })),
      ...doc.nullStats.map((s) => ({ name: s.name, out: s.output })),
    ]
    for (const { name, out } of outputs) {
      const engineForm = toEngineMarketOutput(out)
      assert.ok(
        validators.engineMarketOutput(engineForm),
        `${name}: ${JSON.stringify(validators.lastErrors())}`,
      )
      if (out.marketStats !== null) {
        assert.equal(checkMarketStatsRow(out.marketStats), null, name)
        // The mapping back reproduces the TS row (rules: null is ts-compat).
        assert.deepEqual(toRunSingleMarketOutput(engineForm, out.idx, stamps), out, name)
      }
    }
  })

  it('a no_slug output has no engine form', () => {
    // spec: 21 §13 (no_slug is a TS short-circuit)
    assert.throws(() =>
      toEngineMarketOutput({
        idx: 0,
        slug: null,
        marketStats: null,
        eventsProcessed: 0,
        eventsByType: {},
        durationMs: 0,
        skipReason: 'no_slug',
      }),
    )
  })
})
