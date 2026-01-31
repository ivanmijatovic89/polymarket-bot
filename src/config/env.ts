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
