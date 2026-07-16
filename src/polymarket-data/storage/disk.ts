import { mkdir, statfs } from 'node:fs/promises'
import { storageRoot } from './paths.js'

const GIB = 1024 ** 3
export const MIN_FREE_BYTES = 8 * GIB

export function formatGiB(bytes: number): string {
  return `${(bytes / GIB).toFixed(1)} GiB`
}

/** Stop between pipeline stages before local storage can consume the host disk. */
export async function assertStorageHeadroom(minFreeBytes = MIN_FREE_BYTES): Promise<number> {
  const root = storageRoot()
  await mkdir(root, { recursive: true })
  const stats = await statfs(root)
  const freeBytes = Number(stats.bavail) * Number(stats.bsize)
  if (freeBytes < minFreeBytes) {
    throw new Error(
      `Insufficient disk headroom: ${formatGiB(freeBytes)} free, ` +
        `${formatGiB(minFreeBytes)} required. Free space before continuing the backfill.`,
    )
  }
  return freeBytes
}
