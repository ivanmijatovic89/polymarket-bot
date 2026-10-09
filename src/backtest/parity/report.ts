import { compareRecords, type TraceDiffResult, type TraceSummary } from './diff.js'
import type { TraceRecord } from './trace.js'

/**
 * Human-readable diff report: the first divergence with ±context records,
 * every field mismatch, auto-class counts and per-side summaries
 * (22 §3.4: first divergence with ±5 records of context plus the summaries).
 */
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
  a: readonly TraceRecord[],
  b: readonly TraceRecord[],
  res: TraceDiffResult,
  labels: { a: string; b: string },
  context = 5,
  tolerance?: number,
): string {
  const lines: string[] = [`A = ${labels.a}`, `B = ${labels.b}`]
  if (!res.gating) lines.push(`NON-GATING: --tolerance ${String(tolerance)} overrides the v2 rules`)
  if (res.equal) {
    lines.push(`EQUAL (${a.length} records)`)
  } else {
    const first = res.failures[0]
    if (first) {
      lines.push(
        '',
        `FIRST DIVERGENCE at record #${first.index + 1} (${first.recordType}${first.recordKind ? `:${first.recordKind}` : ''})`,
      )
      const from = Math.max(0, first.index - context)
      lines.push('  context (A | B):')
      for (let i = from; i < first.index; i++) {
        const same =
          a[i] &&
          b[i] &&
          compareRecords(a[i]!, b[i]!, tolerance !== undefined ? { tolerance } : {}).length === 0
        lines.push(`    ${same ? '=' : '!'} #${i + 1} A ${fmt(a[i])}`)
        if (!same) lines.push(`      #${i + 1} B ${fmt(b[i])}`)
      }
      lines.push(`  > #${first.index + 1} A ${fmt(a[first.index])}`)
      lines.push(`  > #${first.index + 1} B ${fmt(b[first.index])}`)
      for (let i = first.index + 1; i <= first.index + context; i++) {
        if (!a[i] && !b[i]) break
        lines.push(`    #${i + 1} A ${fmt(a[i])}`)
        lines.push(`    #${i + 1} B ${fmt(b[i])}`)
      }
    }
  }
  if (res.mismatches.length > 0) {
    lines.push('', `mismatches (${res.mismatches.length}, failing ${res.failures.length}):`)
    for (const m of res.mismatches.slice(0, 40))
      lines.push(
        `  #${m.index + 1} [${m.kind}] ${m.path}: A=${JSON.stringify(m.a)} B=${JSON.stringify(m.b)}`,
      )
    if (res.mismatches.length > 40) lines.push(`  … ${res.mismatches.length - 40} more`)
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
