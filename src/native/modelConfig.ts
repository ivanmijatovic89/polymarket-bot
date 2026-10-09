/**
 * Producer-side `ModelConfig` resolution (21 §6.3, 13 §7.4): the committed
 * defaults file, the calibration sets, the CLI flags and the producer env
 * `BACKTEST_LATENCY_*` fallback, an RFC 7396 merge-patch override, then a
 * whole-object validation (generated schema, 21 §6.1 representation, 13
 * §7.3 consistency, calibration consistency). The binary applies no
 * defaults (21 §6), so everything it needs is resolved here.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { canonicalJson, CanonicalJsonError, modelConfigSha256 } from './contract/canonicalJson.js'
import type {
  Distribution,
  ExecutionConfig,
  ExecutionModels,
  FeedsConfig,
  InputMode,
  ModelConfig,
} from './contract/generated.js'
import { createContractValidators, type ContractValidators } from './contract/validate.js'
import { NativeError } from './errors.js'

/** Repository root (src/native → ../..). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** `native/contract` of this checkout (21 §3, §6.3). */
export const CONTRACT_DIR = path.join(REPO_ROOT, 'native', 'contract')

/** Defaults file of 21 §6.3: one object per profile, without `seed`. */
export const DEFAULTS_FILE = 'defaults/model-config-v1.json'

/** Largest seed: a JSON integer in `[0, 2^53 - 1]` (21 §6.2, 10 RNG-1). */
export const MAX_SEED = Number.MAX_SAFE_INTEGER

/** The calibration id that opts out of the named-set equality (21 §6.3). */
export const CUSTOM_CALIBRATION_ID = 'custom'

/**
 * Producer built-in fallback for `compatLatency` when neither a flag nor the
 * producer env sets it: delay 0, jitter 20 (21 §6.3; D58 (2): TS parity with
 * `src/cli/backtest.ts:745-750`; behavior-neutral at delay 0, 13 §5.1).
 */
export const COMPAT_LATENCY_FALLBACK = { delayMs: 0, jitterMs: 20 } as const

/** ts-compat pinned execution-model axis values (13 §7.3). */
export const TS_COMPAT_MODELS: Readonly<ExecutionModels> = {
  latency: 'compat',
  fee: 'flat_700bps_4dp',
  takerDelay: 'off',
  depletion: 'none',
  maker: 'worst_queue',
  reports: 'compat',
}

/**
 * Decimal strings of 21 §6.1 as tightened by D69 (A-03: no `-0`), at most 6
 * fractional digits (21 §18 N4).
 */
export const DECIMAL_RE = /^(0|-?(0\.[0-9]*[1-9]|[1-9][0-9]*(\.[0-9]*[1-9])?))$/

export function isDecimalString(s: string): boolean {
  if (!DECIMAL_RE.test(s)) return false
  const dot = s.indexOf('.')
  return dot < 0 || s.length - dot - 1 <= 6
}

/**
 * A JS number as a 21 §6.1 decimal string. Throws when the number is not
 * finite or needs more than 6 fractional digits (21 §18 N4): no silent
 * rounding (R14).
 */
export function numberToDecimalString(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`not a finite number: ${n}`)
  const fixed = n.toFixed(6)
  if (Number(fixed) !== n) throw new Error(`${n} has more than 6 fractional digits (21 §18 N4)`)
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
  return trimmed === '-0' ? '0' : trimmed
}

/** CLI flags that land in `ModelConfig` (20 §5.6 "Model"). */
export interface ModelConfigFlags {
  /** `--seed` (integer in `[0, 2^53 - 1]`). */
  seed?: number | string
  /** `--starting-capital` (USDC). */
  startingCapital?: number | string
  /** `--latency-delay-ms`. */
  latencyDelayMs?: number
  /** `--latency-jitter-ms`. */
  latencyJitterMs?: number
}

/** Describe capabilities the resolver checks when the producer has them (20 §3, §5.1). */
export interface ResolverCapabilities {
  modelConfigVersions: number[]
  /** `capabilities.rulesTables[].version`, in the binary's order. */
  rulesTableVersions: string[]
}

export interface ResolveModelConfigArgs {
  /** `--native-profile`; default `ts-compat` (21 §6.3). */
  profile?: string
  inputMode: InputMode
  /** The host whose market-data delay is emulated (realistic, 12 §4.5). M3b. */
  host?: string
  flags: ModelConfigFlags
  /** `--model-config-override`: an RFC 7396 merge patch, applied last (21 §6.3). */
  overrides?: Record<string, unknown>
  /** Producer env (only `BACKTEST_LATENCY_*` matters, 21 §6.3); default `process.env`. */
  env?: Readonly<Record<string, string | undefined>>
  capabilities?: ResolverCapabilities
  /** `native/contract` root; tests only. */
  contractDir?: string
}

export type ValueSource = 'flag' | 'env' | 'default'

export interface ResolvedModelConfig {
  modelConfig: ModelConfig
  modelConfigSha256: string
  /** Path (repository-relative when inside the checkout) and sha256 of every file read (13 §7.4). */
  sources: Array<{ path: string; sha256: string }>
  /** Where `compatLatency` came from (provenance; 21 §6.3 order). */
  compatLatencySource: { delayMs: ValueSource; jitterMs: ValueSource }
  /** One line per ignored producer env knob that is set (20 §5.6). */
  warnings: string[]
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** RFC 7396 JSON merge patch. */
export function applyMergePatch(target: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch
  const out: Record<string, unknown> = isPlainObject(target) ? { ...target } : {}
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k]
    else out[k] = applyMergePatch(out[k], v)
  }
  return out
}

function modelConfigError(message: string, cause = 'model_config'): NativeError {
  return new NativeError('invalid_input', cause, message)
}

class SourceReader {
  readonly sources: Array<{ path: string; sha256: string }> = []
  private readonly seen = new Set<string>()

  constructor(private readonly root: string) {}

  json(file: string): unknown {
    const abs = path.join(this.root, file)
    const bytes = readFileSync(abs)
    const rel = path.relative(REPO_ROOT, abs)
    const shown = rel.startsWith('..') ? abs : rel
    if (!this.seen.has(shown)) {
      this.seen.add(shown)
      this.sources.push({ path: shown, sha256: createHash('sha256').update(bytes).digest('hex') })
    }
    return JSON.parse(bytes.toString('utf8')) as unknown
  }

  exists(file: string): boolean {
    return existsSync(path.join(this.root, file))
  }
}

/**
 * The named feeds set (14 F-57, 21 §6.3): `calibrations/feeds/<id>.json`
 * without its `provenance`.
 */
// D-PENDING: 14 F-57 requires native/contract/calibrations/feeds/feeds-2026-07-21.json, which the contract stream has not committed yet; chose to accept the defaults file's `feeds` object as the named set when its id equals the requested id and no calibration file exists (the defaults file is recorded in `sources`).
function namedFeedsSet(
  id: string,
  reader: SourceReader,
  defaultsFeeds: FeedsConfig | undefined,
): FeedsConfig {
  const file = `calibrations/feeds/${id}.json`
  if (/^[A-Za-z0-9._-]+$/.test(id) && reader.exists(file)) {
    const raw = reader.json(file)
    if (!isPlainObject(raw)) throw modelConfigError(`${file}: not a JSON object`)
    const feeds: Record<string, unknown> = { ...raw }
    delete feeds.provenance
    if (feeds.calibrationId !== id) {
      throw modelConfigError(`${file}: calibrationId ${String(feeds.calibrationId)} != ${id}`)
    }
    return feeds as unknown as FeedsConfig
  }
  if (defaultsFeeds && defaultsFeeds.calibrationId === id) return defaultsFeeds
  throw modelConfigError(`unknown feeds calibration ${JSON.stringify(id)} (no ${file})`)
}

function parseSeed(v: number | string | undefined): number {
  if (v === undefined) return 0
  const n = typeof v === 'number' ? v : /^[0-9]+$/.test(v) ? Number(v) : Number.NaN
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_SEED) {
    throw modelConfigError(
      `--seed ${String(v)}: expected an integer in [0, 2^53 - 1] (21 §6.2)`,
      'flag',
    )
  }
  return n
}

function parseCapital(v: number | string): string {
  let s: string
  try {
    s = typeof v === 'number' ? numberToDecimalString(v) : v.trim()
  } catch (err) {
    throw modelConfigError(`--starting-capital ${String(v)}: ${(err as Error).message}`, 'flag')
  }
  if (!isDecimalString(s) || s.startsWith('-') || s === '0') {
    throw modelConfigError(
      `--starting-capital ${String(v)}: expected a positive decimal with at most 6 fractional digits (21 §6.1)`,
      'flag',
    )
  }
  return s
}

function parseLatencyMs(name: string, v: number): number {
  if (!Number.isSafeInteger(v) || v < 0) {
    throw modelConfigError(`${name} ${v}: expected a non-negative integer`, 'flag')
  }
  return v
}

/**
 * The producer env fallback of 21 §6.3. TS truncates and silently ignores
 * garbage (`Number(x) || 0`, `src/cli/backtest.ts:745-750`).
 */
// D-PENDING: 21 §6.3 says the env fallback works "as for TS runs", but TS turns an unparsable value into 0 silently; chose to fail loud on a set value that is not a non-negative integer (R14), identical to TS for every valid value.
function envLatencyMs(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): number | undefined {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return undefined
  const s = raw.trim()
  if (!/^[0-9]+$/.test(s) || !Number.isSafeInteger(Number(s))) {
    throw modelConfigError(
      `producer env ${name}=${JSON.stringify(raw)}: expected a non-negative integer`,
      'flag',
    )
  }
  return Number(s)
}

/** Producer env variables that the 20 §5.6 matrix reads for native runs. */
const NATIVE_ENV_KNOBS = new Set(['BACKTEST_LATENCY_DELAY', 'BACKTEST_LATENCY_JITTER'])

/**
 * Names of set producer env knobs that have no effect on native runs: every
 * other `BACKTEST_*` and `MAX_EVENTS_PER_DRAIN` (20 §5.6), sorted.
 */
export function ignoredNativeEnvKnobs(env: Readonly<Record<string, string | undefined>>): string[] {
  return Object.keys(env)
    .filter(
      (k) =>
        env[k] !== undefined &&
        !NATIVE_ENV_KNOBS.has(k) &&
        (k.startsWith('BACKTEST_') || k === 'MAX_EVENTS_PER_DRAIN'),
    )
    .sort()
}

/** 13 §5.1: largest `compatLatency` value (pmb-contract `COMPAT_LATENCY_MAX_MS`). */
export const COMPAT_LATENCY_MAX_MS = 600_000
/** 13 §7.3: largest realistic latency component and market-data delay. */
export const REALISTIC_LATENCY_MAX_MS = 600_000
/** 13 §7.3: largest `makerQueue.printMatchWindowMs` (pmb-contract `PRINT_MATCH_WINDOW_MAX_MS`). */
export const PRINT_MATCH_WINDOW_MAX_MS = 600_000
/** 14 §9: largest feed latency per feed. */
export const FEED_LATENCY_MAX_MS = {
  binance: 10_000,
  chainlink: 10_000,
  priceToBeat: 60_000,
} as const
/** 14 §9 calibration id (pmb-contract `CALIBRATION_ID_PATTERN`). */
export const CALIBRATION_ID_RE = /^[A-Za-z0-9._-]{1,64}$/
/** 11 §13.5 `rules-table-v<N>` (pmb-contract `is_rules_table_version`). */
export const RULES_TABLE_VERSION_RE = /^rules-table-v[1-9][0-9]{0,5}$/

/** A 21 §6.1 decimal string that is > 0. */
function positiveDecimal(s: string): boolean {
  return isDecimalString(s) && !s.startsWith('-') && s !== '0'
}

/** A 21 §6.1 decimal string in [0, 1] (13 §7.3 probabilities and shares). */
function unitDecimal(s: string): boolean {
  return isDecimalString(s) && (s === '0' || s === '1' || /^0\.[0-9]+$/.test(s))
}

/**
 * Distribution checks of pmb-contract `Distribution::validate`: uniform
 * `loMs <= hiMs`, empirical 101 non-decreasing quantiles, lognormal
 * `sigma >= 0`, and the largest value of a bounded distribution `<= max`.
 */
export function distributionProblems(what: string, d: Distribution, max: number): string[] {
  const problems: string[] = []
  let top: number | null = null
  switch (d.kind) {
    case 'constant':
      top = d.ms
      break
    case 'uniform':
      if (d.loMs > d.hiMs) problems.push(`${what}: uniform loMs > hiMs`)
      top = d.hiMs
      break
    case 'empirical':
      if (d.quantilesMs.length !== 101) problems.push(`${what}: empirical needs 101 quantiles`)
      for (let i = 1; i < d.quantilesMs.length; i++)
        if (d.quantilesMs[i - 1]! > d.quantilesMs[i]!) {
          problems.push(`${what}: quantiles must be non-decreasing`)
          break
        }
      top = d.quantilesMs.at(-1) ?? null
      break
    case 'lognormal':
      if (d.sigma.startsWith('-')) problems.push(`${what}: sigma < 0`)
      break
  }
  if (top !== null && top > max) problems.push(`${what}: value ${top} ms above ${max}`)
  return problems
}

/** The realistic-only sections of an execution object (D57). */
const REALISTIC_EXECUTION_SECTIONS = [
  'latency',
  'cancelBeforeAck',
  'makerQueue',
  'sellGate',
  'failureRates',
] as const

/**
 * Consistency of an execution object for a profile, the execution part of
 * pmb-contract `ModelConfig::validate` (21 §3: TS and Rust reject the same
 * values; 21 §6.3 refuse at submit time):
 * - ts-compat (13 §7.3, D57): the compat axis values, and none of the
 *   realistic sections (`latency`, `cancelBeforeAck`, `makerQueue`,
 *   `sellGate`, `failureRates`) before M3b;
 * - realistic (D57, 13 §7.3): every realistic section present,
 *   `reports: compat` only with `sellGate: Matched`, latency components
 *   bounded, probabilities and shares in [0, 1];
 * - both: `compatLatency` values at most `COMPAT_LATENCY_MAX_MS`.
 * Returns the problems (empty = consistent).
 */
export function executionProblems(
  profile: ModelConfig['profile'],
  execution: ExecutionConfig,
): string[] {
  const problems: string[] = []
  if (
    execution.compatLatency.delayMs > COMPAT_LATENCY_MAX_MS ||
    execution.compatLatency.jitterMs > COMPAT_LATENCY_MAX_MS
  )
    problems.push(`execution.compatLatency values above ${COMPAT_LATENCY_MAX_MS} ms`)
  if (profile === 'ts-compat') {
    for (const [axis, want] of Object.entries(TS_COMPAT_MODELS)) {
      const got = execution.models[axis as keyof ExecutionModels]
      if (got !== want)
        problems.push(`ts-compat requires execution.models.${axis} = ${want}, got ${got}`)
    }
    for (const name of REALISTIC_EXECUTION_SECTIONS)
      if (execution[name] !== undefined)
        problems.push(
          `execution.${name} is a realistic section, absent in ts-compat until M3b (D57)`,
        )
    return problems
  }
  for (const name of REALISTIC_EXECUTION_SECTIONS)
    if (execution[name] === undefined) problems.push(`realistic requires execution.${name}`)
  if (execution.models.reports === 'compat' && execution.sellGate !== 'Matched')
    problems.push(`realistic with execution.models.reports = compat requires sellGate = Matched`)
  const l = execution.latency
  if (l !== undefined) {
    if (!CALIBRATION_ID_RE.test(l.calibrationId))
      problems.push('execution.latency.calibrationId must be a non-empty id')
    for (const [name, d] of Object.entries(l.components))
      problems.push(
        ...distributionProblems(
          `execution.latency.components.${name}`,
          d,
          REALISTIC_LATENCY_MAX_MS,
        ),
      )
  }
  const r = execution.failureRates
  if (r !== undefined) {
    if (!unitDecimal(r.settlement))
      problems.push('execution.failureRates.settlement must be in [0, 1]')
    if (!unitDecimal(r.chain)) problems.push('execution.failureRates.chain must be in [0, 1]')
  }
  const q = execution.makerQueue
  if (q !== undefined) {
    if (!unitDecimal(q.cancelAheadShare))
      problems.push('execution.makerQueue.cancelAheadShare must be in [0, 1]')
    if (q.printMatchWindowMs > PRINT_MATCH_WINDOW_MAX_MS)
      problems.push(`execution.makerQueue.printMatchWindowMs above ${PRINT_MATCH_WINDOW_MAX_MS}`)
  }
  return problems
}

/**
 * The semantic rules of pmb-contract `ModelConfig::validate` beyond the
 * schema (21 §3: "Rust and TS reject the same values"; 13 §7.3, 14 §9,
 * D57): positive capital and risk limits, drain budget and open-order cap,
 * the rules-table version, feed calibration id, feed latency bounds (14 §9)
 * and constant feed latencies in ts-compat (14 F-50), `maxGapMs` 0 or
 * `>= 1000`, the execution rules of `executionProblems` and the `clock`
 * section (absent in ts-compat, required and bounded in realistic).
 * Returns the problems (empty = valid).
 */
export function modelConfigProblems(mc: ModelConfig): string[] {
  const problems: string[] = []
  if (!positiveDecimal(mc.capital.startingCapitalUsdc))
    problems.push('capital.startingCapitalUsdc must be > 0')
  for (const [name, v] of [
    ['risk.maxOrderSize', mc.risk.maxOrderSize],
    ['risk.maxAbsPosition', mc.risk.maxAbsPosition],
    ['risk.maxLossStopUsdc', mc.risk.maxLossStopUsdc],
  ] as const)
    if (!positiveDecimal(v)) problems.push(`${name} must be > 0`)
  if (!(mc.runner.maxEventsPerDrain > 0)) problems.push('runner.maxEventsPerDrain must be > 0')
  if (!(mc.risk.maxOpenOrders > 0)) problems.push('risk.maxOpenOrders must be > 0')
  if (!RULES_TABLE_VERSION_RE.test(mc.rules.rulesTableVersion))
    problems.push(`bad rulesTableVersion ${JSON.stringify(mc.rules.rulesTableVersion)}`)
  const f = mc.feeds
  if (!CALIBRATION_ID_RE.test(f.calibrationId))
    problems.push('feeds.calibrationId must be a non-empty id')
  for (const name of ['binance', 'chainlink', 'priceToBeat'] as const) {
    const d = f[name].latency
    problems.push(...distributionProblems(`feeds.${name}.latency`, d, FEED_LATENCY_MAX_MS[name]))
    if (mc.profile === 'ts-compat' && d.kind !== 'constant')
      problems.push(`ts-compat requires a constant feeds.${name}.latency (14 F-50)`)
  }
  if (f.chainlink.maxGapMs !== 0 && f.chainlink.maxGapMs < 1000)
    problems.push('feeds.chainlink.maxGapMs must be 0 or >= 1000')
  problems.push(...executionProblems(mc.profile, mc.execution))
  if (mc.profile === 'ts-compat') {
    if (mc.clock !== undefined)
      problems.push('clock is a realistic section, absent in ts-compat until M3b (D57)')
  } else if (mc.clock === undefined) problems.push('realistic requires clock')
  else {
    if (!CALIBRATION_ID_RE.test(mc.clock.marketData.calibrationId))
      problems.push('clock.marketData.calibrationId must be a non-empty id')
    problems.push(
      ...distributionProblems(
        'clock.marketData.delay',
        mc.clock.marketData.delay,
        REALISTIC_LATENCY_MAX_MS,
      ),
    )
  }
  return problems
}

const namedFeedsCache = new Map<string, string>()

let validators: ContractValidators | null = null
function contractValidators(): ContractValidators {
  validators ??= createContractValidators()
  return validators
}

/**
 * Validates a complete ModelConfig as a whole (21 §6.3): the generated
 * schema (21 §3), the 21 §6.1 representation (canonicalizable, no floats),
 * the semantic rules of pmb-contract `ModelConfig::validate`
 * (`modelConfigProblems`) and the calibration rule (the feed latencies
 * equal the named set unless its id is `custom`; 21 §6.3, 14 F-48). Throws
 * `invalid_input: model_config`.
 */
export function validateModelConfig(
  mc: unknown,
  opts: { contractDir?: string; reader?: SourceReader } = {},
): asserts mc is ModelConfig {
  const v = contractValidators()
  if (!v.modelConfig(mc)) {
    const e = v.lastErrors()[0]
    throw modelConfigError(
      `ModelConfig fails the schema: ${e ? `${e.instancePath || '/'} ${e.message ?? e.keyword}` : 'invalid'}`,
    )
  }
  try {
    canonicalJson(mc, 'strict')
  } catch (err) {
    if (err instanceof CanonicalJsonError)
      throw modelConfigError(`ModelConfig: ${err.message} (21 §6.1)`)
    throw err
  }
  const problems = modelConfigProblems(mc)
  if (problems.length > 0) throw modelConfigError(problems.join('; '))
  if (mc.feeds.calibrationId !== CUSTOM_CALIBRATION_ID) {
    const dir = opts.contractDir ?? CONTRACT_DIR
    const key = `${dir}\u0000${mc.profile}\u0000${mc.feeds.calibrationId}`
    // Committed calibration sets are immutable (21 §6.3), so a per-process
    // cache keeps the per-job check of the shim free of file reads (R8).
    let named = opts.reader === undefined ? namedFeedsCache.get(key) : undefined
    if (named === undefined) {
      const reader = opts.reader ?? new SourceReader(dir)
      const defaults = readDefaults(reader)
      named = canonicalJson(
        feedLatencies(namedFeedsSet(mc.feeds.calibrationId, reader, defaults[mc.profile]?.feeds)),
      )
      if (opts.reader === undefined) namedFeedsCache.set(key, named)
    }
    if (named !== canonicalJson(feedLatencies(mc.feeds))) {
      throw modelConfigError(
        `feed latencies differ from calibration set ${mc.feeds.calibrationId}; an override that changes them must set feeds.calibrationId = custom (21 §6.3, 14 F-48)`,
      )
    }
  }
}

/**
 * The calibrated part of a feeds object: the three latencies. 21 §6.3
 * constrains only "the `feeds` latencies" to the named set; `maxGapMs` is a
 * replay option (`0` replays stale data, 14 §10) and may be overridden
 * without `custom`.
 */
function feedLatencies(f: FeedsConfig): Record<string, Distribution> {
  return {
    binance: f.binance.latency,
    chainlink: f.chainlink.latency,
    priceToBeat: f.priceToBeat.latency,
  }
}

type DefaultsFile = Partial<Record<ModelConfig['profile'], Omit<ModelConfig, 'seed'>>>

function readDefaults(reader: SourceReader): DefaultsFile {
  const raw = reader.json(DEFAULTS_FILE)
  if (!isPlainObject(raw)) throw modelConfigError(`${DEFAULTS_FILE}: not a JSON object`)
  for (const [k, v] of Object.entries(raw)) {
    if (k !== 'ts-compat' && k !== 'realistic')
      throw modelConfigError(`${DEFAULTS_FILE}: unknown profile ${k}`)
    if (!isPlainObject(v) || 'seed' in v) {
      throw modelConfigError(`${DEFAULTS_FILE}: ${k} must be an object without seed (21 §6.3)`)
    }
  }
  return raw as DefaultsFile
}

/**
 * `resolveModelConfig` of 21 §6.3 / 13 §7.4 for a fresh submission
 * (`--extend` uses the parent row's ModelConfig verbatim and never calls
 * this). Order: defaults file of the profile, `--seed`, `--starting-capital`,
 * `compatLatency` (flags, then producer env, then 0/20), calibration sets,
 * `rulesTableVersion` from the binary's list, the merge-patch override, then
 * whole-object validation. Every failure is `invalid_input` (exit 2 at the
 * producer).
 */
export function resolveModelConfig(args: ResolveModelConfigArgs): ResolvedModelConfig {
  const reader = new SourceReader(args.contractDir ?? CONTRACT_DIR)
  const env = args.env ?? process.env
  const profile = args.profile ?? 'ts-compat'
  if (profile !== 'ts-compat' && profile !== 'realistic') {
    throw modelConfigError(
      `--native-profile ${profile}: expected ts-compat or realistic`,
      'profile',
    )
  }
  const defaults = readDefaults(reader)
  const base = defaults[profile]
  if (base === undefined) {
    // D57: the realistic defaults land with the realistic profile in M3b.
    throw modelConfigError(
      `profile ${profile} has no defaults in ${DEFAULTS_FILE} (D57: realistic lands in M3b)`,
      'profile',
    )
  }
  if (args.host !== undefined && profile === 'ts-compat') {
    throw modelConfigError(
      '--host applies only to the realistic market-data clock (12 §4.5)',
      'flag',
    )
  }
  if (
    args.inputMode !== 'telonex-delta' &&
    args.inputMode !== 'recorder-v4' &&
    args.inputMode !== 'journal'
  ) {
    throw modelConfigError(
      `input mode ${String(args.inputMode)} is not native (21 §17)`,
      'input_mode',
    )
  }

  const mc = JSON.parse(JSON.stringify(base)) as ModelConfig
  mc.seed = parseSeed(args.flags.seed)
  if (args.flags.startingCapital !== undefined) {
    mc.capital = { startingCapitalUsdc: parseCapital(args.flags.startingCapital) }
  }

  const compatLatencySource: ResolvedModelConfig['compatLatencySource'] = {
    delayMs: 'default',
    jitterMs: 'default',
  }
  if (mc.execution.models.latency === 'compat') {
    const delayFlag = args.flags.latencyDelayMs
    const jitterFlag = args.flags.latencyJitterMs
    const delayEnv = envLatencyMs(env, 'BACKTEST_LATENCY_DELAY')
    const jitterEnv = envLatencyMs(env, 'BACKTEST_LATENCY_JITTER')
    let delayMs: number = COMPAT_LATENCY_FALLBACK.delayMs
    let jitterMs: number = COMPAT_LATENCY_FALLBACK.jitterMs
    if (delayFlag !== undefined) {
      delayMs = parseLatencyMs('--latency-delay-ms', delayFlag)
      compatLatencySource.delayMs = 'flag'
    } else if (delayEnv !== undefined) {
      delayMs = delayEnv
      compatLatencySource.delayMs = 'env'
    }
    if (jitterFlag !== undefined) {
      jitterMs = parseLatencyMs('--latency-jitter-ms', jitterFlag)
      compatLatencySource.jitterMs = 'flag'
    } else if (jitterEnv !== undefined) {
      jitterMs = jitterEnv
      compatLatencySource.jitterMs = 'env'
    }
    mc.execution.compatLatency = { delayMs, jitterMs }
  } else if (args.flags.latencyDelayMs !== undefined || args.flags.latencyJitterMs !== undefined) {
    // 20 §5.6: those latencies come from execution.latency when the axis is exact.
    throw modelConfigError(
      '--latency-delay-ms/--latency-jitter-ms need execution.models.latency = compat',
      'flag',
    )
  }

  // Feeds: the named calibration set (21 §6.3, 14 F-57).
  mc.feeds = JSON.parse(
    JSON.stringify(namedFeedsSet(mc.feeds.calibrationId, reader, base.feeds)),
  ) as FeedsConfig

  if (args.capabilities) {
    if (!args.capabilities.modelConfigVersions.includes(mc.modelConfigVersion)) {
      throw modelConfigError(
        `the binary accepts modelConfigVersions ${JSON.stringify(args.capabilities.modelConfigVersions)}, not ${mc.modelConfigVersion}`,
        'version',
      )
    }
    const tables = args.capabilities.rulesTableVersions
    // D-PENDING: 21 §6.3 picks "the newest version the binary lists" without defining an order; chose the last entry of capabilities.rulesTables (the binary lists them oldest first).
    const newest = tables[tables.length - 1]
    if (newest === undefined)
      throw modelConfigError('the binary lists no rules tables (11 VR3)', 'rules_table_version')
    mc.rules = { ...mc.rules, rulesTableVersion: newest }
  }

  let resolved: unknown = mc
  if (args.overrides !== undefined) {
    for (const k of ['modelConfigVersion', 'profile', 'seed']) {
      if (k in args.overrides) {
        throw modelConfigError(
          `--model-config-override cannot set ${k}; use its flag (21 §6.3)`,
          'flag',
        )
      }
    }
    resolved = applyMergePatch(mc, args.overrides as Json)
  }

  validateModelConfig(resolved, { reader })
  const out = resolved
  if (
    args.capabilities &&
    !args.capabilities.rulesTableVersions.includes(out.rules.rulesTableVersion)
  ) {
    throw modelConfigError(
      `rules table ${out.rules.rulesTableVersion} is not compiled into the binary (11 VR3)`,
      'rules_table_version',
    )
  }
  return {
    modelConfig: out,
    modelConfigSha256: modelConfigSha256(out),
    sources: reader.sources,
    compatLatencySource,
    warnings: ignoredNativeEnvKnobs(env).map(
      (k) => `[native] producer env ${k} is set but has no effect on native runs (20 §5.6)`,
    ),
  }
}
