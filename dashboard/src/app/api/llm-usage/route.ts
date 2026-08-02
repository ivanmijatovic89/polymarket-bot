import path from 'node:path'
import { NextResponse } from 'next/server'
import { getUsage } from '@polymarket-bot/llm-usage'
import { createLastGoodUsageMerger } from '@/lib/server/llmUsageCache'
import { createTtlCache } from '@/lib/server/ttlCache'

// Reads local credentials (macOS Keychain / home-dir logins) on every request;
// only works when the dashboard runs on the machine those accounts live on.
export const dynamic = 'force-dynamic'

// cwd is dashboard/ under `next dev`/`next start`
const accountsPath = path.resolve(process.cwd(), '..', 'src', 'llm-usage', 'accounts.json')

// Process-local cache shared by the dashboard, SwiftBar, and any future
// overview consumer. Concurrent misses share one provider request.
const CACHE_MS = 30_000
const mergeLastGoodUsage = createLastGoodUsageMerger()
const usageCache = createTtlCache<Awaited<ReturnType<typeof mergeLastGoodUsage>>>(CACHE_MS)

export async function GET() {
  const result = await usageCache.get(async () => mergeLastGoodUsage(await getUsage(accountsPath)))
  return NextResponse.json(result.value, {
    headers: {
      'Cache-Control': 'no-store',
      'X-LLM-Usage-Source': result.source,
      'X-LLM-Usage-Age-Ms': String(Math.round(result.ageMs)),
      'X-LLM-Usage-Cache-TTL-Ms': String(CACHE_MS),
    },
  })
}
