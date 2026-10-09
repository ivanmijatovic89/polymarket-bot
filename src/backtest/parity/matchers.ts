import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod'
import type { FieldMismatch, TraceDiffResult } from './diff.js'

/**
 * PARITY.md matchers (native/spec/60-verification.md §3.2) and the per-market
 * verdict of HR-6.
 *
 * A matcher `native/parity/matchers/PE-NNNN.json` is declarative: record
 * type, kind, path glob and the event kinds the market must contain; no code.
 */
// D-PENDING: 60 §3.2 keeps class, status, subclass, money and counterfactual in PARITY.md; chose to carry them in the matcher file too, so HR-6 (PM-1/PM-4 verdicts) and HR-8 ("zero markets matched by an open Rust-bug entry") need no PARITY.md parser.
export const MatcherSchema = z
  .strictObject({
    id: z.string().regex(/^PE-[0-9]{4}$/),
    class: z.enum(['TS bug', 'Rust bug', 'Intended model change']),
    /** 60 §3.2 subclass, e.g. `float-boundary` (CL-5, the only maskable one without the user). */
    subclass: z.string().min(1),
    /** 60 §3.2: `yes` when pnl, cost, fees, cash, positions, fills or reservations differ. */
    money: z.enum(['yes', 'no']),
    /**
     * 60 §3.2 `counterfactual`: `patch` (a PM-1 patch exists; the market is
     * trusted only through a passing patched-oracle run), `not-required`
     * (field-only, money = no) or `n/a` (no patch can express it; the market
     * is masked, PM-4, which needs the user's acceptance at G2 unless CL-5).
     */
    counterfactual: z.enum(['patch', 'not-required', 'n/a']),
    status: z.string().min(1),
    recordType: z.enum(['tick', 'feeds', 'intent', 'event', 'final', 'header']),
    kind: z.string().min(1).optional(),
    pathGlob: z.string().min(1),
    requiredEventKinds: z.array(z.string().min(1)).default([]),
  })
  .refine((m) => m.counterfactual !== 'not-required' || m.money === 'no', {
    message: 'counterfactual not-required is only valid for money = no (60 PM-1)',
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
  /**
   * PM-4: the suffix from record `divergenceIndex` (0-based) on is
   * unverified; coverage counts only the records before it (60 §5.6).
   */
  | { verdict: 'masked'; entries: string[]; divergenceIndex: number }
  | { verdict: 'unclassified'; reason: string }
  | { verdict: 'excluded'; reason: string }

/**
 * Whether a matched difference leaves the market unverified without a
 * counterfactual (60 PM-1): a TS-bug or intended-model-change entry with
 * `money = yes`, or any matched difference that shifts the record sequence
 * (the diff stops there, so nothing after it was compared). Rust-bug entries
 * are not trusted by a counterfactual; an open one fails the run (HR-8).
 */
function needsCounterfactual(m: Matcher, f: FieldMismatch): boolean {
  if (m.class === 'Rust bug') return false
  return m.money === 'yes' || f.kind === 'sequence'
}

/** PM-4: masking is allowed under CL-5 (`float-boundary`) or when the entry declares that no patch can express it (`n/a`, user acceptance at G2). */
function maskable(m: Matcher): boolean {
  return m.subclass === 'float-boundary' || m.counterfactual === 'n/a'
}

/**
 * HR-6 verdict for one diffed market:
 * - `identical` when no failing difference remains (auto-classes are
 *   counted, not failures, 60 §3.5);
 * - `classified PE-…` only if every failing difference is matched by exactly
 *   one matcher (CL-1) and none of them needs a counterfactual (PM-1): a
 *   sequence divergence or a `money = yes` entry is never `classified` here,
 *   because the rest of the market was not verified; it is trusted only as
 *   `identical-patched` from a patched-oracle run (PM-2);
 * - `masked` when a counterfactual is required and PM-4 allows masking;
 * - otherwise `unclassified`.
 */
export function classifyMarket(
  diff: TraceDiffResult,
  /** Event kinds present in the market's TS trace (matcher preconditions). */
  eventKinds: ReadonlySet<string>,
  matchers: readonly Matcher[],
): { verdict: MarketVerdict; openRustBug: boolean } {
  if (diff.failures.length === 0 && diff.equal)
    return { verdict: { verdict: 'identical' }, openRustBug: false }
  if (diff.failures.length === 0)
    return {
      verdict: { verdict: 'unclassified', reason: diff.notes.join('; ') || 'incomplete trace' },
      openRustBug: false,
    }
  if (diff.failureTotal > diff.failures.length)
    return {
      verdict: {
        verdict: 'unclassified',
        reason: `${diff.failureTotal} mismatches (over the stored cap)`,
      },
      openRustBug: false,
    }
  const entries = new Set<string>()
  let openRustBug = false
  /** First failure whose entry requires a counterfactual, with that entry. */
  let cfNeeded: { f: FieldMismatch; m: Matcher } | null = null
  let allMaskable = true
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
    if (needsCounterfactual(m, f)) {
      cfNeeded ??= { f, m }
      if (!maskable(m)) allMaskable = false
    }
  }
  const sorted = [...entries].sort()
  if (cfNeeded === null) return { verdict: { verdict: 'classified', entries: sorted }, openRustBug }
  if (allMaskable)
    return {
      verdict: { verdict: 'masked', entries: sorted, divergenceIndex: diff.failures[0]!.index },
      openRustBug,
    }
  const why = cfNeeded.f.kind === 'sequence' ? 'shifts the record sequence' : 'money = yes'
  return {
    verdict: {
      verdict: 'unclassified',
      reason: `#${cfNeeded.f.index + 1} ${cfNeeded.f.path}: ${cfNeeded.m.id} ${why}; it needs a passing patched-oracle run (60 PM-1, PM-2)`,
    },
    openRustBug,
  }
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
