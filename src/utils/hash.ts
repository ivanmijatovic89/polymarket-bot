import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

/** sha256 hex digest of a buffer. */
export function sha256OfBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/** sha256 hex digest of a file, streamed (never loads the whole file). */
export async function sha256OfFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  for await (const chunk of stream) {
    hash.update(chunk as Buffer)
  }
  return hash.digest('hex')
}
