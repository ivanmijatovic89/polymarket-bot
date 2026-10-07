import { lstatSync, readdirSync } from 'node:fs'
import path from 'node:path'

/** Count owned session files without following links to original datasets. */
export function simulatorDirectoryBytes(directory: string): number {
  try {
    return readdirSync(directory).reduce((sum, name) => {
      const file = path.join(directory, name)
      try {
        const stat = lstatSync(file)
        return sum + (stat.isDirectory() ? simulatorDirectoryBytes(file) : stat.size)
      } catch (error) {
        // The worker can atomically rename a download, or finish cleanup during this scan.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return sum
        throw error
      }
    }, 0)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
}

export function simulatorWorkerAlive(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // Lack of permission is evidence that the process exists; never evict it.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
