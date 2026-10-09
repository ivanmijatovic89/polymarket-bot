import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod'
import type { FieldMismatch, TraceDiffResult } from './diff.js'
import type { TraceRecord } from './trace.js'

/**
 * PARITY.md matchers (native/spec/60-verification.md §3.2) and the per-market
 * verdict of HR-6.
 *
 * A matcher `native/parity/matchers/PE-NNNN.json` is declarative: record
 * type, kind, path glob and the event kinds the market must contain; no code.
 */
// D-PENDING: 60 §3.2 keeps class and status in PARITY.md; chose to carry them in the matcher file too, so HR-8 ("zero markets matched by an open Rust-bug entry") needs no PARITY.md parser.
export const MatcherSchema = z.strictObject({
  id: z.string().regex(/^PE-[0-9]{4}$/),
  class: z.enum(['TS bug', 'Rust bug', 'Intended model change']),
  status: z.string().min(1),
  recordType: z.enum(['tick', 'feeds', 'intent', 'event', 'final', 'header']),
  kind: z.string().min(1).optional(),
  pathGlob: z.string().min(1),
  requiredEventKinds: z.array(z.string().min(1)).default([]),
})

export type Matcher = z.infer<typeof MatcherSchema>

export function loadMatchers(dir: string): Matcher[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const parsed = MatcherSchema.safeParse(JSON.parse(readFileSync(path.join(dir, f), 'utf8')))
      if (!parsed.success) throw new Error(`invalid matcher ${f}: ${z.prettifyError(parsed.error)}`)
      if (`${parsed.data.id}.json` !== f)
        throw new Error(`matcher ${f}: id ${parsed.data.id} != file name`)
      return parsed.data
    })
}

/** Glob over a mismatch path: `*` matches within one segment, `**` across segments. */
export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
      } else re += '[^.\\[]*'
    } else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

export function matcherMatches(
  m: Matcher,
  mm: FieldMismatch,
  eventKinds: ReadonlySet<string>,
): boolean {
  if (m.recordType !== mm.recordType) return false
  if (m.kind !== undefined && m.kind !== mm.recordKind) return false
  if (!globToRegExp(m.pathGlob).test(mm.path)) return false
  return m.requiredEventKinds.every((k) => eventKinds.has(k))
}

export type MarketVerdict =
  | { verdict: 'identical' }
  | { verdict: 'identical-patched' }
  | { verdict: 'classified'; entries: string[] }
  | { verdict: 'masked'; entries: string[] }
  | { verdict: 'unclassified'; reason: string }
  | { verdict: 'excluded'; reason: string }

/**
 * HR-6 verdict for one diffed market: `identical` when no failing
 * difference remains (auto-classes are counted, not failures, 60 §3.5);
 * `classified PE-…` only if every failing difference is matched by exactly
 * one matcher (CL-1); otherwise `unclassified`.
 */
export function classifyMarket(
  diff: TraceDiffResult,
  tsRecords: readonly TraceRecord[],
  matchers: readonly Matcher[],
): { verdict: MarketVerdict; openRustBug: boolean } {
  if (diff.failures.length === 0 && diff.equal)
    return { verdict: { verdict: 'identical' }, openRustBug: false }
  if (diff.failures.length === 0)
    return {
      verdict: { verdict: 'unclassified', reason: diff.notes.join('; ') || 'incomplete trace' },
      openRustBug: false,
    }
  const eventKinds = new Set(tsRecords.filter((r) => r.t === 'event').map((r) => String(r.kind)))
  const entries = new Set<string>()
  let openRustBug = false
  for (const f of diff.failures) {
    const hits = matchers.filter((m) => matcherMatches(m, f, eventKinds))
    if (hits.length !== 1) {
      const why =
        hits.length === 0
          ? 'no matcher'
          : `${hits.length} matchers (${hits.map((h) => h.id).join(', ')})`
      return {
        verdict: { verdict: 'unclassified', reason: `#${f.index + 1} ${f.path}: ${why}` },
        openRustBug: openRustBug || hits.some((h) => h.class === 'Rust bug' && h.status === 'open'),
      }
    }
    const m = hits[0]!
    entries.add(m.id)
    if (m.class === 'Rust bug' && m.status === 'open') openRustBug = true
  }
  return { verdict: { verdict: 'classified', entries: [...entries].sort() }, openRustBug }
}

export function verdictLabel(v: MarketVerdict): string {
  switch (v.verdict) {
    case 'classified':
    case 'masked':
      return `${v.verdict} ${v.entries.join(',')}`
    case 'unclassified':
    case 'excluded':
      return `${v.verdict} (${v.reason})`
    default:
      return v.verdict
  }
}
