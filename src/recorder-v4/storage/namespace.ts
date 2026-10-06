export const ARCHIVE_ROOT = 'recorder-v4'

/** V4 can only use its new root or a child of it (for isolated validation runs). */
export function validateArchivePrefix(prefix: string): string {
  if (!/^recorder-v4(?:\/[a-zA-Z0-9_-]+)*$/.test(prefix))
    throw new Error('Archive prefix must be recorder-v4 or a child of recorder-v4/')
  return prefix
}

/** Enforced at the network boundary, independently of config, manifests and callers. */
export function assertArchiveKey(key: string, listing = false): void {
  const value = listing && key.endsWith('/') ? key.slice(0, -1) : key
  const parts = value.split('/')
  if (
    (listing && !key.endsWith('/')) ||
    parts[0] !== ARCHIVE_ROOT ||
    (!listing && parts.length < 2) ||
    parts.some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === '.' || part === '..')
  )
    throw new Error('R2 operation is outside the recorder-v4 namespace')
}
