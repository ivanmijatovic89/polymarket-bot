import { promises as fs } from 'node:fs'

/** True if `p` exists (any stat success). Shared so callers don't each re-roll it. */
export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}
