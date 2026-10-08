import { compareRecords, type TraceDiffResult, type TraceSummary } from './diff.js'
import type { TraceRecord } from './trace.js'

/** Human-readable diff report (first divergence with context, final stats, summaries). */
function fmt(r: TraceRecord | undefined): string {
  return r ? JSON.stringify(r) : '<EOF>'
}

function summaryLine(label: string, s: TraceSummary): string {
  const stats = (s.final?.stats ?? null) as Record<string, unknown> | null
  return (
    `  ${label}: records=${s.records} ticks=${s.ticks} intents=${JSON.stringify(s.intents)} ` +
    `(account=${s.accountIntents}) events=${JSON.stringify(s.events)} ` +
    `fills(T/M)=${s.fills.taker}/${s.fills.maker} done=${JSON.stringify(s.orderDone)} ` +
    `pnl=${stats ? String(stats.pnl) : 'n/a'}`
  )
}

export function printDiff(
  a: readonly TraceRecord[],
  b: readonly TraceRecord[],
  res: TraceDiffResult,
  labels: { a: string; b: string },
  context: number,
  tolerance: number,
): void {
  console.log(`A = ${labels.a}`)
  console.log(`B = ${labels.b}`)
  if (res.equal) {
    console.log(`EQUAL (${a.length} records, tolerance ${tolerance})`)
  } else {
    for (const d of res.divergences) {
      const where = d.a ?? d.b
      console.log(
        `\nDIVERGENCE at record #${d.index + 1}` +
          (where && 'seq' in where ? ` (strategy tick seq=${String(where.seq)})` : ''),
      )
      for (const m of d.mismatches.slice(0, 12))
        console.log(`  ${m.path}: A=${JSON.stringify(m.a)} B=${JSON.stringify(m.b)}`)
      if (d.mismatches.length > 12) console.log(`  … ${d.mismatches.length - 12} more fields`)
      const from = Math.max(0, d.index - context)
      console.log('  context (A | B):')
      for (let i = from; i < d.index; i++) {
        const same = a[i] && b[i] && compareRecords(a[i]!, b[i]!, tolerance).length === 0
        console.log(`    ${same ? '=' : '!'} #${i + 1} A ${fmt(a[i])}`)
        if (!same) console.log(`      #${i + 1} B ${fmt(b[i])}`)
      }
      console.log(`  > #${d.index + 1} A ${fmt(d.a)}`)
      console.log(`  > #${d.index + 1} B ${fmt(d.b)}`)
      for (let i = d.index + 1; i <= d.index + context; i++) {
        if (!a[i] && !b[i]) break
        console.log(`    #${i + 1} A ${fmt(a[i])}`)
        console.log(`    #${i + 1} B ${fmt(b[i])}`)
      }
    }
  }
  // Final stats are compared even when the sequence diverged earlier.
  const fa = a.at(-1)
  const fb = b.at(-1)
  if (fa?.t === 'final' && fb?.t === 'final') {
    const m = compareRecords(fa, fb, tolerance)
    console.log(
      m.length === 0
        ? '\nfinal stats: EQUAL'
        : `\nfinal stats: DIFFER\n${m
            .slice(0, 20)
            .map((x) => `  ${x.path}: A=${JSON.stringify(x.a)} B=${JSON.stringify(x.b)}`)
            .join('\n')}`,
    )
  }
  for (const n of res.notes) console.log(`note: ${n}`)
  console.log('\nsummary:')
  console.log(summaryLine('A', res.summaryA))
  console.log(summaryLine('B', res.summaryB))
}
