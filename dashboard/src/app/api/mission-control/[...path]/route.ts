import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ path: string[] }> }

export async function GET(request: NextRequest, context: RouteContext) {
  return forward(request, context)
}

export async function POST(request: NextRequest, context: RouteContext) {
  return forward(request, context)
}

async function forward(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { path } = await context.params
  const baseUrl = process.env.GLOBAL_RUNTIME_URL?.trim() || 'http://127.0.0.1:3053'
  const target = new URL(path.map(encodeURIComponent).join('/'), `${baseUrl.replace(/\/$/u, '')}/`)
  target.search = request.nextUrl.search

  try {
    const body = request.method === 'GET' ? undefined : await request.text()
    const response = await fetch(target, {
      method: request.method,
      body,
      cache: 'no-store',
      headers: body
        ? { 'content-type': request.headers.get('content-type') || 'application/json' }
        : {},
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
        error: `Global Runtime is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 503 },
    )
  }
}
