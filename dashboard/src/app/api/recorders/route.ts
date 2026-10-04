import { getRecordersReport } from '@/lib/queries/recorders'

export const dynamic = 'force-dynamic'

export async function GET() {
  const report = await getRecordersReport()
  return Response.json(report, {
    status: report.error ? 503 : 200,
    headers: { 'Cache-Control': 'no-store' },
  })
}
