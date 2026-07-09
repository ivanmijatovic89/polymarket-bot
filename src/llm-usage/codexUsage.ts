/**
 * OpenAI Codex CLI rate-limit usage (5h window + weekly window).
 *
 * Source value in accounts.json is "codex" (the Codex CLI login on this
 * machine, ~/.codex/auth.json) or "codex:<dir>" for a different CODEX_HOME.
 *
 * Reads the ChatGPT OAuth tokens Codex stores in auth.json, refreshing them
 * via auth.openai.com when expired. Uses the same internal endpoint as the
 * `/status` command in Codex (chatgpt.com/backend-api/wham/usage) — if this
 * breaks someday, the endpoint shape likely changed.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AccountUsage, RateLimitWindow } from './types'

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const TOKEN_URL = 'https://auth.openai.com/oauth/token'
// Codex CLI's public OAuth client id (same for everyone)
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

interface CodexAuth {
  tokens: {
    access_token: string
    refresh_token: string
    account_id: string
    [key: string]: unknown
  }
  last_refresh?: string
  [key: string]: unknown
}

function jwtExpiryMs(jwt: string): number {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString())
    return (payload.exp as number) * 1000
  } catch {
    return 0 // unreadable -> treat as expired
  }
}

async function codexToken(codexHome: string): Promise<{ token: string; accountId: string }> {
  const authFile = path.join(codexHome.replace(/^~/, os.homedir()), 'auth.json')
  if (!existsSync(authFile)) {
    throw new Error(`${authFile} not found — log in once with the codex CLI`)
  }
  const auth: CodexAuth = JSON.parse(readFileSync(authFile, 'utf8'))
  const { tokens } = auth
  if (Date.now() < jwtExpiryMs(tokens.access_token) - 60_000) {
    return { token: tokens.access_token, accountId: tokens.account_id }
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: CLIENT_ID,
      scope: 'openid profile email',
    }),
  })
  if (!res.ok) {
    throw new Error(`token refresh failed (HTTP ${res.status}) — run codex once to log in again`)
  }
  const fresh = (await res.json()) as {
    access_token: string
    refresh_token?: string
    id_token?: string
  }
  tokens.access_token = fresh.access_token
  if (fresh.refresh_token) tokens.refresh_token = fresh.refresh_token
  if (fresh.id_token) tokens.id_token = fresh.id_token
  auth.last_refresh = new Date().toISOString()
  writeFileSync(authFile, JSON.stringify(auth, null, 2))
  return { token: tokens.access_token, accountId: tokens.account_id }
}

interface UsageWindow {
  used_percent: number
  limit_window_seconds: number
  reset_at: number // epoch seconds
}

function toWindow(w: UsageWindow | null | undefined): RateLimitWindow | null {
  if (!w) return null
  const hours = Math.round(w.limit_window_seconds / 3600)
  const label = hours >= 168 ? 'weekly (all models)' : `${hours}h window`
  return {
    label,
    percentUsed: w.used_percent,
    resetsAt: new Date(w.reset_at * 1000).toISOString(),
  }
}

export async function codexAccountUsage(name: string, source: string): Promise<AccountUsage> {
  try {
    const codexHome = source.startsWith('codex:') ? source.slice('codex:'.length) : '~/.codex'
    const { token, accountId } = await codexToken(codexHome)
    const res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'chatgpt-account-id': accountId,
        'User-Agent': 'codex-cli',
      },
    })
    if (res.status === 401) {
      return {
        account: name,
        windows: [],
        error: 'token expired or revoked — run codex once to log in again',
      }
    }
    if (!res.ok) {
      return { account: name, windows: [], error: `request failed: HTTP ${res.status}` }
    }
    const body = (await res.json()) as {
      plan_type?: string
      rate_limit?: { primary_window?: UsageWindow | null; secondary_window?: UsageWindow | null }
    }
    const windows = [
      toWindow(body.rate_limit?.primary_window),
      toWindow(body.rate_limit?.secondary_window),
    ].filter((w): w is RateLimitWindow => w !== null)
    const label = body.plan_type ? `${name} (${body.plan_type})` : name
    return { account: label, windows }
  } catch (err) {
    return { account: name, windows: [], error: String(err instanceof Error ? err.message : err) }
  }
}
