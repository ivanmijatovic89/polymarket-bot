import { NextRequest, NextResponse } from 'next/server'
import { getRuntimeMachine } from '@/lib/server/runtimeMachines'
import { forwardToDaemon, sanitizeDaemonPath } from '@/lib/server/runtimeProxy'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ machineId: string; path: string[] }> }

// Endpoints this route may reach on a daemon, per method. Everything else is
// either owned by the run-addressed route (which enforces ownership) or is
// not something a browser should be able to invoke through the proxy.
const ALLOWED: Record<string, Set<string>> = {
  GET: new Set(['health', 'runs']),
  POST: new Set(['runs']),
}

// Machine-addressed daemon proxy (issue #213): create runs on a chosen
// machine (`POST .../machine/<id>/runs`) or read its health.
export async function GET(request: NextRequest, context: RouteContext) {
  return forward(request, context)
}

export async function POST(request: NextRequest, context: RouteContext) {
  return forward(request, context)
}

async function forward(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { machineId, path } = await context.params
  const targetPath = sanitizeDaemonPath(path)
  if (!targetPath || !ALLOWED[request.method]?.has(targetPath)) {
    return NextResponse.json({ error: 'unsupported runtime path' }, { status: 400 })
  }
  const machine = getRuntimeMachine(machineId)
  if (!machine) {
    return NextResponse.json(
      { error: `machine ${machineId} is not a configured Global Runtime target` },
      { status: 404 },
    )
  }
  return forwardToDaemon(request, machine, targetPath)
}
