import path from 'node:path'
import { NextResponse } from 'next/server'
import { getUsage } from '@polymarket-bot/llm-usage'

// Reads local credentials (macOS Keychain / home-dir logins) on every request;
// only works when the dashboard runs on the machine those accounts live on.
export const dynamic = 'force-dynamic'

// cwd is dashboard/ under `next dev`/`next start`
const accountsPath = path.resolve(process.cwd(), '..', 'src', 'llm-usage', 'accounts.json')

export async function GET() {
  const accounts = await getUsage(accountsPath)
  return NextResponse.json(accounts, { headers: { 'Cache-Control': 'no-store' } })
}
