/**
 * Load environment variables from .env files.
 * This should be imported at the top of CLI scripts to ensure env is loaded.
 *
 * Usage:
 * - BOT_ENV=botA -> loads .env then .env.botA with override=true (bot file wins, even vs shell env)
 */
import { config } from 'dotenv'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const botEnv = (process.env.BOT_ENV ?? '').trim()
const envFiles: string[] = []
let override = false

if (botEnv) {
  const botFile = `.env.${botEnv}`
  const botPath = resolve(process.cwd(), botFile)
  if (!existsSync(botPath)) {
    throw new Error(`[env] BOT_ENV=${botEnv} but ${botFile} not found at ${botPath}`)
  }
  // With override=true, later files win; load base first, bot file last.
  envFiles.push('.env', botFile)
  override = true
} else {
  envFiles.push('.env')
}

config({ path: envFiles, ...(override ? { override: true } : {}) })

/**
 * Throws with a clear message if any of the listed env keys is missing or empty.
 * Use at the top of worker/daemon entry points to fail fast on misconfigured machines.
 */
export function requireEnv(keys: string[]): void {
  const missing = keys.filter((k) => {
    const v = process.env[k]
    return v === undefined || v === null || String(v).trim() === ''
  })
  if (missing.length > 0) {
    throw new Error(
      `[env] missing required environment variable(s): ${missing.join(', ')}.\n` +
        `Set them in .env or .env.\${BOT_ENV} before starting.`,
    )
  }
}
