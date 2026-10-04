import { readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import path from 'node:path'
import { parse } from 'dotenv'
import type { RecorderTimeframe } from './types.js'

export type RecorderConfig = {
  recorderId: string
  spoolDir: string
  timeframes: RecorderTimeframe[]
  upload: boolean
  archivePrefix: string
  durationMs: number | null
  maxSpoolBytes: number
  minFreeBytes: number
  maxPendingBytes: number
  redisUrl: string | null
  statusEnabled: boolean
  credentials: { apiKey: string; secret: string; passphrase: string }
  r2: {
    endpoint: string
    bucket: string
    accessKeyId: string
    secretAccessKey: string
    prefix: string
  } | null
}

export const RECORDER_HELP = `Recorder v3: BTC 5m + 15m, read-only market data capture.
Usage: npm run record:v3 -- --env-file /absolute/path/to/.env.recorder [options]
  --spool-dir PATH       Active recordings and pending uploads
  --timeframes 5m,15m    Either or both supported BTC timeframes
  --duration-seconds N   Stop cleanly after N seconds (smoke/soak tests)
  --no-upload           Keep recordings locally for validation
  --no-dashboard        Do not publish recorder status to Redis/dashboard
  --help                Show this help
Configuration is read explicitly; the trading .env loader is never imported.
`

/** Read credentials without populating process.env or importing trading configuration. */
export async function loadRecorderConfig(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<RecorderConfig> {
  const options = new Map<string, string>()
  const known = new Set(['--env-file', '--spool-dir', '--timeframes', '--duration-seconds'])
  let noUpload = false
  let noDashboard = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!
    if (arg === '--no-upload') {
      noUpload = true
      continue
    }
    if (arg === '--no-dashboard') {
      noDashboard = true
      continue
    }
    if (!known.has(arg)) throw new Error(`[recorder] unknown option ${arg}`)
    const value = argv[++i]
    if (!value || value.startsWith('--')) throw new Error(`[recorder] missing value for ${arg}`)
    if (options.has(arg)) throw new Error(`[recorder] duplicate option ${arg}`)
    options.set(arg, value)
  }
  const file = options.get('--env-file') ?? env.RECORDER_ENV_FILE ?? '.env.recorder'
  const values = parse(await readFile(path.resolve(file)))
  const get = (key: string): string | undefined => (env[key] ?? values[key])?.trim() || undefined
  const required = (...keys: string[]): string => {
    for (const key of keys) {
      const value = get(key)
      if (value) return value
    }
    throw new Error(`[recorder] missing ${keys[0]} in explicit recorder configuration`)
  }
  const positive = (name: string, value: string | undefined, fallback: number): number => {
    if (value === undefined) return fallback
    const number = Number(value)
    if (!Number.isSafeInteger(number) || number <= 0) {
      throw new Error(`[recorder] ${name} must be a positive safe integer`)
    }
    return number
  }
  const timeframeValue = options.get('--timeframes') ?? get('RECORDER_TIMEFRAMES') ?? '5m,15m'
  const timeframes = [...new Set(timeframeValue.split(',').map((value) => value.trim()))]
  if (!timeframes.length || timeframes.some((value) => value !== '5m' && value !== '15m')) {
    throw new Error('[recorder] timeframes must be 5m, 15m, or 5m,15m')
  }
  const defaultRecorderId = `${hostname()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 92)}-btc`
  const recorderId = get('RECORDER_ID') ?? defaultRecorderId
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(recorderId)) {
    throw new Error(
      '[recorder] RECORDER_ID must contain 1–96 letters, digits, hyphens or underscores',
    )
  }
  const uploadValue = get('RECORDER_UPLOAD') ?? 'true'
  if (uploadValue !== 'true' && uploadValue !== 'false') {
    throw new Error('[recorder] RECORDER_UPLOAD must be true or false')
  }
  const upload = !noUpload && uploadValue === 'true'
  const duration = options.get('--duration-seconds') ?? get('RECORDER_DURATION_SECONDS')
  const durationMs =
    duration === undefined ? null : positive('duration-seconds', duration, 0) * 1000
  if (durationMs !== null && (!Number.isSafeInteger(durationMs) || durationMs > 2_147_483_647)) {
    throw new Error(
      '[recorder] duration-seconds exceeds the supported timer range (2147483 seconds)',
    )
  }
  const prefix = get('RECORDER_R2_PREFIX') ?? 'recorder-v3'
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(prefix) ||
    prefix.includes('//') ||
    prefix.endsWith('/')
  ) {
    throw new Error('[recorder] invalid RECORDER_R2_PREFIX')
  }
  const redisUrl = get('RECORDER_REDIS_URL') ?? get('REDIS_URL') ?? null
  const statusValue = get('RECORDER_STATUS_ENABLED') ?? (redisUrl ? 'true' : 'false')
  if (statusValue !== 'true' && statusValue !== 'false')
    throw new Error('[recorder] RECORDER_STATUS_ENABLED must be true or false')
  const statusEnabled = !noDashboard && statusValue === 'true'
  if (statusEnabled && !redisUrl)
    throw new Error('[recorder] status publishing requires RECORDER_REDIS_URL or REDIS_URL')
  if (redisUrl) {
    let parsed: URL
    try {
      parsed = new URL(redisUrl)
    } catch {
      throw new Error('[recorder] invalid Redis URL')
    }
    if (!['redis:', 'rediss:'].includes(parsed.protocol) || !parsed.hostname)
      throw new Error('[recorder] invalid Redis URL')
  }
  let endpoint: string | undefined
  let bucket: string | undefined
  if (upload) {
    endpoint = required('R2_ENDPOINT')
    let parsed: URL
    try {
      parsed = new URL(endpoint)
    } catch {
      throw new Error('[recorder] invalid R2_ENDPOINT')
    }
    if (
      parsed.protocol !== 'https:' ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== '/'
    )
      throw new Error(
        '[recorder] R2_ENDPOINT must be an HTTPS service origin without credentials, path or query',
      )
    bucket = required('R2_BUCKET')
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))
      throw new Error('[recorder] invalid R2_BUCKET')
  }
  return {
    recorderId,
    spoolDir: path.resolve(
      options.get('--spool-dir') ?? get('RECORDER_SPOOL_DIR') ?? 'data/recorder-v3',
    ),
    timeframes: timeframes as RecorderTimeframe[],
    upload,
    archivePrefix: prefix,
    durationMs,
    maxSpoolBytes: positive(
      'RECORDER_MAX_SPOOL_BYTES',
      get('RECORDER_MAX_SPOOL_BYTES'),
      20 * 1024 ** 3,
    ),
    minFreeBytes: positive(
      'RECORDER_MIN_FREE_BYTES',
      get('RECORDER_MIN_FREE_BYTES'),
      20 * 1024 ** 3,
    ),
    maxPendingBytes: positive(
      'RECORDER_MAX_PENDING_BYTES',
      get('RECORDER_MAX_PENDING_BYTES'),
      16 * 1024 ** 2,
    ),
    redisUrl,
    statusEnabled,
    credentials: {
      apiKey: required('POLYMARKET_API_KEY', 'CLOB_API_KEY'),
      secret: required('POLYMARKET_API_SECRET', 'CLOB_SECRET'),
      passphrase: required('POLYMARKET_API_PASSPHRASE', 'CLOB_PASSPHRASE', 'CLOB_PASS_PHRASE'),
    },
    r2: upload
      ? {
          endpoint: endpoint!,
          bucket: bucket!,
          accessKeyId: required('R2_ACCESS_KEY_ID'),
          secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
          prefix,
        }
      : null,
  }
}
