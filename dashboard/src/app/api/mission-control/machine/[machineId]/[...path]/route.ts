import { NextRequest, NextResponse } from 'next/server'
import { getRuntimeMachine } from '@/lib/server/runtimeMachines'
import { forwardToDaemon } from '@/lib/server/runtimeProxy'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ machineId: string; path: string[] }> }

// Machine-addressed daemon proxy (issue #213): create runs on a chosen
// machine (`POST .../machine/<id>/runs`) or hit its endpoints directly.
export async function GET(request: NextRequest, context: RouteContext) {
  return forward(request, context)
}

export async function POST(request: NextRequest, context: RouteContext) {
  return forward(request, context)
}

async function forward(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { machineId, path } = await context.params
  const machine = getRuntimeMachine(machineId)
  if (!machine) {
    return NextResponse.json(
      { error: `machine ${machineId} is not a configured Global Runtime target` },
      { status: 404 },
    )
  }
  return forwardToDaemon(request, machine, path.map(encodeURIComponent).join('/'))
}
