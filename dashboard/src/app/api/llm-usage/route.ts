import path from 'node:path'
import { NextResponse } from 'next/server'
import { getUsage } from '@polymarket-bot/llm-usage'

// Reads local credentials (macOS Keychain / home-dir logins) on every request;
// only works when the dashboard runs on the machine those accounts live on.
export const dynamic = 'force-dynamic'

// cwd is dashboard/ under `next dev`/`next start`
const accountsPath = path.resolve(process.cwd(), '..', 'src', 'llm-usage', 'accounts.json')

// Short server-side cache so bursts (reloads, refocus, several tabs) don't
// hammer the providers' usage endpoints — Anthropic 429s quickly.
const CACHE_MS = 30_000
let cached: { data: unknown; ts: number } | null = null

export async function GET() {
  if (!cached || Date.now() - cached.ts > CACHE_MS) {
    cached = { data: await getUsage(accountsPath), ts: Date.now() }
  }
  return NextResponse.json(cached.data, { headers: { 'Cache-Control': 'no-store' } })
}
