/**
 * Claude Code rate-limit usage (5h window, weekly, weekly Fable/Opus).
 *
 * Source value in accounts.json is one of:
 *   - "keychain"        — the account logged in to the Claude Code CLI on this Mac
 *   - "~/.claude-main"  — a config dir created with a one-time
 *                         `CLAUDE_CONFIG_DIR=~/.claude-main claude` login;
 *                         its token is auto-refreshed and saved back
 *   - "sk-ant-oat01-…"  — a raw OAuth access token (must have the
 *                         user:profile scope; `claude setup-token` tokens do
 *                         NOT — they are inference-only and get HTTP 403)
 *
 * Uses the same undocumented endpoint as the `/usage` command in Claude Code;
 * if this module suddenly breaks, the endpoint shape likely changed.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AccountUsage, RateLimitWindow } from './types'

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token'
// Claude Code's public OAuth client id (same for everyone)
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'

const LIMIT_LABELS = {
  session: '5h window',
  weekly_all: 'weekly (all models)',
  weekly_scoped: 'weekly (Fable/Opus)',
} as const

function keychainToken(): string {
  const raw = execFileSync(
    'security',
    ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
    { encoding: 'utf8' },
  )
  return JSON.parse(raw).claudeAiOauth.accessToken
}

interface StoredCredentials {
  claudeAiOauth: {
    accessToken: string
    refreshToken: string
    expiresAt: number // ms epoch
    [key: string]: unknown
  }
}

/**
 * Token from a CLAUDE_CONFIG_DIR-style folder, refreshing it if expired.
 * Credentials live either in <dir>/.credentials.json or (macOS) in a Keychain
 * entry whose service name is suffixed with sha256(<abs dir>)[0..8].
 */
async function configDirToken(configDir: string): Promise<string> {
  const dir = path.resolve(configDir.replace(/^~/, os.homedir()))
  const credsFile = path.join(dir, '.credentials.json')
  const service = `Claude Code-credentials-${createHash('sha256').update(dir).digest('hex').slice(0, 8)}`

  let creds: StoredCredentials
  let save: (updated: StoredCredentials) => void

  if (existsSync(credsFile)) {
    creds = JSON.parse(readFileSync(credsFile, 'utf8'))
    save = (updated) => writeFileSync(credsFile, JSON.stringify(updated))
  } else {
    let raw: string
    try {
      raw = execFileSync('security', ['find-generic-password', '-s', service, '-w'], {
        encoding: 'utf8',
      })
    } catch {
      throw new Error(
        `no credentials for ${configDir} — log in once with: CLAUDE_CONFIG_DIR=${configDir} claude`,
      )
    }
    creds = JSON.parse(raw)
    const attrs = execFileSync('security', ['find-generic-password', '-s', service], {
      encoding: 'utf8',
    })
    const account = /"acct"<blob>="([^"]*)"/.exec(attrs)?.[1] ?? os.userInfo().username
    save = (updated) =>
      execFileSync('security', [
        'add-generic-password',
        '-U',
        '-a',
        account,
        '-s',
        service,
        '-w',
        JSON.stringify(updated),
      ])
  }

  const oauth = creds.claudeAiOauth
  if (Date.now() < oauth.expiresAt - 60_000) return oauth.accessToken

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: oauth.refreshToken,
      client_id: CLIENT_ID,
    }),
  })
  if (!res.ok) {
    throw new Error(
      `token refresh failed (HTTP ${res.status}) — log in again with: CLAUDE_CONFIG_DIR=${configDir} claude`,
    )
  }
  const fresh = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }
  oauth.accessToken = fresh.access_token
  if (fresh.refresh_token) oauth.refreshToken = fresh.refresh_token
  oauth.expiresAt = Date.now() + fresh.expires_in * 1000
  save(creds)
  return oauth.accessToken
}

export async function claudeAccountUsage(name: string, source: string): Promise<AccountUsage> {
  let token: string
  try {
    token =
      source === 'keychain'
        ? keychainToken()
        : source.startsWith('~') || source.startsWith('/')
          ? await configDirToken(source)
          : source
  } catch (err) {
    return { account: name, windows: [], error: String(err instanceof Error ? err.message : err) }
  }

  const res = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
    },
  })
  if (res.status === 401) {
    return {
      account: name,
      windows: [],
      error: 'token expired or revoked — log in again for this account',
    }
  }
  if (res.status === 403) {
    return {
      account: name,
      windows: [],
      error:
        "token lacks the user:profile scope (setup-token tokens can't read usage) — use a config-dir login instead",
    }
  }
  if (!res.ok) {
    return { account: name, windows: [], error: `request failed: HTTP ${res.status}` }
  }

  const body = (await res.json()) as {
    limits?: { kind: string; percent: number | null; resets_at: string }[]
  }
  const windows: RateLimitWindow[] = (body.limits ?? [])
    .filter((l) => l.kind in LIMIT_LABELS)
    .map((l) => ({
      label: LIMIT_LABELS[l.kind as keyof typeof LIMIT_LABELS],
      percentUsed: l.percent,
      resetsAt: l.resets_at,
    }))
  return { account: name, windows }
}
