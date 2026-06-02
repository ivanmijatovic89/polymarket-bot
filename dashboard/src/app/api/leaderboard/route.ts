import { NextResponse, type NextRequest } from 'next/server'
import { listLeaderboard, type LeaderboardRange } from '@/lib/queries/leaderboard'

export const dynamic = 'force-dynamic'

function parseRange(value: string | null): LeaderboardRange {
  if (value === '24h' || value === '7d' || value === 'all') return value
  return 'all'
}

export async function GET(req: NextRequest) {
  const range = parseRange(req.nextUrl.searchParams.get('range'))
  const rows = await listLeaderboard(range)
  return NextResponse.json({ range, rows })
}
