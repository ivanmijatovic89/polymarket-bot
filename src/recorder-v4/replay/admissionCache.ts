import { lstat, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { isMissing, syncDirectory } from '../storage/files.js'
import type { PtbAdmissionEvidence } from './eligibility.js'

const entrySchema = z.object({
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  evidence: z.object({ websiteObserved: z.boolean(), openingReasons: z.array(z.string()) }),
})
const bucketSchema = z.object({
  version: z.literal(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  entries: z.array(entrySchema),
})
type Bucket = z.infer<typeof bucketSchema>
const MAX_BUCKET_BYTES = 64 * 1024
const TEMPORARY_NAME =
  /^bucket-[a-f0-9]{2}\.json\.writer-([1-9][0-9]*)-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/

async function cleanStaleAdmissionWrites(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const match = TEMPORARY_NAME.exec(entry.name)
    if (!match) continue
    const pid = Number(match[1])
    if (!Number.isSafeInteger(pid)) continue
    try {
      process.kill(pid, 0)
      continue
    } catch (error) {
      // Only ESRCH proves this writer is gone. Permission denial and PID reuse
      // preserve the temporary file until a future write can confirm its owner died.
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) continue
    }
    try {
      const file = path.join(root, entry.name)
      if ((await lstat(file)).isFile()) await unlink(file)
    } catch (error) {
      // Another concurrent writer may already have reclaimed the same file.
      if (!isMissing(error)) throw error
    }
  }
}

async function writeAdmissionBucket(file: string, body: string): Promise<void> {
  const temporary = `${file}.writer-${process.pid}-${randomUUID()}.tmp`
  let created = false
  try {
    const handle = await open(temporary, 'wx', 0o600)
    created = true
    try {
      await handle.writeFile(body)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, file)
    await syncDirectory(path.dirname(file))
  } finally {
    if (created) {
      try {
        await unlink(temporary)
      } catch (error) {
        if (!isMissing(error)) throw error
      }
    }
  }
}

function encodeBucket(entries: Bucket['entries']): string {
  return JSON.stringify({
    version: 1,
    sha256: createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
    entries,
  })
}

function cacheLocation(root: string, hash: string): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid admission-cache manifest hash')
  return path.join(root, `bucket-${hash.slice(0, 2)}.json`)
}

async function readBucket(file: string): Promise<Bucket | null> {
  try {
    const info = await lstat(file)
    if (!info.isFile() || info.size > MAX_BUCKET_BYTES) return null
    const parsed = bucketSchema.safeParse(JSON.parse(await readFile(file, 'utf8')))
    return parsed.success &&
      createHash('sha256').update(JSON.stringify(parsed.data.entries)).digest('hex') ===
        parsed.data.sha256
      ? parsed.data
      : null
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) return null
    throw error
  }
}

export async function readAdmissionEvidence(
  root: string,
  hash: string,
): Promise<PtbAdmissionEvidence | null> {
  const bucket = await readBucket(cacheLocation(root, hash))
  return bucket?.entries.find((entry) => entry.manifestSha256 === hash)?.evidence ?? null
}

/**
 * Committed buckets use at most 16 MiB, plus 64 KiB per in-flight write.
 * Handled failures remove their temporary file; later writes reclaim interrupted
 * files only after their owning process is confirmed dead. Compact entries retain
 * months of evidence without retaining event Parquets.
 * Concurrent writers can lose a cache entry, never change its evidence: a miss
 * is inspected again, and replay still independently verifies the original tape.
 */
export async function writeAdmissionEvidence(
  root: string,
  hash: string,
  evidence: PtbAdmissionEvidence,
): Promise<void> {
  const file = cacheLocation(root, hash)
  const entry = entrySchema.parse({ manifestSha256: hash, evidence })
  await mkdir(root, { recursive: true })
  const info = await lstat(root)
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('Admission cache root must be a real directory')
  await cleanStaleAdmissionWrites(root)
  const previous = await readBucket(file)
  const entries = [
    entry,
    ...(previous?.entries ?? []).filter(
      (item) =>
        item.manifestSha256 !== hash && item.manifestSha256.slice(0, 2) === hash.slice(0, 2),
    ),
  ]
  let body = encodeBucket(entries)
  while (Buffer.byteLength(body) > MAX_BUCKET_BYTES && entries.length) {
    entries.pop()
    body = encodeBucket(entries)
  }
  // An unusually large entry is omitted, not persisted beyond the budget.
  if (!entries.length) return
  await writeAdmissionBucket(file, body)
}
