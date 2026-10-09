/**
 * native:goldens:check (60 §7.1 GF-1..GF-4, §14.1): regenerate every golden
 * fixture into a temporary directory and fail on any content difference from
 * the committed goldens. Only `header.contentPin` is ignored (GF-4).
 *
 * Usage: npm run native:goldens:check [-- --keep-tmp]
 *
 * GENERATOR CONVENTION (generator authors MUST follow it):
 *
 * - A generator is a TS script run as `tsx <generator> --out-dir <dir> [args]`
 *   with cwd = repo root. `<dir>` replaces the golden root
 *   `native/fixtures/golden/`: the generator writes `<dir>/<area>/<file>.json`
 *   exactly where it would write `native/fixtures/golden/<area>/<file>.json`
 *   without the flag (`--out-dir` absent = regenerate the committed goldens).
 * - With `--out-dir` the generator writes ONLY under `<dir>` (no other file in
 *   the checkout may change; the checker verifies this for native/fixtures/)
 *   and reads no previous golden from `<dir>` (it is empty). It may read the
 *   committed golden to keep its `contentPin`; the checker ignores that field.
 * - Every JSON file carries `header: {contentPin, generator, generatorSha256}`
 *   (GF-2), `generator` being the repo-relative generator path.
 * - Exit code 0 on success; anything else fails the check.
 *
 * GENERATOR SELECTION: if `native/fixtures/gen/GENERATORS.txt` exists it is
 * the authoritative list: one generator per line as `<repo-relative path>
 * [extra args...]` (whitespace-separated, `#` starts a comment); a listed
 * path may live outside gen/. Otherwise every `native/fixtures/gen/*_gen.ts`
 * is a generator (helpers such as `feeds_markets.ts` or one-time slicers such
 * as `feeds_slice.ts` do not match). With a list present, an unlisted
 * `*_gen.ts` in gen/ is an error (R14: nothing is skipped silently).
 *
 * Generators run sequentially in sorted order; files and diffs are reported in
 * sorted order, so the output is deterministic.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const GOLDEN_ROOT = 'native/fixtures/golden'
export const GEN_DIR = 'native/fixtures/gen'
export const GENERATORS_LIST = 'native/fixtures/gen/GENERATORS.txt'
export const GUARDED_ROOT = 'native/fixtures'
const MAX_DIFFS_PER_FILE = 20
const MAX_VALUE_CHARS = 80

export type GeneratorSpec = { path: string; args: string[] }

/** Parses GENERATORS.txt; throws on duplicate entries. */
export function parseGeneratorList(text: string): GeneratorSpec[] {
  const specs: GeneratorSpec[] = []
  const seen = new Set<string>()
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim()
    if (line === '') return
    const [genPath = '', ...args] = line.split(/\s+/)
    const norm = path.posix.normalize(genPath)
    if (seen.has(norm)) throw new Error(`${GENERATORS_LIST}:${i + 1}: duplicate generator ${norm}`)
    seen.add(norm)
    specs.push({ path: norm, args })
  })
  return specs
}

/** True for a file name that discovery treats as a generator. */
export function isGeneratorFileName(name: string): boolean {
  return name.endsWith('_gen.ts') && !name.endsWith('.test.ts')
}

/**
 * Picks the generators: the list when present (every discovered generator
 * must be listed), else the discovered ones. Result sorted by path.
 */
export function selectGenerators(
  listText: string | null,
  discovered: readonly string[],
): GeneratorSpec[] {
  const specs =
    listText === null
      ? discovered.map((p) => ({ path: p, args: [] }))
      : parseGeneratorList(listText)
  if (listText !== null) {
    const listed = new Set(specs.map((s) => s.path))
    const unlisted = discovered.filter((p) => !listed.has(p))
    if (unlisted.length > 0) {
      throw new Error(
        `generators not listed in ${GENERATORS_LIST} (add them or rename the helper): ${unlisted.join(', ')}`,
      )
    }
  }
  return [...specs].sort((a, b) => cmp(a.path, b.path))
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Files under `root`, as sorted posix paths relative to `root`. */
export function listTree(root: string): string[] {
  if (!existsSync(root)) return []
  const out: string[] = []
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = path.join(dir, name)
      const r = rel === '' ? name : `${rel}/${name}`
      if (statSync(abs).isDirectory()) walk(abs, r)
      else out.push(r)
    }
  }
  walk(root, '')
  return out.sort(cmp)
}

export type ProducedFile = { generator: string; text: string }

/** Merges per-generator outputs; two generators writing one file is an error. */
export function mergeProduced(
  perGenerator: ReadonlyArray<{ generator: string; files: ReadonlyMap<string, string> }>,
): { files: Map<string, ProducedFile>; collisions: string[] } {
  const files = new Map<string, ProducedFile>()
  const collisions: string[] = []
  for (const { generator, files: produced } of perGenerator) {
    for (const [rel, text] of produced) {
      const prev = files.get(rel)
      if (prev) collisions.push(`${rel}: written by ${prev.generator} and ${generator}`)
      else files.set(rel, { generator, text })
    }
  }
  return { files, collisions: collisions.sort(cmp) }
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

function isObject(v: Json | undefined): v is { [k: string]: Json } {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Deep copy without `header.contentPin` (the only ignored field, GF-4). */
export function stripContentPin(doc: Json): Json {
  if (!isObject(doc) || !isObject(doc.header)) return doc
  const header = { ...doc.header }
  delete header.contentPin
  return { ...doc, header }
}

function show(v: Json | undefined): string {
  if (v === undefined) return '(absent)'
  const s = JSON.stringify(v)
  return s.length > MAX_VALUE_CHARS ? `${s.slice(0, MAX_VALUE_CHARS)}…` : s
}

function kind(v: Json | undefined): string {
  return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v
}

/** Structural differences as `path: committed -> produced` lines, in key order. */
export function diffJson(
  committed: Json | undefined,
  produced: Json | undefined,
  at = '$',
  out: string[] = [],
): string[] {
  if (kind(committed) !== kind(produced)) {
    out.push(`${at}: ${show(committed)} -> ${show(produced)}`)
  } else if (Array.isArray(committed) && Array.isArray(produced)) {
    if (committed.length !== produced.length) {
      out.push(`${at}: array length ${committed.length} -> ${produced.length}`)
    }
    const n = Math.min(committed.length, produced.length)
    for (let i = 0; i < n; i += 1) diffJson(committed[i], produced[i], `${at}[${i}]`, out)
  } else if (isObject(committed) && isObject(produced)) {
    const keys = [...new Set([...Object.keys(committed), ...Object.keys(produced)])].sort(cmp)
    for (const k of keys) {
      const sub = /^[A-Za-z_$][\w$]*$/.test(k) ? `${at}.${k}` : `${at}[${JSON.stringify(k)}]`
      if (!(k in produced)) out.push(`${sub}: ${show(committed[k])} -> (absent)`)
      else if (!(k in committed)) out.push(`${sub}: (absent) -> ${show(produced[k])}`)
      else diffJson(committed[k], produced[k], sub, out)
    }
  } else if (!Object.is(committed, produced)) {
    out.push(`${at}: ${show(committed)} -> ${show(produced)}`)
  }
  return out
}

/** Header problems of a produced golden (GF-2); empty when well formed. */
export function headerProblems(doc: Json, generator: string): string[] {
  if (!isObject(doc) || !isObject(doc.header)) return ['missing header object (GF-2)']
  const problems: string[] = []
  for (const k of ['contentPin', 'generator', 'generatorSha256']) {
    if (typeof doc.header[k] !== 'string') problems.push(`header.${k} is not a string (GF-2)`)
  }
  if (typeof doc.header.generator === 'string' && doc.header.generator !== generator) {
    problems.push(`header.generator is ${doc.header.generator}, produced by ${generator}`)
  }
  return problems
}

function pinOf(doc: Json): string | null {
  return isObject(doc) && isObject(doc.header) && typeof doc.header.contentPin === 'string'
    ? doc.header.contentPin
    : null
}

/** Text with this document's contentPin value masked, for a byte-level check. */
function maskPin(text: string, pin: string | null): string {
  return pin === null || pin === '' ? text : text.split(JSON.stringify(pin)).join('"<contentPin>"')
}

export type FileFinding = { file: string; generator?: string; problems: string[] }

export type CompareResult = {
  missing: string[]
  extra: FileFinding[]
  changed: FileFinding[]
  invalid: FileFinding[]
  collisions: string[]
  compared: number
}

/**
 * Compares produced files with the committed golden tree (both keyed by path
 * relative to the golden root). JSON files compare structurally after
 * removing `header.contentPin`, then byte-for-byte with the pin masked (so
 * formatting, key order and number spelling count too); other files compare
 * byte-for-byte.
 */
export function compareGoldens(
  produced: ReadonlyMap<string, ProducedFile>,
  committed: ReadonlyMap<string, string>,
  collisions: string[] = [],
): CompareResult {
  const result: CompareResult = {
    missing: [],
    extra: [],
    changed: [],
    invalid: [],
    collisions,
    compared: 0,
  }
  for (const file of [...committed.keys()].sort(cmp)) {
    if (!produced.has(file)) result.missing.push(file)
  }
  for (const file of [...produced.keys()].sort(cmp)) {
    const { generator, text } = produced.get(file)!
    const isJson = file.endsWith('.json')
    let doc: Json | undefined
    if (isJson) {
      try {
        doc = JSON.parse(text) as Json
      } catch (e) {
        result.invalid.push({ file, generator, problems: [`not valid JSON: ${String(e)}`] })
        continue
      }
      const problems = headerProblems(doc, generator)
      if (problems.length > 0) result.invalid.push({ file, generator, problems })
    }
    const golden = committed.get(file)
    if (golden === undefined) {
      result.extra.push({ file, generator, problems: [] })
      continue
    }
    result.compared += 1
    if (!isJson) {
      if (golden !== text) result.changed.push({ file, generator, problems: ['bytes differ'] })
      continue
    }
    let committedDoc: Json
    try {
      committedDoc = JSON.parse(golden) as Json
    } catch (e) {
      result.changed.push({ file, generator, problems: [`committed golden is not JSON: ${e}`] })
      continue
    }
    const diffs = diffJson(stripContentPin(committedDoc), stripContentPin(doc!))
    if (diffs.length === 0 && maskPin(golden, pinOf(committedDoc)) !== maskPin(text, pinOf(doc!))) {
      diffs.push('values equal but text differs (formatting, key order or number spelling)')
    }
    if (diffs.length > 0) {
      const shown = diffs.slice(0, MAX_DIFFS_PER_FILE)
      if (diffs.length > shown.length) shown.push(`… ${diffs.length - shown.length} more`)
      result.changed.push({ file, generator, problems: shown })
    }
  }
  return result
}

export function isClean(r: CompareResult): boolean {
  return (
    r.missing.length +
      r.extra.length +
      r.changed.length +
      r.invalid.length +
      r.collisions.length ===
    0
  )
}

/** Readable summary; deterministic given the result. */
export function formatReport(r: CompareResult): string {
  const lines: string[] = []
  const by = (f: FileFinding) => (f.generator ? ` (${f.generator})` : '')
  if (r.collisions.length > 0) {
    lines.push(`COLLISIONS (${r.collisions.length}):`, ...r.collisions.map((c) => `  ${c}`))
  }
  if (r.missing.length > 0) {
    lines.push(
      `MISSING: committed but not produced (${r.missing.length}):`,
      ...r.missing.map((f) => `  ${GOLDEN_ROOT}/${f}`),
    )
  }
  if (r.extra.length > 0) {
    lines.push(
      `EXTRA: produced but not committed (${r.extra.length}):`,
      ...r.extra.map((f) => `  ${GOLDEN_ROOT}/${f.file}${by(f)}`),
    )
  }
  for (const [title, list] of [
    ['INVALID', r.invalid],
    ['CHANGED', r.changed],
  ] as const) {
    if (list.length === 0) continue
    lines.push(`${title} (${list.length}):`)
    for (const f of list) {
      lines.push(`  ${GOLDEN_ROOT}/${f.file}${by(f)}`, ...f.problems.map((p) => `    ${p}`))
    }
  }
  lines.push(
    isClean(r)
      ? `goldens OK: ${r.compared} file(s) identical (header.contentPin ignored)`
      : `goldens FAILED (${r.compared} compared). Regenerate with the generator without --out-dir and review the diff.`,
  )
  return lines.join('\n')
}

function readTree(root: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const rel of listTree(root)) map.set(rel, readFileSync(path.join(root, rel), 'utf8'))
  return map
}

function treeHash(root: string): string {
  const h = createHash('sha256')
  for (const rel of listTree(root)) {
    h.update(rel + '\0')
    h.update(readFileSync(path.join(root, rel)))
    h.update('\0')
  }
  return h.digest('hex')
}

function tail(text: string, n: number): string {
  return text.trimEnd().split('\n').slice(-n).join('\n')
}

function main(): number {
  const argv = process.argv.slice(2)
  const unknown = argv.filter((a) => a !== '--keep-tmp')
  if (unknown.length > 0) throw new Error(`unknown argument(s): ${unknown.join(' ')}`)
  const keepTmp = argv.includes('--keep-tmp')
  const repoRoot = path.resolve(import.meta.dirname, '../..')
  const abs = (rel: string) => path.join(repoRoot, rel)
  const tsx = abs('node_modules/.bin/tsx')

  const discovered = existsSync(abs(GEN_DIR))
    ? readdirSync(abs(GEN_DIR))
        .filter(isGeneratorFileName)
        .map((n) => `${GEN_DIR}/${n}`)
        .sort(cmp)
    : []
  const listText = existsSync(abs(GENERATORS_LIST))
    ? readFileSync(abs(GENERATORS_LIST), 'utf8')
    : null
  const generators = selectGenerators(listText, discovered)
  for (const g of generators) {
    if (!existsSync(abs(g.path))) throw new Error(`generator not found: ${g.path}`)
  }
  console.log(
    `generators (${listText === null ? 'discovered' : GENERATORS_LIST}): ${generators.length}`,
  )

  const tmpRoot = mkdtempSync(path.join(tmpdir(), 'native-goldens-'))
  const failures: string[] = []
  const perGenerator: { generator: string; files: Map<string, string> }[] = []
  try {
    for (const [i, g] of generators.entries()) {
      const outDir = path.join(tmpRoot, String(i))
      const before = treeHash(abs(GUARDED_ROOT))
      const t0 = Date.now()
      const run = spawnSync(tsx, [g.path, '--out-dir', outDir, ...g.args], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
      })
      const secs = ((Date.now() - t0) / 1000).toFixed(1)
      if (run.status !== 0) {
        const why = run.error ? String(run.error) : `exit ${run.status ?? run.signal}`
        failures.push(`${g.path}: ${why}\n${tail(`${run.stdout}\n${run.stderr}`, 30)}`)
        console.log(`  FAIL ${g.path} (${secs}s)`)
        continue
      }
      const failed = failures.length
      if (treeHash(abs(GUARDED_ROOT)) !== before) {
        failures.push(
          `${g.path}: modified files under ${GUARDED_ROOT}/ (does it honor --out-dir?); inspect git status`,
        )
      }
      const files = readTree(outDir)
      if (files.size === 0) failures.push(`${g.path}: wrote nothing under --out-dir`)
      perGenerator.push({ generator: g.path, files })
      const status = failures.length > failed ? 'FAIL' : 'ok  '
      console.log(`  ${status} ${g.path}: ${files.size} file(s) (${secs}s)`)
    }
    const { files, collisions } = mergeProduced(perGenerator)
    const result = compareGoldens(files, readTree(abs(GOLDEN_ROOT)), collisions)
    for (const f of failures) console.error(`GENERATOR FAILED: ${f}`)
    console.log(formatReport(result))
    return failures.length === 0 && isClean(result) ? 0 : 1
  } finally {
    if (keepTmp) console.log(`kept generator output: ${tmpRoot}`)
    else rmSync(tmpRoot, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main()
  } catch (e) {
    console.error(`native:goldens:check: ${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 1
  }
}
