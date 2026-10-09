/**
 * Golden generator (60 §7.1 GF-1/GF-2) for the PG-1 rehearsal of
 * `tests/ts_normalization.rs` (30 §9 rule 9): the Zod-normalized params of
 * `overnight-opus55-lagsnipe.v15`, `JSON.stringify(definition.schema.parse(input))`
 * on the readable oracle bundle of artifact 304eceb3…ab8 (D40, 60 §6.2),
 * for the defaults and for one set input given as CLI strings and as typed
 * JSON. The bundle is read, never modified.
 *
 * Usage: npx tsx native/crates/pmb-sdk/tests/fixtures/lagsnipe_params_gen.ts [bundle path]
 * (default: data/strategy-artifacts/304eceb3…ab8.mjs of this checkout)
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ARTIFACT = '304eceb346bdd813d3acda0f5fac38b657237bed8195352b5346c330f6d78ab8'
const repoRoot = path.resolve(import.meta.dirname, '../../../../..')
const bundle = path.resolve(repoRoot, process.argv[2] ?? `data/strategy-artifacts/${ARTIFACT}.mjs`)
const bundleSha256 = createHash('sha256').update(readFileSync(bundle)).digest('hex')
if (bundleSha256 !== ARTIFACT) throw new Error(`${bundle} is not artifact ${ARTIFACT}`)

type Schema = { parse: (input: unknown) => unknown }
const mod = (await import(pathToFileURL(bundle).href)) as { definition: { schema: Schema } }
const parse = (input: Record<string, unknown>): string =>
  JSON.stringify(mod.definition.schema.parse(input))

const set = {
  stakeMinUsd: 12,
  maxTrades: 5,
  sigma: 2e-4,
  minPrice: 0.15,
  absEdge: -0.5,
  lookbackMs: 1500,
}
const setCli = Object.fromEntries(Object.entries(set).map(([k, v]) => [k, String(v)]))

const generator = 'native/crates/pmb-sdk/tests/fixtures/lagsnipe_params_gen.ts'
const zodVersion = (
  JSON.parse(readFileSync(path.join(repoRoot, 'node_modules/zod/package.json'), 'utf8')) as {
    version: string
  }
).version
const out = {
  header: {
    contentPin: execSync('git rev-parse HEAD', { cwd: repoRoot }).toString().trim(),
    generator,
    generatorSha256: createHash('sha256')
      .update(readFileSync(path.join(repoRoot, generator)))
      .digest('hex'),
  },
  artifact: ARTIFACT,
  normalized: {
    defaults: parse({}),
    setCli: parse(setCli),
    setTyped: parse(set),
  },
  spec: 'native-spec-g1 30 §9 rules 9-10; 60 §6.4 LS-4',
  zodVersion,
}
writeFileSync(
  path.join(import.meta.dirname, 'lagsnipe_params_golden.json'),
  JSON.stringify(out, null, 2) + '\n',
)
console.log(`lagsnipe params golden: zod ${zodVersion}`)
