/**
 * Native contract tests, TS side (21 §3 CI items 2, 4 and 6; run by
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
import { GENERATED_PATH, REPO_ROOT, generate, readBundle } from './gen.js'
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

  it('decimalScale accepts values at the scale and rejects finer ones', () => {
    // spec: 21 §18 N6
    assert.ok(hasDecimalScale(2, -12.35))
    assert.ok(hasDecimalScale(2, 1e9 + 0.01))
    assert.ok(hasDecimalScale(4, 0.5123))
    assert.ok(!hasDecimalScale(2, -12.345))
    assert.ok(!hasDecimalScale(4, 0.51234))
  })
})
