import type { TraceDiffResult, TraceSummary } from './diff.js'
import type { TraceRecord } from './trace.js'

/**
 * Human-readable diff report (22 §3.4): the first divergence with ±context
 * records, every stored field mismatch, auto-class counts and per-side
 * summaries.
 */

export type RecordPair = { index: number; a: TraceRecord | undefined; b: TraceRecord | undefined }

/** Records around the first failing record, collected while streaming. */
export type DivergenceContext = { before: RecordPair[]; at: RecordPair; after: RecordPair[] }

function fmt(r: TraceRecord | undefined): string {
  return r ? JSON.stringify(r) : '<EOF>'
}

function summaryLine(label: string, s: TraceSummary): string {
  const stats = (s.final?.stats ?? null) as Record<string, unknown> | null
  return (
    `  ${label}: records=${s.records} ticks=${s.ticks} (synthetic=${s.syntheticTicks}) intents=${JSON.stringify(s.intents)} ` +
    `(account=${s.accountIntents}) events=${JSON.stringify(s.events)} ` +
    `fills(T/M)=${s.fills.taker}/${s.fills.maker} done=${JSON.stringify(s.orderDone)} ` +
    `pnl=${stats ? String(stats.pnl) : 'n/a'}`
  )
}

export function formatDiff(
  res: TraceDiffResult,
  labels: { a: string; b: string },
  context: DivergenceContext | null,
  tolerance?: number,
): string {
  const lines: string[] = [`A = ${labels.a}`, `B = ${labels.b}`]
  if (!res.gating) lines.push(`NON-GATING: --tolerance ${String(tolerance)} overrides the v2 rules`)
  if (res.equal) lines.push(`EQUAL (${res.summaryA.records} records)`)
  const first = res.failures[0]
  if (!res.equal && first) {
    lines.push(
      '',
      `FIRST DIVERGENCE at record #${first.index + 1} (${first.recordType}${first.recordKind ? `:${first.recordKind}` : ''})`,
    )
    if (context) {
      lines.push('  context (A | B):')
      for (const p of context.before) {
        lines.push(`    #${p.index + 1} A ${fmt(p.a)}`)
        if (JSON.stringify(p.a) !== JSON.stringify(p.b))
          lines.push(`    #${p.index + 1} B ${fmt(p.b)}`)
      }
      lines.push(`  > #${context.at.index + 1} A ${fmt(context.at.a)}`)
      lines.push(`  > #${context.at.index + 1} B ${fmt(context.at.b)}`)
      for (const p of context.after) {
        lines.push(`    #${p.index + 1} A ${fmt(p.a)}`)
        lines.push(`    #${p.index + 1} B ${fmt(p.b)}`)
      }
    }
  }
  if (res.mismatches.length > 0) {
    lines.push('', `mismatches (failing ${res.failureTotal}; ${res.mismatches.length} stored):`)
    for (const m of res.mismatches.slice(0, 40))
      lines.push(
        `  #${m.index + 1} [${m.kind}] ${m.path}: A=${JSON.stringify(m.a)} B=${JSON.stringify(m.b)}`,
      )
    if (res.mismatches.length > 40) lines.push(`  … ${res.mismatches.length - 40} more stored`)
  }
  const auto = Object.entries(res.autoClasses)
  if (auto.length > 0) lines.push(`auto-classes: ${auto.map(([k, n]) => `${k}=${n}`).join(' ')}`)
  if (res.sequenceDivergence !== null)
    lines.push(
      `sequence diverges at record #${res.sequenceDivergence + 1}; later records were not compared`,
    )
  for (const n of res.notes) lines.push(`note: ${n}`)
  lines.push('', 'summary:', summaryLine('A', res.summaryA), summaryLine('B', res.summaryB))
  return lines.join('\n')
}
