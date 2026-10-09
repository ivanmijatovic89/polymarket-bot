// L1 report model, determinism check and Markdown rendering
// (16 §13.4, §13.5, §13.7, §13.8). The JSON file holds every row, its
// conditions and the raw repetitions; the Markdown file is the readable form.

import type { ConditionLabel } from './conditions.js'
import type { HostFacts } from './hostFacts.js'
import { coreSummary, formatBytes } from './hostFacts.js'
import type { ChildUsage } from './rusage.js'
import type { LoadSample, RunMetrics, Summary } from './stats.js'
import { summarize } from './stats.js'

export interface BinaryInfo {
  /** `A` or `B`. */
  label: string
  path: string
  sha256: string
  /** The file is `data/strategy-artifacts/native/<sha256>` of a canonical build (01 §6). */
  canonical: boolean
}

export interface MarketRecord {
  idx: number
  slug: string
  exitCode: number
  /** `status` of the EngineResult (`ok` | `error`). */
  status: string
  wallMs: number
  usage: ChildUsage
  /** sha256 of the canonical deterministic section (21 §10). */
  detSha256: string
  /** sha256 of the deterministic section without build identity. */
  crossSha256: string
  /** `diagnostics.inputPath` (`tape` | `v1`), when reported. */
  inputPath: string | null
}

export interface RunRecord {
  /** Position in the executed schedule (1-based). */
  order: number
  bin: string
  rep: number
  warmup: boolean
  startedAt: string
  metrics: RunMetrics
  loadBefore: number[]
  loadAfter: number[]
  /** Set digest over deterministic sections, sorted by (idx, candidate). */
  digest: string
  crossDigest: string
  failedMarkets: number
  inputPaths: Record<string, number>
  markets: MarketRecord[]
}

export interface DeterminismVerdict {
  ok: boolean
  /** Distinct run digests per binary label (one each when deterministic). */
  perBinary: Record<string, string[]>
  /** Distinct cross-binary digests over all runs. */
  crossBinary: string[]
  /** First markets whose hashes differ between runs (at most 20). */
  differingMarkets: Array<{ idx: number; slug: string; hashes: Record<string, string> }>
}

export interface BenchReport {
  schemaVersion: 1
  level: 'L1'
  generatedAt: string
  set: { name: string; path: string; sha256: string; markets: number }
  host: HostFacts
  conditions: {
    label: ConditionLabel
    reasons: string[]
    quietHostConfirmed: boolean
    fleetProcessCount: number
    preStartLoad1: number[]
    loadDuring: Summary | null
    loadSamples: LoadSample[]
    psTop: string[]
    startedAtLocal: string
  }
  config: {
    concurrency: number
    reps: number
    qos: string
    /** How the QoS was applied; the effective class is not read back for `run`. */
    qosMechanism: string
    profile: string
    cacheBudget: string
    inputPaths: Record<string, number>
    strategyId: string
    modelConfigSha256: string
    modelConfig: unknown
    jobsDir: string
    wrapper: string
  }
  binaries: BinaryInfo[]
  runs: RunRecord[]
  summary: Array<{
    bin: string
    wallMs: Summary
    marketsPerS: Summary
    cpuUtilization: Summary
    peakRssBytes: Summary
  }>
  determinism: DeterminismVerdict
}

/** 16 §13.7 over every run (warm-ups included): one digest per binary, one across binaries. */
export function checkDeterminism(runs: readonly RunRecord[]): DeterminismVerdict {
  const perBinary: Record<string, string[]> = {}
  const cross = new Set<string>()
  for (const r of runs) {
    const list = (perBinary[r.bin] ??= [])
    if (!list.includes(r.digest)) list.push(r.digest)
    cross.add(r.crossDigest)
  }
  const differingMarkets: DeterminismVerdict['differingMarkets'] = []
  const byIdx = new Map<number, { slug: string; hashes: Record<string, string> }>()
  for (const r of runs) {
    for (const m of r.markets) {
      const e = byIdx.get(m.idx) ?? { slug: m.slug, hashes: {} }
      e.hashes[`${r.bin}#${r.warmup ? 'warmup' : r.rep}`] = `${m.detSha256}/${m.crossSha256}`
      byIdx.set(m.idx, e)
    }
  }
  const ok = Object.values(perBinary).every((d) => d.length === 1) && cross.size <= 1
  if (!ok) {
    for (const [idx, e] of [...byIdx.entries()].sort((a, b) => a[0] - b[0])) {
      const perBin = new Map<string, Set<string>>()
      const crossSet = new Set<string>()
      for (const [k, h] of Object.entries(e.hashes)) {
        const [det, crossH] = h.split('/')
        const bin = k.split('#')[0] ?? k
        const s = perBin.get(bin) ?? new Set<string>()
        s.add(det ?? '')
        perBin.set(bin, s)
        crossSet.add(crossH ?? '')
      }
      if ([...perBin.values()].some((s) => s.size > 1) || crossSet.size > 1) {
        differingMarkets.push({ idx, slug: e.slug, hashes: e.hashes })
        if (differingMarkets.length >= 20) break
      }
    }
  }
  return { ok, perBinary, crossBinary: [...cross], differingMarkets }
}

export function summarizeRuns(runs: readonly RunRecord[]): BenchReport['summary'] {
  const bins = [...new Set(runs.map((r) => r.bin))]
  return bins.map((bin) => {
    const measured = runs.filter((r) => r.bin === bin && !r.warmup)
    if (measured.length === 0) throw new Error(`no measured runs for binary ${bin}`)
    return {
      bin,
      wallMs: summarize(measured.map((r) => r.metrics.wallMs)),
      marketsPerS: summarize(measured.map((r) => r.metrics.marketsPerS)),
      cpuUtilization: summarize(measured.map((r) => r.metrics.cpuUtilization)),
      peakRssBytes: summarize(measured.map((r) => r.metrics.peakRssBytes)),
    }
  })
}

const f2 = (n: number): string => n.toFixed(2)
const s3 = (ms: number): string => (ms / 1000).toFixed(3)
const mib = (b: number): string => (b / (1024 * 1024)).toFixed(1)
const load = (l: readonly number[]): string => l.map(f2).join(' ')
const range = (s: Summary, fmt: (n: number) => string): string =>
  `${fmt(s.median)} (${fmt(s.min)}–${fmt(s.max)})`
const tally = (t: Record<string, number>): string =>
  Object.keys(t).length === 0
    ? 'not reported'
    : Object.entries(t)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')

export function renderMarkdown(r: BenchReport): string {
  const c = r.conditions
  const lines: string[] = []
  lines.push(`# L1 benchmark: ${r.set.name} on ${r.host.host} (${r.generatedAt.slice(0, 10)})`)
  lines.push('')
  if (c.label === 'non-idle') {
    lines.push('**`non-idle`**: these numbers serve only as interleaved before/after pairs within')
    lines.push('this sitting, never as regression or gate evidence (16 §13.5). Reasons:')
    for (const reason of c.reasons) lines.push(`- ${reason}`)
  } else {
    lines.push('**`idle`**: every quiet-host condition of 16 §13.5 held.')
  }
  lines.push('')
  lines.push('## Conditions (16 §13.5)')
  lines.push('')
  lines.push(`- Host: ${r.host.host}, ${coreSummary(r.host)}, ${formatBytes(r.host.memBytes)}`)
  lines.push(
    `- macOS ${r.host.macos.productVersion} (${r.host.macos.build}); ${r.host.rustc}; Node ${r.host.node}`,
  )
  lines.push(
    `- Started ${c.startedAtLocal} local; quiet host confirmed: ${c.quietHostConfirmed ? 'yes' : 'no'}`,
  )
  lines.push(`- Fleet / Global Runtime processes seen: ${c.fleetProcessCount}`)
  lines.push(
    `- Load average (1 min) during the run: ${c.loadDuring === null ? 'not sampled' : range(c.loadDuring, f2)}` +
      `; pre-start samples: ${c.preStartLoad1.length === 0 ? 'none' : load(c.preStartLoad1)}`,
  )
  lines.push(
    `- Power: ${r.host.powerSource ?? 'unknown'}; Low Power Mode ${r.host.lowPowerMode === null ? 'unknown' : r.host.lowPowerMode ? 'on' : 'off'}`,
  )
  lines.push('')
  lines.push('## Configuration')
  lines.push('')
  lines.push(
    `- Set: \`${r.set.path}\` (${r.set.markets} markets), manifest sha256 \`${r.set.sha256}\``,
  )
  lines.push(
    `- Strategy: \`${r.config.strategyId}\`; ModelConfig sha256 \`${r.config.modelConfigSha256}\``,
  )
  lines.push(
    `- T (concurrent \`run\` processes): ${r.config.concurrency}; repetitions: ${r.config.reps} + 1 warm-up per binary`,
  )
  lines.push(`- QoS: ${r.config.qos} (${r.config.qosMechanism})`)
  lines.push(`- Profile: ${r.config.profile}; cache budget: ${r.config.cacheBudget}`)
  lines.push(`- Input path: ${tally(r.config.inputPaths)}`)
  lines.push(`- Jobs: \`${r.config.jobsDir}\`; per-process wrapper: \`${r.config.wrapper}\``)
  for (const b of r.binaries) {
    lines.push(
      `- Binary ${b.label}: \`${b.path}\` sha256 \`${b.sha256}\`${b.canonical ? '' : ' (**not canonical**)'}`,
    )
  }
  lines.push('')
  lines.push('## Results (median, min–max over measured repetitions)')
  lines.push('')
  lines.push('| Binary | Wall s | Markets/s | CPU utilization | Peak RSS MiB (max child) |')
  lines.push('|---|---|---|---|---|')
  for (const s of r.summary) {
    lines.push(
      `| ${s.bin} | ${range(s.wallMs, s3)} | ${range(s.marketsPerS, f2)} | ${range(s.cpuUtilization, f2)} | ${range(s.peakRssBytes, mib)} |`,
    )
  }
  lines.push('')
  lines.push('## Repetitions (execution order)')
  lines.push('')
  lines.push(
    '| # | Binary | Rep | Wall s | Markets/s | User s | Sys s | CPU util | Peak RSS MiB | Load before → after | Failed | Digest |',
  )
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const run of r.runs) {
    const m = run.metrics
    lines.push(
      `| ${run.order} | ${run.bin} | ${run.warmup ? 'warm-up' : run.rep} | ${s3(m.wallMs)} | ${f2(m.marketsPerS)} | ${s3(m.userMs)} | ${s3(m.sysMs)} | ${f2(m.cpuUtilization)} | ${mib(m.peakRssBytes)} | ${f2(run.loadBefore[0] ?? NaN)} → ${f2(run.loadAfter[0] ?? NaN)} | ${run.failedMarkets} | \`${run.digest.slice(0, 12)}\` |`,
    )
  }
  lines.push('')
  lines.push('## Determinism (16 §13.7)')
  lines.push('')
  const d = r.determinism
  if (d.ok) {
    lines.push(`OK: every run of every binary produced the same deterministic-section digest.`)
  } else {
    lines.push('**MISMATCH**: a determinism bug; it blocks the change under test (16 §13.7, DP-6).')
  }
  for (const [bin, digests] of Object.entries(d.perBinary)) {
    lines.push(`- Binary ${bin}: ${digests.map((x) => `\`${x}\``).join(', ')}`)
  }
  lines.push(
    `- Across binaries (build identity excluded): ${d.crossBinary.map((x) => `\`${x}\``).join(', ')}`,
  )
  for (const m of d.differingMarkets) lines.push(`- differs: idx ${m.idx} \`${m.slug}\``)
  lines.push('')
  lines.push(
    `CPU utilization = (user + sys) / (wall × ${r.host.logicalCpu} logical cores) (16 §13.4).`,
  )
  lines.push(
    `User/sys/RSS come from \`/usr/bin/time -l\` per \`run\` process (10 ms time resolution).`,
  )
  lines.push('')
  return lines.join('\n')
}
