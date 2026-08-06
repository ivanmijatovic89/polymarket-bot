import { NextRequest, NextResponse } from 'next/server'
import { runtimeAuthHeaders, type RuntimeMachine } from './runtimeMachines'

/**
 * Path segments accepted from the client before they are appended to a
 * daemon URL. `encodeURIComponent('..')` is `'..'` and `new URL()` collapses
 * dot segments, so a permissive filter would let a caller climb out of the
 * intended prefix (e.g. `run/5/../../runs/9/stop`, defeating owner routing).
 * Next normalizes request paths today, but the guard must not depend on that.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/u

const COMMAND_TIMEOUT_MS = 10_000

export function sanitizeDaemonPath(segments: string[]): string | null {
  if (segments.length === 0) return null
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || !SAFE_SEGMENT.test(segment)) return null
  }
  return segments.join('/')
}

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
      // A sleeping machine can blackhole packets without an RST, which would
      // otherwise hang the route (and the user's click) for the OS TCP
      // timeout. Abort maps to the same 503 as a refused connection.
      signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
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
