import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { isMissing } from '../storage/files.js'

const leaseSchema = z.object({
  owner: z.literal('recorder-v4-admission'),
  version: z.literal(1),
  pid: z.number().int().positive(),
  createdAtMs: z.number().finite().positive(),
})
export const admissionTemporaryRoot = path.join(os.tmpdir(), 'polymarket-recorder-v4-admission')

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // Permission denial means an active process, not a stale lease.
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
  }
}

/** Crash recovery is limited to owned directories whose recorded process no longer exists. */
export async function cleanStaleAdmissionTemporaryDirectories(
  root = admissionTemporaryRoot,
): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 })
  const rootInfo = await lstat(root)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw new Error('Admission temporary root must be a real directory')
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^capture-[a-zA-Z0-9]+$/.test(entry.name)) continue
    const directory = path.join(root, entry.name)
    const leaseFile = path.join(directory, 'admission-owner.json')
    try {
      const info = await lstat(leaseFile)
      if (!info.isFile() || info.size > 2048) continue
      const lease = leaseSchema.safeParse(JSON.parse(await readFile(leaseFile, 'utf8')))
      if (!lease.success || pidAlive(lease.data.pid)) continue
      await rm(directory, { recursive: true, force: true })
    } catch (error) {
      if (isMissing(error) || error instanceof SyntaxError) continue
      throw error
    }
  }
}

export async function withAdmissionTemporaryDirectory<T>(
  use: (directory: string) => Promise<T>,
  root = admissionTemporaryRoot,
): Promise<T> {
  await cleanStaleAdmissionTemporaryDirectories(root)
  const directory = await mkdtemp(path.join(root, 'capture-'))
  try {
    // The ownership lease exists before any large event download can begin.
    await writeFile(
      path.join(directory, 'admission-owner.json'),
      JSON.stringify({
        owner: 'recorder-v4-admission',
        version: 1,
        pid: process.pid,
        createdAtMs: Date.now(),
      }),
      { flag: 'wx', mode: 0o600 },
    )
    return await use(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
