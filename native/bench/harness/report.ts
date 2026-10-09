// L1 row model, determinism check and Markdown rendering (16 §13.4, §13.5,
// §13.7, §13.8). A row is one sitting of the L1 driver on one bench set:
// one or more arms (configurations), interleaved ABBA. The report file
// (reportFile.ts) holds every row with its conditions and raw repetitions.

import { nodeAt, readLiteral, readValue, type JsonNode } from './canonicalJson.js'
import type { ConditionLabel, OtherWork, PsCheck } from './conditions.js'
import type { HostFacts } from './hostFacts.js'
import { coreSummary, formatBytes } from './hostFacts.js'
import type { ChildUsage } from './rusage.js'
import type { LoadSample, RunMetrics, Summary } from './stats.js'
import { summarize } from './stats.js'

/** `describe` identity of a binary (20 §3, §5.1), when it could be read. */
export interface DescribeBinary {
  engineVersion: string | null
  engineCommit: string | null
  engineDirty: boolean | null
  rustc: string | null
  target: string | null
  buildProfile: string | null
}

export interface BinaryInfo {
  path: string
  sha256: string
  /** Canonical artifact build (01 §6, 31 §6.1): see `canonicalReasons`. */
  canonical: boolean
  /** Why the binary is not canonical (empty when canonical). */
  canonicalReasons: string[]
  /** sha256 of `<sha>.build.json` next to the binary, when present. */
  buildManifestSha256: string | null
  describe: DescribeBinary | null
}

/** Effective QoS class read back through the arm's own wrapper (16 §10.2). */
export interface EffectiveQos {
  /** `qos_class_self()` as named by <sys/qos.h>, or null when unreadable. */
  className: string | null
  raw: number | null
  method: string
}

/** One configuration of a row (16 §13.3, §13.5 "interleaved ABBA across configurations"). */
export interface ArmInfo {
  /** `A`, `B`, … */
  label: string
  binary: BinaryInfo
  /** Concurrent `run` processes (T of a process-per-job row). */
  concurrency: number
  /** QoS clamp applied to each `run` (`default` = none). */
  qos: string
  effectiveQos: EffectiveQos
  /** `--tape-dir` passed to `run` (20 §5.4), or null. */
  tapeDir: string | null
  /** Extra `run` arguments derived from the arm. */
  runArgs: string[]
  cacheBudget: string
}

export interface MarketDiagnostics {
  cacheHits: number | null
  cacheMisses: number | null
  strategyTicksSkipped: number | null
  /** `diagnostics.phases` (name → ms) of a `phase-timers` build, when present. */
  phases: Record<string, number> | null
  /** `diagnostics.bytesDecoded`, when present. */
  bytesDecoded: number | null
}

export interface MarketRecord {
  idx: number
  slug: string
  exitCode: number
  /** `status` of the EngineResult (`ok` | `error`). */
  status: string
  /** `candidates[0].status`, when present. */
  candidateStatus: string | null
  /** `error.class` (or the candidate's), when the market failed. */
  errorClass: string | null
  /** exit 0, `status` ok and candidate ok (20 §5.4). */
  ok: boolean
  wallMs: number
  usage: ChildUsage
  /** sha256 of the canonical deterministic section (21 §10). */
  detSha256: string
  /** sha256 of the deterministic section without build identity. */
  crossSha256: string
  /** `diagnostics.inputPath` (`tape` | `v1`), when reported. */
  inputPath: string | null
  diagnostics: MarketDiagnostics
}

export interface RunDiagnostics {
  /** Markets that reported each field / the sum over them. */
  cache: { reported: number; hits: number; misses: number }
  strategyTicksSkipped: { reported: number; sum: number }
  phases: { reported: number; sumMs: Record<string, number> }
  bytesDecoded: { reported: number; sum: number }
}

export interface RunRecord {
  /** Position in the executed schedule (1-based). */
  order: number
  arm: string
  rep: number
  warmup: boolean
  startedAt: string
  metrics: RunMetrics
  loadBefore: number[]
  loadAfter: number[]
  /** Set digest over full deterministic sections, sorted by (idx, candidate). */
  digest: string
  /** Set digest over the reduced (build identity removed) sections. */
  crossDigest: string
  inputPaths: Record<string, number>
  diagnostics: RunDiagnostics
  markets: MarketRecord[]
}

export interface DeterminismVerdict {
  ok: boolean
  /** Distinct full digests per binary sha (one each when deterministic). */
  fullPerBinary: Record<string, string[]>
  /** Distinct full digests over all runs (one when every arm runs one binary). */
  fullAcrossArms: string[]
  /** Distinct reduced digests over all runs (must be one). */
  reducedAcrossArms: string[]
  /** `full` when all arms run one binary, else `reduced` (D-PENDING, canonicalJson.ts). */
  crossArmForm: 'full' | 'reduced'
  /** First markets whose hashes differ between runs (at most 20). */
  differingMarkets: Array<{ idx: number; slug: string; hashes: Record<string, string> }>
}

export interface ServiceCpu {
  name: string
  pid: number
  /** CPU time used during the row (`ps -o time=` delta). */
  cpuMs: number
  /** cpuMs / row wall time: cores' worth of CPU (1.0 = one core). */
  coresAvg: number
  /** `ps -o pcpu=` samples during the row. */
  pcpuSamples: number[]
}

export interface L1Row {
  level: 'L1'
  generatedAt: string
  set: {
    name: string
    path: string
    sha256: string
    inputMode: string
    strategy: { id: string; params: Record<string, unknown> }
    modelConfigSha256: string
    modelConfig: unknown
    markets: Array<{ idx: number; slug: string; sha256: string; bytes: number; file: string }>
  }
  dataRoot: string
  jobsDir: string
  host: HostFacts
  conditions: {
    label: ConditionLabel
    reasons: string[]
    quietHostConfirmed: boolean
    psChecks: PsCheck[]
    preStartLoad1: number[]
    loadDuring: Summary | null
    loadSamples: LoadSample[]
    services: ServiceCpu[]
    psTop: string[]
    startedAtLocal: string
    endedAtLocal: string
  }
  reps: number
  wrapper: string
  arms: ArmInfo[]
  coldRead: { files: number; bytes: number; elapsedMs: number; note: string }
  runs: RunRecord[]
  summary: Array<{
    arm: string
    wallMs: Summary
    marketsPerS: Summary
    marketCandidatesPerS: Summary
    cpuUtilization: Summary
    peakRssBytes: Summary
    failedMarkets: number
  }>
  determinism: DeterminismVerdict
  /** Any failed market or a determinism mismatch fails the row (R14). */
  failed: boolean
  failureReasons: string[]
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * Metrics-only fields of one `EngineResult` (21 §10 `diagnostics`).
 * D-PENDING: 21 §10 names `cache.{hits,misses}` and
 * `counters[].strategyTicksSkipped`; the phase timers (16 §13.4
 * `phase-timers`) and bytes decoded have no field name yet, so
 * `diagnostics.phases` and `diagnostics.bytesDecoded` are read when present
 * and reported as "not reported" otherwise.
 */
export function marketDiagnostics(root: JsonNode): MarketDiagnostics {
  let ticks: number | null = null
  const counters = nodeAt(root, 'diagnostics', 'counters')
  if (counters?.t === 'arr') {
    for (let i = 0; i < counters.items.length; i++) {
      const v = num(readLiteral(root, 'diagnostics', 'counters', i, 'strategyTicksSkipped'))
      if (v !== null) ticks = (ticks ?? 0) + v
    }
  }
  const phasesRaw = readValue(root, 'diagnostics', 'phases')
  let phases: Record<string, number> | null = null
  if (typeof phasesRaw === 'object' && phasesRaw !== null && !Array.isArray(phasesRaw)) {
    phases = {}
    for (const [k, v] of Object.entries(phasesRaw)) {
      const n = num(v)
      if (n !== null) phases[k] = n
    }
  }
  return {
    cacheHits: num(readLiteral(root, 'diagnostics', 'cache', 'hits')),
    cacheMisses: num(readLiteral(root, 'diagnostics', 'cache', 'misses')),
    strategyTicksSkipped: ticks,
    phases,
    bytesDecoded: num(readLiteral(root, 'diagnostics', 'bytesDecoded')),
  }
}

export function runDiagnostics(markets: readonly MarketRecord[]): RunDiagnostics {
  const out: RunDiagnostics = {
    cache: { reported: 0, hits: 0, misses: 0 },
    strategyTicksSkipped: { reported: 0, sum: 0 },
    phases: { reported: 0, sumMs: {} },
    bytesDecoded: { reported: 0, sum: 0 },
  }
  for (const m of markets) {
    const d = m.diagnostics
    if (d.cacheHits !== null || d.cacheMisses !== null) {
      out.cache.reported++
      out.cache.hits += d.cacheHits ?? 0
      out.cache.misses += d.cacheMisses ?? 0
    }
    if (d.strategyTicksSkipped !== null) {
      out.strategyTicksSkipped.reported++
      out.strategyTicksSkipped.sum += d.strategyTicksSkipped
    }
    if (d.phases !== null) {
      out.phases.reported++
      for (const [k, v] of Object.entries(d.phases))
        out.phases.sumMs[k] = (out.phases.sumMs[k] ?? 0) + v
    }
    if (d.bytesDecoded !== null) {
      out.bytesDecoded.reported++
      out.bytesDecoded.sum += d.bytesDecoded
    }
  }
  return out
}

/**
 * 16 §13.7 over every run (warm-ups included): one full digest per binary
 * (every arm of one binary, whatever its T, QoS or input path, R7) and one
 * reduced digest across all arms.
 */
export function checkDeterminism(
  runs: readonly RunRecord[],
  armBinary: Readonly<Record<string, string>>,
): DeterminismVerdict {
  const fullPerBinary: Record<string, string[]> = {}
  const full = new Set<string>()
  const reduced = new Set<string>()
  for (const r of runs) {
    const sha = armBinary[r.arm]
    if (sha === undefined) throw new Error(`run of unknown arm ${r.arm}`)
    const list = (fullPerBinary[sha] ??= [])
    if (!list.includes(r.digest)) list.push(r.digest)
    full.add(r.digest)
    reduced.add(r.crossDigest)
  }
  const ok = Object.values(fullPerBinary).every((d) => d.length === 1) && reduced.size <= 1
  const differingMarkets: DeterminismVerdict['differingMarkets'] = []
  if (!ok) {
    const byIdx = new Map<number, { slug: string; hashes: Record<string, string> }>()
    for (const r of runs) {
      for (const m of r.markets) {
        const e = byIdx.get(m.idx) ?? { slug: m.slug, hashes: {} }
        e.hashes[`${r.arm}#${r.warmup ? 'warmup' : r.rep}`] = `${m.detSha256}/${m.crossSha256}`
        byIdx.set(m.idx, e)
      }
    }
    for (const [idx, e] of [...byIdx.entries()].sort((a, b) => a[0] - b[0])) {
      const perBin = new Map<string, Set<string>>()
      const crossSet = new Set<string>()
      for (const [k, h] of Object.entries(e.hashes)) {
        const [det, crossH] = h.split('/')
        const sha = armBinary[k.split('#')[0] ?? k] ?? k
        const s = perBin.get(sha) ?? new Set<string>()
        s.add(det ?? '')
        perBin.set(sha, s)
        crossSet.add(crossH ?? '')
      }
      if ([...perBin.values()].some((s) => s.size > 1) || crossSet.size > 1) {
        differingMarkets.push({ idx, slug: e.slug, hashes: e.hashes })
        if (differingMarkets.length >= 20) break
      }
    }
  }
  return {
    ok,
    fullPerBinary,
    fullAcrossArms: [...full],
    reducedAcrossArms: [...reduced],
    crossArmForm: new Set(Object.values(armBinary)).size <= 1 ? 'full' : 'reduced',
    differingMarkets,
  }
}

export function summarizeRuns(runs: readonly RunRecord[]): L1Row['summary'] {
  const arms = [...new Set(runs.map((r) => r.arm))]
  return arms.map((arm) => {
    const measured = runs.filter((r) => r.arm === arm && !r.warmup)
    if (measured.length === 0) throw new Error(`no measured runs for arm ${arm}`)
    return {
      arm,
      wallMs: summarize(measured.map((r) => r.metrics.wallMs)),
      marketsPerS: summarize(measured.map((r) => r.metrics.marketsPerS)),
      marketCandidatesPerS: summarize(measured.map((r) => r.metrics.marketCandidatesPerS)),
      cpuUtilization: summarize(measured.map((r) => r.metrics.cpuUtilization)),
      peakRssBytes: summarize(measured.map((r) => r.metrics.peakRssBytes)),
      failedMarkets: runs
        .filter((r) => r.arm === arm)
        .reduce((n, r) => n + r.metrics.failedMarkets, 0),
    }
  })
}

/** Row failure: any failed market (warm-ups included) or a determinism mismatch. */
export function rowFailures(runs: readonly RunRecord[], det: DeterminismVerdict): string[] {
  const out: string[] = []
  const failed = runs.reduce((n, r) => n + r.metrics.failedMarkets, 0)
  if (failed > 0) {
    const examples = runs
      .flatMap((r) =>
        r.markets
          .filter((m) => !m.ok)
          .map((m) => `${m.slug} (${m.errorClass ?? `exit ${m.exitCode}`})`),
      )
      .slice(0, 3)
    out.push(`${failed} failed market run(s), e.g. ${examples.join(', ')}`)
  }
  if (!det.ok) out.push('determinism mismatch (16 §13.7)')
  return out
}

const f2 = (n: number): string => n.toFixed(2)
const s3 = (ms: number): string => (ms / 1000).toFixed(3)
const mib = (b: number): string => (b / (1024 * 1024)).toFixed(1)
const range = (s: Summary, fmt: (n: number) => string): string =>
  `${fmt(s.median)} (${fmt(s.min)}–${fmt(s.max)})`
const tally = (t: Record<string, number>): string =>
  Object.keys(t).length === 0
    ? 'not reported'
    : Object.entries(t)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')

function workLines(work: readonly OtherWork[]): string[] {
  return work
    .slice(0, 12)
    .map(
      (w) =>
        `  - pid ${w.pid} ${w.kind}${w.cwd === null ? '' : ` (cwd ${w.cwd})`}: \`${w.args.slice(0, 120)}\``,
    )
}

function diagLine(runs: readonly RunRecord[]): string[] {
  const measured = runs.filter((r) => !r.warmup)
  const total = measured.reduce((n, r) => n + r.markets.length, 0)
  const sum = <T>(f: (d: RunDiagnostics) => T, g: (acc: number, v: T) => number): number =>
    measured.reduce((acc, r) => g(acc, f(r.diagnostics)), 0)
  const cacheN = sum(
    (d) => d.cache.reported,
    (a, v) => a + v,
  )
  const ticksN = sum(
    (d) => d.strategyTicksSkipped.reported,
    (a, v) => a + v,
  )
  const phasesN = sum(
    (d) => d.phases.reported,
    (a, v) => a + v,
  )
  const bytesN = sum(
    (d) => d.bytesDecoded.reported,
    (a, v) => a + v,
  )
  const lines: string[] = []
  lines.push(
    `- Cache (21 §10 \`diagnostics.cache\`): ${
      cacheN === 0
        ? 'not reported'
        : `${sum(
            (d) => d.cache.hits,
            (a, v) => a + v,
          )} hits, ${sum(
            (d) => d.cache.misses,
            (a, v) => a + v,
          )} misses over ${cacheN} of ${total} market runs`
    }`,
  )
  lines.push(
    `- \`strategyTicksSkipped\`: ${
      ticksN === 0
        ? 'not reported'
        : `${sum(
            (d) => d.strategyTicksSkipped.sum,
            (a, v) => a + v,
          )} over ${ticksN} of ${total} market runs`
    }`,
  )
  lines.push(
    `- Bytes decoded: ${
      bytesN === 0
        ? 'not reported'
        : `${sum(
            (d) => d.bytesDecoded.sum,
            (a, v) => a + v,
          )} over ${bytesN} of ${total} market runs`
    }`,
  )
  if (phasesN === 0) {
    lines.push(
      '- Phase profile and engine-vs-strategy share: not reported (no `phase-timers` build)',
    )
  } else {
    const sumMs: Record<string, number> = {}
    for (const r of measured)
      for (const [k, v] of Object.entries(r.diagnostics.phases.sumMs))
        sumMs[k] = (sumMs[k] ?? 0) + v
    const all = Object.values(sumMs).reduce((a, b) => a + b, 0)
    lines.push(
      `- Phases (${phasesN} of ${total} market runs): ` +
        Object.entries(sumMs)
          .map(([k, v]) => `${k} ${all > 0 ? ((100 * v) / all).toFixed(1) : '0.0'}%`)
          .join(', '),
    )
  }
  return lines
}

/** Markdown section of one L1 row. */
export function renderL1Row(r: L1Row, rowNumber: number): string {
  const c = r.conditions
  const lines: string[] = []
  lines.push(
    `## Row ${rowNumber}: L1 \`${r.set.name}\`, ${r.arms.map((a) => a.label).join('/')} (${c.startedAtLocal} – ${c.endedAtLocal.slice(11)})`,
  )
  lines.push('')
  if (r.failed) {
    lines.push('**FAILED**: these numbers are not valid evidence. Reasons:')
    for (const reason of r.failureReasons) lines.push(`- ${reason}`)
    lines.push('')
  }
  if (c.label === 'non-idle') {
    lines.push('**`non-idle`**: these numbers serve only as interleaved before/after pairs within')
    lines.push('this sitting, never as regression or gate evidence (16 §13.5). Reasons:')
    for (const reason of c.reasons) lines.push(`- ${reason}`)
  } else {
    lines.push('**`idle`**: every quiet-host condition of 16 §13.5 held over the whole row.')
  }
  lines.push('')
  lines.push('### Conditions (16 §13.5)')
  lines.push('')
  lines.push(`- Host: ${r.host.host}, ${coreSummary(r.host)}, ${formatBytes(r.host.memBytes)}`)
  lines.push(
    `- macOS ${r.host.macos.productVersion} (${r.host.macos.build}); host ${r.host.rustc}; Node ${r.host.node}`,
  )
  lines.push(`- Quiet host confirmed: ${c.quietHostConfirmed ? 'yes' : 'no'}`)
  for (const check of c.psChecks) {
    lines.push(
      `- ps check (${check.phase}, ${s3(check.tMs)} s): ${check.work.length === 0 ? 'no other work' : `${check.work.length} other process(es)`}`,
    )
    if (check.phase !== 'during') lines.push(...workLines(check.work))
  }
  lines.push(
    `- Load average (1 min) during the row: ${c.loadDuring === null ? 'not sampled' : range(c.loadDuring, f2)}` +
      `; pre-start samples: ${c.preStartLoad1.length === 0 ? 'none' : c.preStartLoad1.map(f2).join(' ')}`,
  )
  for (const s of c.services) {
    lines.push(
      `- ${s.name} (pid ${s.pid}): ${s3(s.cpuMs)} s CPU during the row (${f2(s.coresAvg)} cores on average); pcpu samples ${s.pcpuSamples.length === 0 ? 'none' : range(summarize(s.pcpuSamples), f2)}`,
    )
  }
  if (c.services.length === 0) lines.push('- Redis / MySQL: not running on this host')
  lines.push(
    `- Power: ${r.host.powerSource ?? 'unknown'}; Low Power Mode ${r.host.lowPowerMode === null ? 'unknown' : r.host.lowPowerMode ? 'on' : 'off'}`,
  )
  lines.push(
    `- Cold read (before the warm-ups): ${r.coldRead.files} files, ${mib(r.coldRead.bytes)} MiB in ${s3(r.coldRead.elapsedMs)} s; ${r.coldRead.note}`,
  )
  lines.push('')
  lines.push('### Configuration')
  lines.push('')
  lines.push(
    `- Set: \`${r.set.path}\` (${r.set.markets.length} markets, ${r.set.inputMode}), manifest sha256 \`${r.set.sha256}\``,
  )
  lines.push(
    `- Strategy: \`${r.set.strategy.id}\` params \`${JSON.stringify(r.set.strategy.params)}\`; ModelConfig sha256 \`${r.set.modelConfigSha256}\``,
  )
  lines.push(`- Data root: \`${r.dataRoot}\`; jobs: \`${r.jobsDir}\``)
  lines.push(
    `- Repetitions: ${r.reps} per arm + 1 warm-up per arm, ABBA; per-process wrapper \`${r.wrapper}\``,
  )
  lines.push('')
  lines.push(
    '| Arm | Binary sha256 | Canonical | Profile (describe) | rustc (describe) | T | QoS | Effective QoS | Tape dir | Cache budget |',
  )
  lines.push('|---|---|---|---|---|---|---|---|---|---|')
  for (const a of r.arms) {
    const d = a.binary.describe
    lines.push(
      `| ${a.label} | \`${a.binary.sha256.slice(0, 16)}…\` | ${a.binary.canonical ? 'yes' : `no: ${a.binary.canonicalReasons.join('; ')}`} | ${d?.buildProfile ?? 'unknown'} | ${d?.rustc ?? 'unknown'} | ${a.concurrency} | ${a.qos} | ${a.effectiveQos.className ?? 'unknown'} | ${a.tapeDir ?? '—'} | ${a.cacheBudget} |`,
    )
  }
  lines.push('')
  lines.push('### Results (median, min–max over measured repetitions)')
  lines.push('')
  lines.push(
    '| Arm | Wall s | Markets/s (ok) | Market-candidates/s | CPU utilization | Peak RSS MiB (max child) | Failed market runs |',
  )
  lines.push('|---|---|---|---|---|---|---|')
  for (const s of r.summary) {
    lines.push(
      `| ${s.arm} | ${range(s.wallMs, s3)} | ${range(s.marketsPerS, f2)} | ${range(s.marketCandidatesPerS, f2)} | ${range(s.cpuUtilization, f2)} | ${range(s.peakRssBytes, mib)} | ${s.failedMarkets} |`,
    )
  }
  lines.push('')
  const inputPaths: Record<string, number> = {}
  for (const run of r.runs.filter((x) => !x.warmup))
    for (const [k, v] of Object.entries(run.inputPaths)) inputPaths[k] = (inputPaths[k] ?? 0) + v
  lines.push(`- Input path (measured runs): ${tally(inputPaths)}`)
  lines.push(...diagLine(r.runs))
  lines.push('')
  lines.push('### Repetitions (execution order)')
  lines.push('')
  lines.push(
    '| # | Arm | Rep | Wall s | Markets/s | User s | Sys s | CPU util | Peak RSS MiB | Load before → after | Failed | Digest |',
  )
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const run of r.runs) {
    const m = run.metrics
    lines.push(
      `| ${run.order} | ${run.arm} | ${run.warmup ? 'warm-up' : run.rep} | ${s3(m.wallMs)} | ${f2(m.marketsPerS)} | ${s3(m.userMs)} | ${s3(m.sysMs)} | ${f2(m.cpuUtilization)} | ${mib(m.peakRssBytes)} | ${f2(run.loadBefore[0] ?? NaN)} → ${f2(run.loadAfter[0] ?? NaN)} | ${m.failedMarkets} | \`${run.digest.slice(0, 12)}\` |`,
    )
  }
  lines.push('')
  lines.push('### Determinism (16 §13.7)')
  lines.push('')
  const d = r.determinism
  lines.push(
    d.ok
      ? 'OK: every run of a binary produced one full digest, and every arm the same reduced digest.'
      : '**MISMATCH**: a determinism bug; it blocks the change under test (16 §13.7, DP-6).',
  )
  for (const [sha, digests] of Object.entries(d.fullPerBinary)) {
    lines.push(
      `- Full digest, binary \`${sha.slice(0, 16)}…\`: ${digests.map((x) => `\`${x}\``).join(', ')}`,
    )
  }
  lines.push(`- Full digests across arms: ${d.fullAcrossArms.map((x) => `\`${x}\``).join(', ')}`)
  lines.push(
    `- Reduced digests across arms (\`echo.engineVersion\`, \`echo.engineCommit\` and \`resultDigest\` removed): ${d.reducedAcrossArms.map((x) => `\`${x}\``).join(', ')}`,
  )
  lines.push(
    `- The cross-arm verdict uses the ${d.crossArmForm} form` +
      (d.crossArmForm === 'reduced'
        ? ' (two binaries; build identity differs by construction, D-PENDING 16 §13.7 vs 21 §10).'
        : ' (one binary).'),
  )
  for (const m of d.differingMarkets) lines.push(`- differs: idx ${m.idx} \`${m.slug}\``)
  lines.push('')
  lines.push(
    `CPU utilization = (user + sys) / (wall × ${r.host.logicalCpu} logical cores) (16 §13.4). ` +
      'User/sys/RSS come from `/usr/bin/time -l` per `run` process (10 ms time resolution). ' +
      'Markets/s counts only ok markets.',
  )
  lines.push('')
  return lines.join('\n')
}
