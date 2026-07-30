import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverProtocolStrategies } from './protocolStrategyDiscovery.js'

/**
 * Fixture-driven tests for protocol strategy discovery (protocols/README.md):
 * folder-based ownership, fail-soft loading, and deterministic conflict
 * resolution — adding a protocol must never disable another protocol's
 * existing strategies.
 */

let seq = 0
function writeStrategyAt(dir: string, name: string, id: string): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${name}.ts`)
  // Unique export per file so require() caching can never alias fixtures.
  writeFileSync(
    file,
    `export const definition = { id: ${JSON.stringify(id)}, schema: {}, create: () => ({ strategy: {} }), seq: ${seq++} }\n`,
  )
  return file
}

function writeStrategy(root: string, protocol: string, name: string, id: string): string {
  return writeStrategyAt(join(root, protocol, 'strategies'), name, id)
}

function writeModelStrategy(
  root: string,
  protocol: string,
  model: string,
  name: string,
  id: string,
): string {
  return writeStrategyAt(join(root, protocol, 'models', model, 'strategies'), name, id)
}

function withFixture(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'protocol-discovery-'))
  try {
    fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function silenced<T>(fn: () => T): T {
  const orig = console.warn
  console.warn = () => {}
  try {
    return fn()
  } finally {
    console.warn = orig
  }
}

test('registers a valid strategy with a folder-prefixed id', () => {
  withFixture((root) => {
    writeStrategy(root, 'foo', 'ok', 'foo-alpha')
    const found = discoverProtocolStrategies(root)
    assert.deepEqual(
      found.map((s) => s.def.id),
      ['foo-alpha'],
    )
  })
})

test('missing protocols root yields empty result, no throw', () => {
  const found = discoverProtocolStrategies(join(tmpdir(), 'does-not-exist-anywhere'))
  assert.deepEqual(found, [])
})

test('a broken file is skipped; other strategies in the same protocol survive', () => {
  withFixture((root) => {
    writeStrategy(root, 'foo', 'ok', 'foo-alpha')
    const dir = join(root, 'foo', 'strategies')
    writeFileSync(join(dir, 'broken.ts'), 'export const definition = { this is a syntax error\n')
    const found = silenced(() => discoverProtocolStrategies(root))
    assert.deepEqual(
      found.map((s) => s.def.id),
      ['foo-alpha'],
    )
  })
})

test('an id without the folder prefix is skipped', () => {
  withFixture((root) => {
    writeStrategy(root, 'foo', 'bad', 'bar-alpha')
    const found = silenced(() => discoverProtocolStrategies(root))
    assert.deepEqual(found, [])
  })
})

test('adding a protocol does NOT disable another protocol’s id in its "namespace"', () => {
  withFixture((root) => {
    // foo owns foo-bar-model; a protocol named foo-bar merely EXISTING (with
    // its own unrelated strategy) must not invalidate it.
    writeStrategy(root, 'foo', 'model', 'foo-bar-model')
    writeStrategy(root, 'foo-bar', 'own', 'foo-bar-own')
    const found = discoverProtocolStrategies(root)
    assert.deepEqual(
      found.map((s) => s.def.id),
      ['foo-bar-model', 'foo-bar-own'],
    )
    assert.equal(found.find((s) => s.def.id === 'foo-bar-model')?.protocol, 'foo')
  })
})

test('true id collision resolves to the namespace owner, independent of scan order', () => {
  withFixture((root) => {
    // Both define foo-bar-x; foo-bar is the longest matching prefix → owner wins,
    // even though "foo" sorts (and scans) first.
    const fooFile = writeStrategy(root, 'foo', 'squat', 'foo-bar-x')
    const ownerFile = writeStrategy(root, 'foo-bar', 'x', 'foo-bar-x')
    const found = silenced(() => discoverProtocolStrategies(root))
    const winner = found.find((s) => s.def.id === 'foo-bar-x')
    assert.equal(winner?.protocol, 'foo-bar')
    assert.equal(winner?.file, ownerFile)
    assert.notEqual(winner?.file, fooFile)
  })
})

test('same-protocol duplicate id keeps the lexicographically first file', () => {
  withFixture((root) => {
    const a = writeStrategy(root, 'foo', 'a-first', 'foo-dup')
    writeStrategy(root, 'foo', 'z-second', 'foo-dup')
    const found = silenced(() => discoverProtocolStrategies(root))
    assert.equal(found.length, 1)
    assert.equal(found[0]?.file, a)
  })
})

test('models/<model>/strategies is discovered with <protocol>-<model>- namespace', () => {
  withFixture((root) => {
    writeModelStrategy(root, 'pair', 'fable', 'e01', 'pair-fable-e01')
    const found = discoverProtocolStrategies(root)
    assert.deepEqual(
      found.map((s) => s.def.id),
      ['pair-fable-e01'],
    )
    assert.equal(found[0]?.protocol, 'pair-fable')
  })
})

test('a model strategy with only the protocol prefix is skipped (needs the model prefix)', () => {
  withFixture((root) => {
    writeModelStrategy(root, 'pair', 'fable', 'bad', 'pair-e01')
    const found = silenced(() => discoverProtocolStrategies(root))
    assert.deepEqual(found, [])
  })
})

test('model id collision with a protocol-level file resolves to the model (namespace owner)', () => {
  withFixture((root) => {
    // A protocol-level file squats a model-namespaced id; the model owns it.
    writeStrategy(root, 'pair', 'squat', 'pair-fable-x')
    const modelFile = writeModelStrategy(root, 'pair', 'fable', 'x', 'pair-fable-x')
    const found = silenced(() => discoverProtocolStrategies(root))
    const winner = found.find((s) => s.def.id === 'pair-fable-x')
    assert.equal(winner?.protocol, 'pair-fable')
    assert.equal(winner?.file, modelFile)
  })
})

test('a broken model file is skipped; sibling models survive', () => {
  withFixture((root) => {
    writeModelStrategy(root, 'pair', 'fable', 'ok', 'pair-fable-ok')
    const gptDir = join(root, 'pair', 'models', 'gpt', 'strategies')
    mkdirSync(gptDir, { recursive: true })
    writeFileSync(join(gptDir, 'broken.ts'), 'export const definition = { syntax error here\n')
    const found = silenced(() => discoverProtocolStrategies(root))
    assert.deepEqual(
      found.map((s) => s.def.id),
      ['pair-fable-ok'],
    )
  })
})

test('files without a definition export are ignored (helper scripts never loaded)', () => {
  withFixture((root) => {
    writeStrategy(root, 'foo', 'ok', 'foo-alpha')
    const dir = join(root, 'foo', 'strategies')
    writeFileSync(join(dir, 'helper.ts'), 'process.exit(97) // must never be executed\n')
    const found = discoverProtocolStrategies(root)
    assert.deepEqual(
      found.map((s) => s.def.id),
      ['foo-alpha'],
    )
  })
})
