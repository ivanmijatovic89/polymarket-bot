import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  compareGoldens,
  diffJson,
  formatReport,
  isClean,
  isGeneratorFileName,
  listTree,
  mergeProduced,
  parseGeneratorList,
  selectGenerators,
  stripContentPin,
  type ProducedFile,
} from './goldens-check.js'

const GEN = 'native/fixtures/gen/a_gen.ts'

function golden(body: object, pin = 'pin-a', generator = GEN): string {
  const doc = { ...body, header: { contentPin: pin, generator, generatorSha256: 'sha' } }
  return JSON.stringify(doc, null, 2) + '\n'
}

function produced(entries: Record<string, string>, generator = GEN): Map<string, ProducedFile> {
  return new Map(Object.entries(entries).map(([k, text]) => [k, { generator, text }]))
}

test('discovery matches *_gen.ts only', () => {
  assert.equal(isGeneratorFileName('plugins_gen.ts'), true)
  assert.equal(isGeneratorFileName('feeds_markets.ts'), false)
  assert.equal(isGeneratorFileName('feeds_slice.ts'), false)
  assert.equal(isGeneratorFileName('x_gen.test.ts'), false)
})

test('generator list: comments, args, normalization, duplicates', () => {
  const specs = parseGeneratorList(
    '# header\n\nnative/fixtures/gen/b_gen.ts --market x  # note\n./native/fixtures/decode/t_gen.ts\n',
  )
  assert.deepEqual(specs, [
    { path: 'native/fixtures/gen/b_gen.ts', args: ['--market', 'x'] },
    { path: 'native/fixtures/decode/t_gen.ts', args: [] },
  ])
  assert.throws(() => parseGeneratorList('a_gen.ts\n./a_gen.ts\n'), /duplicate/)
})

test('selection: discovery fallback sorted; list is authoritative and must cover discovery', () => {
  assert.deepEqual(
    selectGenerators(null, ['g/b_gen.ts', 'g/a_gen.ts']).map((s) => s.path),
    ['g/a_gen.ts', 'g/b_gen.ts'],
  )
  assert.deepEqual(
    selectGenerators('other/x_gen.ts\ng/a_gen.ts\n', ['g/a_gen.ts']).map((s) => s.path),
    ['g/a_gen.ts', 'other/x_gen.ts'],
  )
  assert.throws(() => selectGenerators('g/a_gen.ts\n', ['g/a_gen.ts', 'g/b_gen.ts']), /b_gen/)
})

test('only header.contentPin is ignored', () => {
  const committed = new Map([['area/x.json', golden({ v: 1 }, 'pin-old')]])
  const same = compareGoldens(produced({ 'area/x.json': golden({ v: 1 }, 'pin-new') }), committed)
  assert.equal(isClean(same), true)
  assert.equal(same.compared, 1)

  const otherSha = golden({ v: 1 }, 'pin-old').replace('"sha"', '"sha2"')
  const r = compareGoldens(produced({ 'area/x.json': otherSha }), committed)
  assert.deepEqual(r.changed[0]?.problems, ['$.header.generatorSha256: "sha" -> "sha2"'])
  // A top-level contentPin is content, not the header pin.
  assert.deepEqual(stripContentPin({ contentPin: 'p', header: { contentPin: 'q' } }), {
    contentPin: 'p',
    header: {},
  })
})

test('structural diff reports paths, types, lengths and absent keys in sorted order', () => {
  const diffs = diffJson(
    { b: [1, 2, 3], a: { x: 'u', 'odd key': 1 }, c: null },
    { b: [1, 5], a: { x: 'u', y: true }, c: 0 },
  )
  assert.deepEqual(diffs, [
    '$.a["odd key"]: 1 -> (absent)',
    '$.a.y: (absent) -> true',
    '$.b: array length 3 -> 2',
    '$.b[1]: 2 -> 5',
    '$.c: null -> 0',
  ])
})

test('missing, extra, invalid and changed files are all failures', () => {
  const committed = new Map([
    ['a/kept.json', golden({ v: 1 })],
    ['a/gone.json', golden({ v: 1 })],
    ['a/changed.json', golden({ v: [1, 2] })],
  ])
  const r = compareGoldens(
    produced({
      'a/kept.json': golden({ v: 1 }),
      'a/changed.json': golden({ v: [1, 3] }),
      'a/new.json': golden({ v: 1 }),
      'a/nohdr.json': '{"v":1}',
    }),
    committed,
  )
  assert.deepEqual(r.missing, ['a/gone.json'])
  assert.deepEqual(
    r.extra.map((f) => f.file),
    ['a/new.json', 'a/nohdr.json'],
  )
  assert.deepEqual(r.invalid, [
    { file: 'a/nohdr.json', generator: GEN, problems: ['missing header object (GF-2)'] },
  ])
  assert.deepEqual(r.changed, [
    { file: 'a/changed.json', generator: GEN, problems: ['$.v[1]: 2 -> 3'] },
  ])
  assert.equal(isClean(r), false)
  const report = formatReport(r)
  assert.match(
    report,
    /MISSING: committed but not produced \(1\):\n {2}native\/fixtures\/golden\/a\/gone\.json/,
  )
  assert.match(
    report,
    /CHANGED \(1\):\n {2}native\/fixtures\/golden\/a\/changed\.json \(native\/fixtures\/gen\/a_gen\.ts\)\n {4}\$\.v\[1\]: 2 -> 3/,
  )
  assert.match(report, /goldens FAILED/)
})

test('formatting or key-order changes fail even when values are equal', () => {
  const committed = new Map([['a/x.json', golden({ a: 1, b: 2 })]])
  const reordered = JSON.stringify(
    { header: { contentPin: 'pin-z', generator: GEN, generatorSha256: 'sha' }, b: 2, a: 1 },
    null,
    2,
  )
  const r = compareGoldens(produced({ 'a/x.json': reordered + '\n' }), committed)
  assert.equal(r.changed.length, 1)
  assert.match(r.changed[0]?.problems[0] ?? '', /text differs/)
})

test('header problems: wrong generator, bad JSON, non-JSON bytes', () => {
  const committed = new Map([
    ['a/x.json', golden({ v: 1 }, 'p', 'native/fixtures/gen/other_gen.ts')],
    ['a/notes.txt', 'abc\n'],
  ])
  const r = compareGoldens(
    produced({
      'a/x.json': golden({ v: 1 }, 'p', 'native/fixtures/gen/other_gen.ts'),
      'a/notes.txt': 'abd\n',
      'a/broken.json': '{',
    }),
    committed,
  )
  assert.deepEqual(
    r.invalid.map((f) => f.file),
    ['a/broken.json', 'a/x.json'],
  )
  assert.match(
    r.invalid[1]?.problems[0] ?? '',
    /header\.generator is native\/fixtures\/gen\/other_gen\.ts/,
  )
  assert.deepEqual(r.changed, [{ file: 'a/notes.txt', generator: GEN, problems: ['bytes differ'] }])
})

test('long diff lists are truncated', () => {
  const committed = new Map([['a/x.json', golden({ v: Array.from({ length: 30 }, () => 0) })]])
  const r = compareGoldens(
    produced({ 'a/x.json': golden({ v: Array.from({ length: 30 }, () => 1) }) }),
    committed,
  )
  assert.equal(r.changed[0]?.problems.length, 21)
  assert.equal(r.changed[0]?.problems[20], '… 10 more')
})

test('two generators writing one file is a collision', () => {
  const { files, collisions } = mergeProduced([
    { generator: 'g/a_gen.ts', files: new Map([['x/1.json', 'A']]) },
    {
      generator: 'g/b_gen.ts',
      files: new Map([
        ['x/1.json', 'B'],
        ['x/2.json', 'C'],
      ]),
    },
  ])
  assert.deepEqual(collisions, ['x/1.json: written by g/a_gen.ts and g/b_gen.ts'])
  assert.equal(files.get('x/1.json')?.generator, 'g/a_gen.ts')
  assert.equal(files.size, 2)
  const r = compareGoldens(files, new Map(), collisions)
  assert.equal(isClean(r), false)
  assert.match(formatReport(r), /COLLISIONS \(1\)/)
})

test('clean report and deterministic tree listing', () => {
  const r = compareGoldens(new Map(), new Map())
  assert.equal(isClean(r), true)
  assert.match(formatReport(r), /goldens OK: 0 file\(s\)/)

  const dir = mkdtempSync(path.join(tmpdir(), 'goldens-check-test-'))
  try {
    mkdirSync(path.join(dir, 'b'), { recursive: true })
    mkdirSync(path.join(dir, 'a'), { recursive: true })
    writeFileSync(path.join(dir, 'b', '2.json'), '')
    writeFileSync(path.join(dir, 'a', '1.json'), '')
    writeFileSync(path.join(dir, 'z.json'), '')
    assert.deepEqual(listTree(dir), ['a/1.json', 'b/2.json', 'z.json'])
    assert.deepEqual(listTree(path.join(dir, 'absent')), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
