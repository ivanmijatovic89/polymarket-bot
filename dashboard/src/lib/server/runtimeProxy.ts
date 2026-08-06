import { NextRequest, NextResponse } from 'next/server'
import { runtimeAuthHeaders, type RuntimeMachine } from './runtimeMachines'

/**
 * Forward a Mission Control command to a specific machine's Global Runtime
 * daemon (issue #213). Reads are DB-backed elsewhere; everything forwarded
 * here is a command (create/start/stop/…) or a live-file read that MUST hit
 * the owning daemon. The bearer token is attached server-side.
 */
export async function forwardToDaemon(
  request: NextRequest,
  machine: RuntimeMachine,
  targetPath: string,
): Promise<NextResponse> {
  const base = machine.runtimeUrl.replace(/\/$/u, '')
  const target = new URL(`${base}/${targetPath.replace(/^\//u, '')}`)
  target.search = request.nextUrl.search

  try {
    const body = request.method === 'GET' ? undefined : await request.text()
    const response = await fetch(target, {
      method: request.method,
      body,
      cache: 'no-store',
      headers: {
        ...runtimeAuthHeaders(),
        ...(body ? { 'content-type': request.headers.get('content-type') || 'application/json' } : {}),
      },
    })
    return new NextResponse(await response.arrayBuffer(), {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') || 'application/json',
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: `${machine.name} (${machine.machineId}) is unreachable: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 503 },
    )
  }
}
