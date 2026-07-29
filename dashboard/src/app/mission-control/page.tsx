import path from 'node:path'
import { connection } from 'next/server'
import { MissionControlView } from '@/components/MissionControlView'

export default async function MissionControlPage() {
  await connection()
  const examplesRoot = path.resolve(process.cwd(), '..', 'examples', 'global-runtime')
  return <MissionControlView examplesRoot={examplesRoot} />
}
