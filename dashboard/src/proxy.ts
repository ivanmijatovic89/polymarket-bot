import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Gate for the Mission Control API (issue #213).
 *
 * These routes forward commands to Global Runtime daemons with the fleet
 * bearer token attached server-side, so reaching them IS controlling the
 * fleet. Two independent checks:
 *
 * 1. **A shared secret** (`MISSION_CONTROL_TOKEN`, falling back to
 *    `GLOBAL_RUNTIME_TOKEN`) in the `mission_control_token` cookie or the
 *    `x-mission-control-token` header. Binding to loopback is NOT sufficient:
 *    a sandboxed mission session runs on the same host and can open loopback
 *    ports (that is the premise of the DB forwarders), so without a secret it
 *    could create an unsandboxed full-access run on any fleet machine — with
 *    no credential of its own, because the proxy supplies the token. The
 *    secret must therefore live somewhere sessions cannot read (see the
 *    sandbox settings requirements in docs/global-runtime/fleet.md).
 * 2. **Same-origin + loopback Host**, which stops the operator's own browser
 *    being used as a confused deputy (plain CSRF and DNS rebinding).
 *
 * With no token configured the API stays open, matching the daemon's own
 * behavior for single-machine loopback setups.
 */

const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
export const MISSION_CONTROL_COOKIE = 'mission_control_token'
export const MISSION_CONTROL_HEADER = 'x-mission-control-token'

function hostnameOf(value: string): string {
  // Strip the port; keep bracketed IPv6 literals intact.
  const match = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/u.exec(value.trim())
  return match?.[1]?.toLowerCase() ?? ''
}

export function missionControlSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.MISSION_CONTROL_TOKEN?.trim() || env.GLOBAL_RUNTIME_TOKEN?.trim() || undefined
}

function matches(presented: string | undefined, secret: string): boolean {
  if (!presented) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function proxy(request: NextRequest): NextResponse | undefined {
  const host = request.headers.get('host')
  if (!host || !ALLOWED_HOSTNAMES.has(hostnameOf(host))) {
    return NextResponse.json(
      { error: 'Mission Control is only reachable over loopback' },
      { status: 403 },
    )
  }

  // Browsers that send Fetch Metadata: anything but a same-origin fetch (or a
  // direct address-bar navigation) is rejected outright.
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') {
    return NextResponse.json({ error: 'cross-site request rejected' }, { status: 403 })
  }

  // Older browsers / explicit Origin: it must match the host being addressed.
  const origin = request.headers.get('origin')
  if (origin) {
    let originHost: string
    try {
      originHost = new URL(origin).host
    } catch {
      return NextResponse.json({ error: 'cross-site request rejected' }, { status: 403 })
    }
    if (originHost.toLowerCase() !== host.toLowerCase()) {
      return NextResponse.json({ error: 'cross-site request rejected' }, { status: 403 })
    }
  }

  const secret = missionControlSecret()
  if (!secret) return undefined
  const presented =
    request.cookies.get(MISSION_CONTROL_COOKIE)?.value ??
    request.headers.get(MISSION_CONTROL_HEADER) ??
    undefined
  if (!matches(presented, secret)) {
    return NextResponse.json(
      {
        error:
          'Mission Control requires the shared token. In a browser, open /mission-control/unlock?token=… once; ' +
          `for scripts, send the ${MISSION_CONTROL_HEADER} header.`,
      },
      { status: 401 },
    )
  }

  return undefined
}

export const config = {
  matcher: '/api/mission-control/:path*',
}
