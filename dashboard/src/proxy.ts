import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Same-origin guard for the Mission Control API (issue #213).
 *
 * These routes forward commands to Global Runtime daemons with the fleet
 * bearer token attached server-side, and the dashboard itself has no login.
 * Binding to loopback keeps other hosts out, but not the operator's own
 * browser: any page they visit could POST to `http://127.0.0.1:3051/...`
 * (simple CSRF), and a DNS-rebinding page could become same-origin and drive
 * the whole fleet. So: require the request to be same-origin, and require the
 * Host header to be a loopback name — a rebound `attacker.test` resolving to
 * 127.0.0.1 arrives with its own Host and is rejected.
 *
 * Read-only page navigations are unaffected; this matcher covers the API only.
 */

const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function hostnameOf(value: string): string {
  // Strip the port; keep bracketed IPv6 literals intact.
  const match = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/u.exec(value.trim())
  return match?.[1]?.toLowerCase() ?? ''
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

  return undefined
}

export const config = {
  matcher: '/api/mission-control/:path*',
}
