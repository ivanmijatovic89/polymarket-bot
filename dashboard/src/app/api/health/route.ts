import { NextResponse } from 'next/server'
import { runHealthChecks } from '@/lib/queries/health'

export const dynamic = 'force-dynamic'

export async function GET() {
  const report = await runHealthChecks()
  const httpStatus = report.ok ? 200 : 503
  return NextResponse.json(report, { status: httpStatus })
}
