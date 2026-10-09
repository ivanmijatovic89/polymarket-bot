/**
 * Runtime validators for the native contract (21 §3, §19 "TS shim"): Ajv's
 * JSON Schema 2020-12 class over the committed bundle
 * `native/contract/schema/v1`, plus the custom keyword `decimalScale` of
 * 21 §18 N6. A failure is `invalid_output: schema` for results and
 * `invalid_input: schema` for jobs and ModelConfigs built in TS.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { EngineJob, EngineResult, ModelConfig } from './generated.js'

const SCHEMA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../native/contract/schema/v1',
)

export interface ContractValidationError {
  instancePath: string
  keyword: string
  message?: string
}

interface AjvValidateFunction {
  (data: unknown): boolean
  errors?: ContractValidationError[] | null
}

interface AjvInstance {
  addKeyword(definition: {
    keyword: string
    type: string
    schemaType: string
    errors: boolean
    validate: (schemaValue: number, data: number) => boolean
  }): unknown
  addSchema(schema: object): unknown
  getSchema(id: string): AjvValidateFunction | undefined
}

type AjvConstructor = new (options: {
  strict: boolean
  allowUnionTypes: boolean
  allErrors: boolean
}) => AjvInstance

const require = createRequire(import.meta.url)

/**
 * Loads Ajv 8's 2020-12 class.
 *
 * D-PENDING: 21 §3 pins `ajv` 8.x as a runtime dependency in M1 step 2, but
 * package.json dependencies are outside this stream and the root `ajv` is
 * 6.x (no 2020-12 support). Until the lead pins it, the class is resolved
 * from the Ajv 8 that `ajv-formats` already depends on; the root package wins
 * as soon as it is Ajv 8.
 */
function loadAjv2020(): AjvConstructor {
  const candidates: Array<() => string> = [
    () => require.resolve('ajv/dist/2020'),
    () => createRequire(require.resolve('ajv-formats')).resolve('ajv/dist/2020'),
  ]
  for (const resolve of candidates) {
    let resolved: string
    try {
      resolved = resolve()
    } catch {
      continue
    }
    const pkg = JSON.parse(
      readFileSync(path.join(path.dirname(resolved), '..', 'package.json'), 'utf8'),
    ) as { version?: string }
    if (!pkg.version?.startsWith('8.')) continue
    const mod = require(resolved) as { default: AjvConstructor }
    return mod.default
  }
  throw new Error('native contract: Ajv 8 (ajv/dist/2020) is not installed (21 §3)')
}

/**
 * `decimalScale: k` (21 §18 N6): |x·10^k − round(x·10^k)| < 1e-6, because
 * `multipleOf` is unreliable for binary floats.
 */
export function hasDecimalScale(scale: number, x: number): boolean {
  const scaled = x * 10 ** scale
  return Math.abs(scaled - Math.round(scaled)) < 1e-6
}

export type ContractSchemaName = 'engineJob' | 'engineResult' | 'modelConfig'

export interface ContractValidators {
  engineJob(data: unknown): data is EngineJob
  engineResult(data: unknown): data is EngineResult
  modelConfig(data: unknown): data is ModelConfig
  /** Errors of the last failed call, for messages. */
  lastErrors(): ContractValidationError[]
}

/** Compiles validators for every schema of the committed bundle. */
export function createContractValidators(dir: string = SCHEMA_DIR): ContractValidators {
  const Ajv2020 = loadAjv2020()
  const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: false })
  ajv.addKeyword({
    keyword: 'decimalScale',
    type: 'number',
    schemaType: 'number',
    errors: false,
    validate: hasDecimalScale,
  })
  const ids = new Map<string, string>()
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.schema.json'))
    .sort()) {
    const schema = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as { $id?: string }
    if (typeof schema.$id !== 'string') throw new Error(`${file}: schema without $id`)
    ajv.addSchema(schema)
    ids.set(file.replace(/\.schema\.json$/, ''), schema.$id)
  }
  let errors: ContractValidationError[] = []
  const compiled = (name: ContractSchemaName): AjvValidateFunction => {
    const id = ids.get(name)
    const fn = id === undefined ? undefined : ajv.getSchema(id)
    if (!fn) throw new Error(`native contract: no ${name} schema in ${dir}`)
    return fn
  }
  const check = (fn: AjvValidateFunction, data: unknown): boolean => {
    const ok = fn(data)
    errors = ok ? [] : [...(fn.errors ?? [])]
    return ok
  }
  const job = compiled('engineJob')
  const result = compiled('engineResult')
  const config = compiled('modelConfig')
  return {
    engineJob: (data): data is EngineJob => check(job, data),
    engineResult: (data): data is EngineResult => check(result, data),
    modelConfig: (data): data is ModelConfig => check(config, data),
    lastErrors: () => errors,
  }
}
