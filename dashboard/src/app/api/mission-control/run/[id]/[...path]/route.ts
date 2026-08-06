import { NextRequest, NextResponse } from 'next/server'
import { getRunMachineId } from '@/lib/queries/runtimeRuns'
import { getRuntimeMachine } from '@/lib/server/runtimeMachines'
import { forwardToDaemon, sanitizeDaemonPath } from '@/lib/server/runtimeProxy'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; path: string[] }> }

// Per-run daemon endpoints this route may reach, per method.
const ALLOWED: Record<string, Set<string>> = {
  GET: new Set(['files']),
  POST: new Set(['start', 'pause', 'resume', 'stop', 'extend', 'inbox']),
}

// Run-addressed daemon proxy (issue #213): looks up the run's owning machine
// in the DB and forwards `runs/<id>/<path>` to that machine's daemon
// (start/pause/resume/stop/extend/inbox/files). The daemon independently
// re-verifies ownership (409), so a stale mapping can never act on a
// foreign run. There is deliberately NO fallback machine.
export async function GET(request: NextRequest, context: RouteContext) {
  return forward(request, context)
}

export async function POST(request: NextRequest, context: RouteContext) {
  return forward(request, context)
}

async function forward(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { id, path } = await context.params
  const runId = Number(id)
  if (!Number.isSafeInteger(runId) || runId < 1) {
    return NextResponse.json({ error: 'invalid run id' }, { status: 400 })
  }
  const suffix = sanitizeDaemonPath(path)
  if (!suffix || !ALLOWED[request.method]?.has(suffix)) {
    return NextResponse.json({ error: 'unsupported runtime path' }, { status: 400 })
  }
  const machineId = await getRunMachineId(runId)
  if (!machineId) {
    return NextResponse.json({ error: `run ${runId} not found` }, { status: 404 })
  }
  const machine = getRuntimeMachine(machineId)
  if (!machine) {
    return NextResponse.json(
      {
        error: `run ${runId} belongs to machine ${machineId}, which has no runtimeUrl configured in machines.json`,
      },
      { status: 503 },
    )
  }
  return forwardToDaemon(request, machine, `runs/${runId}/${suffix}`)
}
