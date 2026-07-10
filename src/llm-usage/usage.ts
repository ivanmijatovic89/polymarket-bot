/**
 * Entry point for llm-usage: loads accounts.json and dispatches each account
 * to its provider.
 *
 * accounts.json (gitignored — may contain tokens) lives next to this file:
 *
 *     {
 *       "drugar": "keychain",          // Claude: CLI login on this Mac
 *       "moj nalog": "~/.claude-main", // Claude: config-dir login
 *       "codex": "codex"               // Codex: ~/.codex login (or "codex:<dir>")
 *     }
 *
 * Values starting with "codex" go to codexUsage.ts; everything else goes to
 * claudeUsage.ts. Without the file, only the Claude keychain account is shown.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { claudeAccountUsage } from './claudeUsage'
import { codexAccountUsage } from './codexUsage'
import type { AccountUsage } from './types'

export type { AccountUsage, RateLimitWindow } from './types'

export function defaultAccountsPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'accounts.json')
}

export async function getUsage(accountsPath = defaultAccountsPath()): Promise<AccountUsage[]> {
  const accounts: Record<string, string> = existsSync(accountsPath)
    ? JSON.parse(readFileSync(accountsPath, 'utf8'))
    : { 'active CLI account': 'keychain' }

  return Promise.all(
    Object.entries(accounts).map(([name, source]) =>
      source === 'codex' || source.startsWith('codex:')
        ? codexAccountUsage(name, source)
        : claudeAccountUsage(name, source),
    ),
  )
}
