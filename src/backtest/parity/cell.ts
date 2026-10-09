import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as z from 'zod'

/**
 * Parity cell files `native/parity/cells/<cell>.json` (60 §4.1, HR-1) and the
 * pinned oracle environment derived from them (60 OR-7, HR-3).
 */

/** Repository root of this checkout (src/backtest/parity → ../../..). */
export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
)

/** 01 §6 M1 / 00 §5 "Data roots": `--data-root` defaults to `<repository root>/data`. */
export const DEFAULT_DATA_ROOT = path.join(REPO_ROOT, 'data')

const decimalString = z
  .string()
  .regex(/^-?(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$/, 'decimal string (21 §6.1)')
const constantLatency = z.strictObject({
  kind: z.literal('constant'),
  ms: z.number().int().nonnegative(),
})

/**
 * The ModelConfig fields the harness reads (21 §6). The full contract is
 * validated by the `src/native/` contract module; here every field the
 * oracle environment or the TS job depends on is checked strictly.
 */
// D-PENDING: full ModelConfig validation belongs to src/native (generated contract types, 21 §3); chose to validate strictly only the fields the harness maps (OR-7 knobs, capital, latency, profile) and keep the rest verbatim.
const ModelConfigSchema = z.looseObject({
  modelConfigVersion: z.literal(1),
  profile: z.enum(['ts-compat', 'realistic']),
  seed: z.number().int().nonnegative(),
  capital: z.strictObject({ startingCapitalUsdc: decimalString }),
  execution: z.looseObject({
    compatLatency: z.strictObject({
      delayMs: z.number().int().nonnegative(),
      // 60 OR-6 / 21 §6.1: ts-compat parity runs use zero jitter.
      jitterMs: z.literal(0),
    }),
  }),
  feeds: z.looseObject({
    calibrationId: z.string(),
    binance: z.strictObject({ latency: constantLatency }),
    chainlink: z.strictObject({
      latency: constantLatency,
      maxGapMs: z.number().int().nonnegative(),
    }),
    priceToBeat: z.strictObject({ latency: constantLatency }),
  }),
  runner: z.strictObject({ maxEventsPerDrain: z.number().int().positive() }),
})

export type CellModelConfig = z.infer<typeof ModelConfigSchema>

const StrategyRefSchema = z.union([
  z.strictObject({ id: z.string().min(1) }),
  z.strictObject({ artifactSha256: z.string().regex(/^[0-9a-f]{64}$/) }),
])

export const CellSchema = z.strictObject({
  /** Cell name; equals the file basename. */
  cell: z.string().regex(/^[A-Za-z0-9-]+$/),
  /** Milestone and gating status (60 §4.1). */
  milestone: z.string(),
  gating: z.boolean(),
  /** Market set name; slugs in `native/parity/sets/<set>.txt` (MS-1). */
  set: z.string().regex(/^[A-Za-z0-9-]+$/),
  /** Optional cap on the number of set markets (e.g. F15-TA: 50 markets of S15-CL). */
  marketLimit: z.number().int().positive().optional(),
  profile: z.literal('ts-compat'),
  traceLevel: z.enum(['decisions', 'feeds']),
  inputMode: z.literal('telonex-delta'),
  /** 60 MS-5: gating runs read only local inputs. */
  readFrom: z.literal('local'),
  /** TS strategy identity: registry id or artifact sha (HR-1). */
  tsStrategy: StrategyRefSchema,
  /** Rust strategy id; `EngineJob.run.strategyId` equals it (HR-1, 21 §5.1, D20). */
  rustStrategyId: z.string().regex(/\.rs$/),
  /** Params source (HR-1). L15 cells (M2) add the params run id and inherited allowance. */
  params: z.strictObject({
    source: z.literal('inline'),
    values: z.record(z.string(), z.unknown()),
  }),
  /** Only the TA cell waits for TechnicalIndicators (OR-7 table, OR-10). */
  waitForTechnicalIndicators: z.boolean(),
  modelConfig: ModelConfigSchema,
})

export type ParityCell = z.infer<typeof CellSchema>

/** Load and validate a cell file; unknown fields are errors (R14). */
export function loadCell(file: string): ParityCell {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown
  const parsed = CellSchema.safeParse(raw)
  if (!parsed.success) throw new Error(`invalid cell ${file}: ${z.prettifyError(parsed.error)}`)
  const cell = parsed.data
  const base = path.basename(file, '.json')
  if (cell.cell !== base) throw new Error(`cell ${file}: "cell" is ${cell.cell}, expected ${base}`)
  if (cell.modelConfig.profile !== cell.profile)
    throw new Error(
      `cell ${file}: modelConfig.profile ${cell.modelConfig.profile} != profile ${cell.profile}`,
    )
  return cell
}

/** Canonical JSON (21 §6.1): keys sorted bytewise at every level, arrays kept, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value))
      throw new Error(`canonical JSON allows only safe integers, got ${value}`)
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort((a, b) =>
        Buffer.from(a) < Buffer.from(b) ? -1 : Buffer.from(a) > Buffer.from(b) ? 1 : 0,
      )
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
  }
  throw new Error(`canonical JSON: unsupported value ${String(value)}`)
}

/**
 * Sorted-key JSON for hashing tooling data that may hold floats (cache keys,
 * oracleEnv): like `canonicalJson` but numbers use JS shortest round-trip
 * formatting. Not the 21 §6.1 ModelConfig form.
 */
export function canonicalJsonLoose(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new Error(`canonical JSON: non-finite ${value}`)
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJsonLoose).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJsonLoose(obj[k])}`).join(',')}}`
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** `modelConfigSha256` = sha256 of the canonical UTF-8 bytes (21 §6.1). */
export function modelConfigSha256(modelConfig: unknown): string {
  return sha256Hex(canonicalJson(modelConfig))
}

/** Engine constants of the OR-7 table that are not ModelConfig fields (14 F-47 lookbacks, the WebUI depth cap). */
export const ORACLE_CONSTANTS = {
  BACKTEST_BINANCE_FEED_LOOKBACK_MS: '300000',
  BACKTEST_RTDS_CHAINLINK_LOOKBACK_MS: '300000',
  WEB_UI_ORDERBOOK_LEVELS: '10',
} as const

/** Environment variables passed through from the parent (60 OR-7). */
export const ORACLE_PASSTHROUGH = ['PATH', 'HOME'] as const

/**
 * The pinned TS oracle environment of a cell (60 OR-7, HR-3): an allowlist
 * (`PATH`, `HOME`, `TZ=UTC`, data-root variables) plus every
 * result-affecting knob set explicitly from the cell's ModelConfig. `BOT_ENV`
 * is never set. Latency and capital travel in the job, not here.
 */
export function buildOracleEnv(
  cell: ParityCell,
  dataRoot: string,
  parent: NodeJS.ProcessEnv,
): Record<string, string> {
  const mc = cell.modelConfig
  const env: Record<string, string> = {}
  for (const k of ORACLE_PASSTHROUGH) {
    const v = parent[k]
    if (v !== undefined) env[k] = v
  }
  env.TZ = 'UTC'
  env.BINANCE_DATA_BASE_DIR = path.join(dataRoot, 'binance')
  env.TELONEX_CRYPTO_PRICES_BASE_DIR = path.join(dataRoot, 'telonex', 'crypto_prices')
  env.BACKTEST_BINANCE_FEED_LATENCY_MS = String(mc.feeds.binance.latency.ms)
  env.BACKTEST_BINANCE_FEED_LOOKBACK_MS = ORACLE_CONSTANTS.BACKTEST_BINANCE_FEED_LOOKBACK_MS
  env.BACKTEST_RTDS_CHAINLINK_LATENCY_MS = String(mc.feeds.chainlink.latency.ms)
  env.BACKTEST_RTDS_CHAINLINK_LOOKBACK_MS = ORACLE_CONSTANTS.BACKTEST_RTDS_CHAINLINK_LOOKBACK_MS
  env.BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS = String(mc.feeds.chainlink.maxGapMs)
  env.BACKTEST_PRICE_TO_BEAT_LATENCY_MS = String(mc.feeds.priceToBeat.latency.ms)
  env.MAX_EVENTS_PER_DRAIN = String(mc.runner.maxEventsPerDrain)
  env.WEB_UI_ORDERBOOK_LEVELS = ORACLE_CONSTANTS.WEB_UI_ORDERBOOK_LEVELS
  // D-PENDING: OR-7 sets BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS to `1` "only in the TA cell" without a value for the others; chose an explicit `0` so a `.env` value cannot leak in (dotenv never overrides a set variable).
  env.BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS = cell.waitForTechnicalIndicators ? '1' : '0'
  return env
}

/** Every variable name the oracle environment may contain (used by the env audit, OR-7). */
export const ORACLE_ENV_KEYS: readonly string[] = [
  ...ORACLE_PASSTHROUGH,
  'TZ',
  'BINANCE_DATA_BASE_DIR',
  'TELONEX_CRYPTO_PRICES_BASE_DIR',
  'BACKTEST_BINANCE_FEED_LATENCY_MS',
  'BACKTEST_BINANCE_FEED_LOOKBACK_MS',
  'BACKTEST_RTDS_CHAINLINK_LATENCY_MS',
  'BACKTEST_RTDS_CHAINLINK_LOOKBACK_MS',
  'BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS',
  'BACKTEST_PRICE_TO_BEAT_LATENCY_MS',
  'MAX_EVENTS_PER_DRAIN',
  'WEB_UI_ORDERBOOK_LEVELS',
  'BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS',
  // Read only when the TA cell waits (StrategyRunner.ts:404-417); TS defaults apply.
  'BACKTEST_TECH_IND_TIMEOUT_MS',
  'BACKTEST_TECH_IND_POLL_MS',
]

/** Starting capital (USDC number for the TS job) from the cell only (OR-7: no env fallback). */
export function cellStartingCapital(cell: ParityCell): number {
  const n = Number(cell.modelConfig.capital.startingCapitalUsdc)
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`cell ${cell.cell}: invalid capital.startingCapitalUsdc`)
  return n
}

/** Read a committed market set (MS-1): one slug per line, `#` comments. */
export function readMarketSet(file: string): string[] {
  const slugs = readFileSync(file, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'))
  const seen = new Set<string>()
  for (const s of slugs) {
    if (!/^btc-updown-(5m|15m)-[0-9]{10}$/.test(s)) throw new Error(`${file}: invalid slug ${s}`)
    if (seen.has(s)) throw new Error(`${file}: duplicate slug ${s}`)
    seen.add(s)
  }
  return slugs
}
