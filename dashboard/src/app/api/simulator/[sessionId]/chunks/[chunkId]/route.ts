import { readSimulatorChunk } from '@/lib/server/simulatorJobs'
export const runtime = 'nodejs'
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string; chunkId: string }> },
) {
  try {
    const { sessionId, chunkId } = await params
    const bytes = readSimulatorChunk(sessionId, Number(chunkId))
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return Response.json(
      { error: 'Trace chunk unavailable. The session may have expired.' },
      { status: 404 },
    )
  }
}
