import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'dotenv'
import { RecorderCliError } from '../cliError.js'

export const CATALOG_ENV_KEYS = [
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_USERNAME',
  'DATABASE_PASSWORD',
  'DATABASE_NAME',
  'R2_ENDPOINT',
  'R2_BUCKET',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'RECORDER_R2_PREFIX',
] as const

/** The independent catalog service receives database and archive credentials only. */
export async function loadCatalogDatabaseEnv(envFile: string): Promise<void> {
  let values: Record<string, string>
  try {
    values = parse(await readFile(envFile))
  } catch {
    throw new RecorderCliError('Cannot read the explicit catalog environment file')
  }
  for (const key of CATALOG_ENV_KEYS)
    if (process.env[key] === undefined && values[key] !== undefined) process.env[key] = values[key]
  for (const key of ['DATABASE_HOST', 'DATABASE_PORT', 'DATABASE_USERNAME', 'DATABASE_NAME'])
    if (!process.env[key]?.trim())
      throw new RecorderCliError(`Missing ${key} in catalog configuration`)
}

export function parseCatalogSyncArgs(argv: string[]) {
  const command = argv[0]
  if (command !== 'sync' && command !== 'status')
    throw new RecorderCliError('Expected sync or status')
  const result = {
    command,
    envFile: path.resolve('.env'),
    watch: false,
    maxFiles: 100,
    intervalMs: 60_000,
    prefix: 'recorder-v4',
  }
  const seen = new Set<string>()
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i]!
    if (seen.has(flag)) throw new RecorderCliError(`Duplicate ${flag}`)
    seen.add(flag)
    if (flag === '--watch') {
      result.watch = true
      continue
    }
    if (!['--env-file', '--max-files', '--interval-seconds', '--prefix'].includes(flag))
      throw new RecorderCliError('Unknown catalog sync option')
    const value = argv[++i]
    if (!value || value.startsWith('--')) throw new RecorderCliError(`Missing value for ${flag}`)
    if (flag === '--env-file') result.envFile = path.resolve(value)
    else if (flag === '--prefix') result.prefix = value
    else {
      const number = Number(value)
      if (!Number.isSafeInteger(number) || number < 1 || number > 10_000)
        throw new RecorderCliError(`Invalid ${flag}`)
      if (flag === '--max-files') result.maxFiles = number
      else {
        if (number < 30 || number > 300)
          throw new RecorderCliError('Sync interval must be between 30 and 300 seconds')
        result.intervalMs = number * 1000
      }
    }
  }
  if (command === 'status' && result.watch) throw new RecorderCliError('--watch requires sync')
  return result
}
