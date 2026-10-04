import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rename, stat } from 'node:fs/promises'
import path from 'node:path'

export async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** Write and sync the replacement before exposing it; the old version survives a crash. */
export async function atomicWrite(file: string, value: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(value)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, file)
  await syncDirectory(path.dirname(file))
}

export async function exists(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

export function isMissing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
}

export type FileDigest = { sha256: string; bytes: number }

export async function digestStream(stream: AsyncIterable<Uint8Array>): Promise<FileDigest> {
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of stream) {
    hash.update(chunk)
    bytes += chunk.byteLength
  }
  return { sha256: hash.digest('hex'), bytes }
}

export async function digestFile(file: string): Promise<FileDigest> {
  return digestStream(createReadStream(file))
}

export function safeComponent(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(value)) {
    throw new Error('Invalid recording path component')
  }
  return value
}

export async function readSmallStream(
  stream: AsyncIterable<Uint8Array>,
  maxBytes = 4 * 1024 * 1024,
): Promise<Buffer> {
  const buffers: Buffer[] = []
  let bytes = 0
  for await (const chunk of stream) {
    bytes += chunk.byteLength
    if (bytes > maxBytes) throw new Error('Metadata object exceeds size limit')
    buffers.push(Buffer.from(chunk))
  }
  return Buffer.concat(buffers)
}
