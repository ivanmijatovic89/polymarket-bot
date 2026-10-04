import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { exists } from './files.js'
import { parseManifest } from './manifest.js'

export type ArchiveReceipt = { manifestKey: string; verifiedAtMs: number }

/** A deletion receipt must identify the exact local manifest that was verified remotely. */
export async function readArchiveReceipt(directory: string): Promise<ArchiveReceipt | null> {
  const file = path.join(directory, 'archived.json')
  if (!(await exists(file))) return null
  const receipt = JSON.parse(await readFile(file, 'utf8')) as ArchiveReceipt | null
  const manifestFile = path.join(directory, 'manifest.json')
  const body = await readFile(manifestFile)
  const manifest = parseManifest(body.toString('utf8'))
  const sha256 = createHash('sha256').update(body).digest('hex')
  const expectedKey = `${path.posix.dirname(manifest.events.key)}/manifest-${sha256}.json`
  if (
    !receipt ||
    receipt.manifestKey !== expectedKey ||
    !Number.isFinite(receipt.verifiedAtMs) ||
    receipt.verifiedAtMs < 0
  )
    throw new Error('Invalid archive receipt for local manifest')
  return receipt
}
