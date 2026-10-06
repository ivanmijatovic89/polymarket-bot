import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import type { CapturedEvent } from '../types.js'

export const MAX_LINE_BYTES = 16 * 1024 * 1024

export async function journalFiles(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((name) => /^wal-\d{6}\.jsonl$/.test(name)).sort()
}

/** Only newline-terminated records are committed. A torn final record stays on disk for diagnosis. */
export async function* readJournals(directory: string): AsyncGenerator<CapturedEvent> {
  for (const file of await journalFiles(directory)) {
    let pending = Buffer.alloc(0)
    for await (const bytes of createReadStream(path.join(directory, file))) {
      pending = Buffer.concat([pending, bytes as Buffer])
      let newline: number
      while ((newline = pending.indexOf(10)) >= 0) {
        const line = pending.subarray(0, newline)
        pending = pending.subarray(newline + 1)
        if (line.byteLength > MAX_LINE_BYTES) throw new Error('Journal row exceeds size limit')
        const record = JSON.parse(line.toString('utf8')) as { sha256: string; event: CapturedEvent }
        const value = record.event
        if (
          !value ||
          createHash('sha256').update(JSON.stringify(value)).digest('hex') !== record.sha256
        )
          throw new Error('Journal record checksum mismatch')
        if (
          value.schemaVersion !== 4 ||
          !/^\d+$/.test(value.sequence) ||
          typeof value.rawJson !== 'string'
        )
          throw new Error('Invalid journal event')
        yield value
      }
      if (pending.byteLength > MAX_LINE_BYTES) throw new Error('Journal tail exceeds size limit')
    }
  }
}
