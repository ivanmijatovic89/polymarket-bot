import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { MISSION_CONTROL_COOKIE, missionControlSecret } from '@/proxy'

export const dynamic = 'force-dynamic'

/**
 * One-time browser unlock for Mission Control (issue #213): visit
 * `/mission-control/unlock?token=<shared token>` and the token is stored in an
 * httpOnly, SameSite=Strict cookie so the UI's API calls carry it.
 *
 * httpOnly matters: the token is not readable by page scripts, and a local
 * process (a sandboxed mission session on the same host) has no way to obtain
 * the browser's cookie. This route lives outside `/api/mission-control`, so
 * the proxy gate does not run for it.
 */
export async function GET(request: NextRequest) {
  const secret = missionControlSecret()
  const redirect = NextResponse.redirect(new URL('/mission-control', request.nextUrl))
  if (!secret) return redirect

  const presented = request.nextUrl.searchParams.get('token') ?? ''
  const a = Buffer.from(presented)
  const b = Buffer.from(secret)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'invalid Mission Control token' }, { status: 401 })
  }

  redirect.cookies.set(MISSION_CONTROL_COOKIE, secret, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  return redirect
}
