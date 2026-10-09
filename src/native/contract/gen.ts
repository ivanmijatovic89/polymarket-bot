/**
 * TS type generator for the native contract (21 §3 "TS types and
 * validators"): reads the committed JSON Schema bundle
 * `native/contract/schema/v1/*.schema.json` (generated from `pmb-contract` by
 * `export-schema`) and writes `src/native/contract/generated.ts`.
 *
 *   tsx src/native/contract/gen.ts --write   # npm run native:contract:gen
 *   tsx src/native/contract/gen.ts --check   # npm run native:contract:check
 *
 * The output is a pure function of the schema files and the pinned Prettier
 * config, so `--check` (regenerate, diff) is the CI item 2 drift gate.
 *
 * D-PENDING: 21 §3 names json-schema-to-typescript as the generator; it is
 * not installed and package.json dependencies are outside this stream, so this
 * module converts the subset of JSON Schema 2020-12 that schemars emits
 * (objects, $ref/$defs, const/enum, oneOf/anyOf, nullable type arrays,
 * arrays, maps) and fails loud on anything else (R14).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import prettier from 'prettier'

import { canonicalJson } from './canonicalJson.js'

type Schema = boolean | { [key: string]: unknown }

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
export const SCHEMA_DIR = path.join(REPO_ROOT, 'native/contract/schema/v1')
export const GENERATED_PATH = path.join(REPO_ROOT, 'src/native/contract/generated.ts')

/** Committed bundle files, sorted by name (21 §3). */
export function readBundle(dir: string = SCHEMA_DIR): Array<{ name: string; schema: unknown }> {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.schema.json'))
    .sort()
    .map((name) => ({ name, schema: JSON.parse(readFileSync(path.join(dir, name), 'utf8')) }))
}

/** Keywords the generator understands; anything else fails loud. */
const KNOWN_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$defs',
  '$ref',
  'title',
  'description',
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'oneOf',
  'anyOf',
  // Validation-only keywords: no effect on the TS type.
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'decimalScale',
  // Conditional validation (21 §10 status coupling): no effect on the TS type.
  'if',
  'then',
  'else',
])

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function asObject(schema: Schema, where: string): { [key: string]: unknown } {
  if (typeof schema === 'boolean') {
    throw new Error(`${where}: boolean schema ${String(schema)} is not supported here`)
  }
  for (const key of Object.keys(schema)) {
    if (!KNOWN_KEYWORDS.has(key)) throw new Error(`${where}: unsupported keyword ${key}`)
  }
  return schema
}

function refName(ref: unknown, where: string): string {
  if (typeof ref !== 'string' || !ref.startsWith('#/$defs/')) {
    throw new Error(`${where}: unsupported $ref ${String(ref)}`)
  }
  return ref.slice('#/$defs/'.length)
}

function literal(v: unknown, where: string): string {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) {
    return JSON.stringify(v)
  }
  throw new Error(`${where}: unsupported literal ${JSON.stringify(v)}`)
}

function union(parts: string[]): string {
  const unique = [...new Set(parts)]
  return unique.length === 1 ? unique[0]! : unique.map((p) => p).join(' | ')
}

function docComment(description: unknown, indent: string): string {
  if (typeof description !== 'string' || description.length === 0) return ''
  const lines = description.replace(/\*\//g, '*\\/').split('\n')
  return `${indent}/**\n${lines.map((l) => `${indent} *${l ? ` ${l}` : ''}`).join('\n')}\n${indent} */\n`
}

function renderObject(s: { [key: string]: unknown }, where: string): string {
  const props = (s.properties ?? {}) as { [key: string]: Schema }
  const required = new Set((s.required ?? []) as string[])
  const extra = s.additionalProperties
  const lines: string[] = []
  for (const key of Object.keys(props)) {
    const prop = props[key]!
    const doc = typeof prop === 'object' ? docComment(prop.description, '') : ''
    const name = IDENTIFIER.test(key) ? key : JSON.stringify(key)
    const opt = required.has(key) ? '' : '?'
    lines.push(`${doc}${name}${opt}: ${render(prop, `${where}.${key}`)}`)
  }
  for (const key of required) {
    if (!(key in props)) throw new Error(`${where}: required ${key} has no property schema`)
  }
  if (extra === undefined || extra === true) {
    if (lines.length === 0) return '{ [key: string]: unknown }'
    throw new Error(`${where}: open object with properties is not supported (21 §3 closed objects)`)
  }
  if (extra !== false) {
    if (lines.length > 0) throw new Error(`${where}: map with fixed properties is not supported`)
    return `{ [key: string]: ${render(extra as Schema, `${where}[*]`)} }`
  }
  if (lines.length === 0) return 'Record<string, never>'
  return `{\n${lines.join('\n')}\n}`
}

function renderType(t: string, s: { [key: string]: unknown }, where: string): string {
  switch (t) {
    case 'string':
      return 'string'
    case 'integer':
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'null':
      return 'null'
    case 'array': {
      const item = render((s.items ?? true) as Schema, `${where}[]`)
      return /^[A-Za-z0-9_]+$/.test(item) ? `${item}[]` : `Array<${item}>`
    }
    case 'object':
      return renderObject(s, where)
    default:
      throw new Error(`${where}: unsupported type ${t}`)
  }
}

/** TS type expression of a schema. */
function render(schema: Schema, where: string): string {
  if (schema === true) return 'unknown'
  const s = asObject(schema, where)
  if ('$ref' in s) return refName(s.$ref, where)
  if ('const' in s) return literal(s.const, where)
  if ('enum' in s) {
    return union((s.enum as unknown[]).map((v) => literal(v, where)))
  }
  const alternatives = (s.oneOf ?? s.anyOf) as Schema[] | undefined
  if (alternatives) {
    return union(alternatives.map((a, i) => render(a, `${where}|${i}`)))
  }
  if (Array.isArray(s.type)) {
    return union((s.type as string[]).map((t) => renderType(t, s, where)))
  }
  if (typeof s.type === 'string') return renderType(s.type, s, where)
  if (Object.keys(s).every((k) => k === 'description')) return 'unknown'
  throw new Error(`${where}: schema without type`)
}

/** A root schema as a plain definition (bundle keywords removed). */
function stripRoot(schema: Schema): Schema {
  if (typeof schema === 'boolean') return schema
  return Object.fromEntries(
    Object.entries(schema).filter(([k]) => !['$schema', '$id', '$defs', 'title'].includes(k)),
  )
}

function declaration(name: string, schema: Schema): string {
  const s = asObject(schema, name)
  const doc = docComment(s.description, '')
  const body = render(s, name)
  const isInterface = s.type === 'object' && s.properties !== undefined && !('oneOf' in s)
  if (isInterface) return `${doc}export interface ${name} ${body}\n`
  return `${doc}export type ${name} = ${body}\n`
}

/** Generates the TS module text (Prettier-formatted) from the bundle. */
export async function generate(dir: string = SCHEMA_DIR): Promise<string> {
  const named = new Map<string, Schema>()
  const add = (name: string, raw: Schema, from: string) => {
    const schema = stripRoot(raw)
    const prev = named.get(name)
    if (prev !== undefined && canonicalJson(prev, 'escaped') !== canonicalJson(schema, 'escaped')) {
      throw new Error(`${from}: $defs/${name} differs from another bundle file`)
    }
    named.set(name, schema)
  }
  const roots: string[] = []
  for (const { name, schema } of readBundle(dir)) {
    const root = asObject(schema as Schema, name)
    const title = root.title
    if (typeof title !== 'string' || !IDENTIFIER.test(title)) {
      throw new Error(`${name}: root schema needs an identifier title`)
    }
    roots.push(`${title} (${name})`)
    for (const [defName, def] of Object.entries((root.$defs ?? {}) as { [k: string]: Schema })) {
      add(defName, def, name)
    }
    add(title, root, name)
  }
  const header = [
    '// Generated by `npm run native:contract:gen` from native/contract/schema/v1',
    '// (21 §3). Do not edit: change pmb-contract, then regenerate.',
    `// Roots: ${roots.join(', ')}.`,
    '',
  ].join('\n')
  const body = [...named.keys()]
    .sort()
    .map((name) => declaration(name, named.get(name)!))
    .join('\n')
  const options = (await prettier.resolveConfig(GENERATED_PATH)) ?? {}
  return prettier.format(`${header}\n${body}`, {
    ...options,
    parser: 'typescript',
    filepath: GENERATED_PATH,
  })
}

async function main(argv: string[]): Promise<number> {
  const mode = argv[0]
  if (argv.length !== 1 || (mode !== '--write' && mode !== '--check')) {
    console.error('usage: tsx src/native/contract/gen.ts --write | --check')
    return 2
  }
  const text = await generate()
  if (mode === '--write') {
    writeFileSync(GENERATED_PATH, text)
    return 0
  }
  let committed = ''
  try {
    committed = readFileSync(GENERATED_PATH, 'utf8')
  } catch {
    committed = ''
  }
  if (committed !== text) {
    console.error(
      `${path.relative(REPO_ROOT, GENERATED_PATH)} is stale: run npm run native:contract:gen and commit`,
    )
    return 1
  }
  console.error('native contract: generated.ts is up to date')
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err)
      process.exit(1)
    },
  )
}
