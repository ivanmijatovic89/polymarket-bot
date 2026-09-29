import { NextResponse } from 'next/server'
import { readSimulator, readSimulatorManifest, cancelSimulator } from '@/lib/server/simulatorJobs'
export const runtime = 'nodejs'
type Context = { params: Promise<{ sessionId: string }> }
export async function GET(request: Request, { params }: Context) {
  const { sessionId } = await params
  try {
    const state = readSimulator(sessionId)
    if (!state)
      return NextResponse.json(
        { error: 'Replay expired or was removed. Start a new replay.' },
        { status: 404 },
      )
    const data = new URL(request.url).searchParams.has('manifest')
      ? readSimulatorManifest(sessionId)
      : state
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Replay unavailable' },
      { status: 400 },
    )
  }
}
export async function DELETE(_request: Request, { params }: Context) {
  try {
    return NextResponse.json(cancelSimulator((await params).sessionId))
  } catch {
    return NextResponse.json({ error: 'Invalid session' }, { status: 400 })
  }
}
