import { createHash } from 'node:crypto'
import { TraceDiffer, type DiffOptions, type TraceDiffResult } from './diff.js'
import { streamTrace, type TraceRecord } from './trace.js'

/**
 * Streamed passes over trace files (bounded memory for traces of any size,
 * 22 §3.6): one-pass record scan with the sha256 of the decompressed bytes,
 * and the v2 diff of two files read in lockstep (22 §3.4).
 */

/**
 * Visit every record and return the sha256 of the decompressed JSONL bytes
 * (each line plus its newline; trace writers emit no blank lines).
 */
export async function scanTrace(
  file: string,
  onRecord?: (r: TraceRecord) => void,
): Promise<string> {
  const hash = createHash('sha256')
  for await (const { record, line } of streamTrace(file)) {
    hash.update(line)
    hash.update('\n')
    onRecord?.(record)
  }
  return hash.digest('hex')
}

/** Diff two trace files record by record; also returns the event kinds of A (matcher preconditions). */
export async function diffTraceFiles(
  fileA: string,
  fileB: string,
  opts: DiffOptions = {},
  onPair?: (index: number, a: TraceRecord | undefined, b: TraceRecord | undefined) => void,
): Promise<{ diff: TraceDiffResult; eventKinds: Set<string> }> {
  const ia = streamTrace(fileA)[Symbol.asyncIterator]()
  const ib = streamTrace(fileB)[Symbol.asyncIterator]()
  const differ = new TraceDiffer(opts)
  const eventKinds = new Set<string>()
  for (let i = 0; ; i++) {
    const [xa, xb] = await Promise.all([ia.next(), ib.next()])
    if (xa.done && xb.done) break
    const ra = xa.done ? undefined : xa.value.record
    const rb = xb.done ? undefined : xb.value.record
    if (ra?.t === 'event') eventKinds.add(String(ra.kind))
    differ.next(ra, rb)
    onPair?.(i, ra, rb)
  }
  return { diff: differ.finish(), eventKinds }
}
