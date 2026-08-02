import path from 'node:path'
import { NextResponse } from 'next/server'
import { getUsage } from '@polymarket-bot/llm-usage'
import { createTtlCache } from '@/lib/server/ttlCache'

// Reads local credentials (macOS Keychain / home-dir logins) on every request;
// only works when the dashboard runs on the machine those accounts live on.
export const dynamic = 'force-dynamic'

// cwd is dashboard/ under `next dev`/`next start`
const accountsPath = path.resolve(process.cwd(), '..', 'src', 'llm-usage', 'accounts.json')

// Process-local cache shared by the dashboard, SwiftBar, and any future
// overview consumer. Concurrent misses share one provider request.
const CACHE_MS = 30_000
const usageCache = createTtlCache<Awaited<ReturnType<typeof getUsage>>>(CACHE_MS)

export async function GET() {
  const data = await usageCache.get(() => getUsage(accountsPath))
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}
