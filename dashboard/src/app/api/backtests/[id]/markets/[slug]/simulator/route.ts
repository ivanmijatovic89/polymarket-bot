import { NextResponse } from 'next/server'
import { startSimulator } from '@/lib/server/simulatorJobs'
export const runtime = 'nodejs'
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; slug: string }> },
) {
  const { id, slug } = await params
  try {
    return NextResponse.json(startSimulator(Number(id), slug), { status: 202 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to start replay' },
      { status: 400 },
    )
  }
}
