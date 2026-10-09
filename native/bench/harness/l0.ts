// L0 rows: criterion results of the engine crates' benches (16 §13.2 L0).
//
// The L0 driver (scripts/native/bench-l0.ts) runs each bench target `reps`
// times, interleaved across targets, with `CRITERION_HOME` set to a fresh
// directory per run so no run's raw data overwrites another's. This module
// reads one run's criterion output (`<home>/**/new/{benchmark,estimates,
// sample}.json`), keeps the raw samples, and summarizes per bench the
// median, min and max of the per-run medians (16 §13.5; never the fastest).

import fs from 'node:fs'
import path from 'node:path'
import { summarizePsChecks, type ConditionLabel, type PsCheck } from './conditions.js'
import type { HostFacts } from './hostFacts.js'
import type { LoadSample, Summary } from './stats.js'
import { summarize } from './stats.js'

export interface Estimate {
  point: number
  lower: number
  upper: number
}

export interface CriterionResult {
  /** `full_id`, e.g. `book/apply_level_top_change`. */
  id: string
  group: string
  /** Elements or bytes per iteration, when the bench declares a throughput. */
  throughput: { kind: 'elements' | 'bytes'; n: number } | null
  /** ns per iteration. */
  median: Estimate
  mean: Estimate
  /** Raw criterion samples: iteration counts and total ns per sample. */
  sample: { iters: number[]; times: number[] }
}

export interface BenchTarget {
  package: string
  bench: string
}

export interface L0Run {
  rep: number
  target: BenchTarget
  startedAt: string
  wallMs: number
  loadBefore: number[]
  loadAfter: number[]
  results: CriterionResult[]
}

export interface L0Summary {
  id: string
  target: BenchTarget
  throughput: CriterionResult['throughput']
  /** Per-run criterion median (ns per iteration), in run order. */
  perRunMedianNs: number[]
  /** median, min and max of the per-run medians. */
  ns: Summary
  /** The same per element of the throughput, when declared. */
  nsPerElement: Summary | null
}

export interface L0Row {
  level: 'L0'
  generatedAt: string
  host: HostFacts
  /** `git rev-parse HEAD` of the checkout, with a dirty flag. */
  commit: string
  dirty: boolean
  /** Cargo profile (the workspace `bench` profile; 01 §6 M1 step 7). */
  profile: string
  qos: string
  effectiveQos: string | null
  dataRoot: string
  conditions: {
    label: ConditionLabel
    reasons: string[]
    psChecks: PsCheck[]
    loadSamples: LoadSample[]
    loadDuring: Summary | null
    startedAtLocal: string
    endedAtLocal: string
  }
  reps: number
  targets: BenchTarget[]
  runs: L0Run[]
  summary: L0Summary[]
  notes: string[]
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function estimate(raw: unknown, where: string): Estimate {
  if (!isObject(raw) || !isObject(raw.confidence_interval)) {
    throw new Error(`${where}: missing estimate`)
  }
  const { point_estimate } = raw
  const { lower_bound, upper_bound } = raw.confidence_interval
  if (
    typeof point_estimate !== 'number' ||
    typeof lower_bound !== 'number' ||
    typeof upper_bound !== 'number'
  ) {
    throw new Error(`${where}: estimate is not numeric`)
  }
  return { point: point_estimate, lower: lower_bound, upper: upper_bound }
}

function numbers(raw: unknown, where: string): number[] {
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'number')) {
    throw new Error(`${where}: expected an array of numbers`)
  }
  return raw as number[]
}

/** Parses one bench's `new/` directory (benchmark, estimates, sample). */
export function parseCriterionBench(
  benchmarkJson: string,
  estimatesJson: string,
  sampleJson: string,
  where: string,
): CriterionResult {
  const b = JSON.parse(benchmarkJson) as unknown
  const e = JSON.parse(estimatesJson) as unknown
  const s = JSON.parse(sampleJson) as unknown
  if (!isObject(b) || typeof b.full_id !== 'string' || typeof b.group_id !== 'string') {
    throw new Error(`${where}: benchmark.json has no full_id/group_id`)
  }
  let throughput: CriterionResult['throughput'] = null
  if (isObject(b.throughput)) {
    const [kind, n] = Object.entries(b.throughput)[0] ?? []
    if (typeof n !== 'number') throw new Error(`${where}: bad throughput`)
    if (kind === 'Elements') throughput = { kind: 'elements', n }
    else if (kind === 'Bytes') throughput = { kind: 'bytes', n }
    else throw new Error(`${where}: unknown throughput kind ${String(kind)}`)
  }
  if (!isObject(e) || !isObject(s)) throw new Error(`${where}: estimates/sample not objects`)
  const iters = numbers(s.iters, `${where} sample.iters`)
  const times = numbers(s.times, `${where} sample.times`)
  if (iters.length !== times.length || iters.length === 0) {
    throw new Error(`${where}: sample iters/times lengths differ or are empty`)
  }
  return {
    id: b.full_id,
    group: b.group_id,
    throughput,
    median: estimate(e.median, `${where} median`),
    mean: estimate(e.mean, `${where} mean`),
    sample: { iters, times },
  }
}

/** Every bench result under a `CRITERION_HOME` directory, sorted by id. */
export function readCriterionHome(home: string): CriterionResult[] {
  const out: CriterionResult[] = []
  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue
      const p = path.join(dir, ent.name)
      if (ent.name === 'new') {
        const f = (n: string): string => fs.readFileSync(path.join(p, n), 'utf8')
        if (fs.existsSync(path.join(p, 'benchmark.json'))) {
          out.push(
            parseCriterionBench(f('benchmark.json'), f('estimates.json'), f('sample.json'), p),
          )
        }
      } else if (ent.name !== 'report' && ent.name !== 'base' && ent.name !== 'change') {
        walk(p)
      }
    }
  }
  walk(home)
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Per-bench summary over runs: median, min and max of per-run medians. */
export function summarizeL0(runs: readonly L0Run[]): L0Summary[] {
  const byId = new Map<string, { target: BenchTarget; results: CriterionResult[] }>()
  for (const run of runs) {
    for (const r of run.results) {
      const e = byId.get(r.id) ?? { target: run.target, results: [] }
      e.results.push(r)
      byId.set(r.id, e)
    }
  }
  return [...byId.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([id, { target, results }]) => {
      const tp = results[0]!.throughput
      for (const r of results) {
        if (JSON.stringify(r.throughput) !== JSON.stringify(tp)) {
          throw new Error(`${id}: throughput differs between runs`)
        }
      }
      const perRunMedianNs = results.map((r) => r.median.point)
      return {
        id,
        target,
        throughput: tp,
        perRunMedianNs,
        ns: summarize(perRunMedianNs),
        nsPerElement:
          tp === null || tp.n === 0 ? null : summarize(perRunMedianNs.map((v) => v / tp.n)),
      }
    })
}

/** ns → a readable time (ns, µs, ms, s). */
export function formatNs(ns: number): string {
  if (ns < 1e3) return `${ns.toFixed(2)} ns`
  if (ns < 1e6) return `${(ns / 1e3).toFixed(2)} µs`
  if (ns < 1e9) return `${(ns / 1e6).toFixed(2)} ms`
  return `${(ns / 1e9).toFixed(3)} s`
}

const f2 = (n: number): string => n.toFixed(2)

/** Markdown section of one L0 row. */
export function renderL0Row(r: L0Row, rowNumber: number): string {
  const c = r.conditions
  const lines: string[] = []
  lines.push(
    `## Row ${rowNumber}: L0 criterion benches (${c.startedAtLocal} – ${c.endedAtLocal.slice(11)})`,
  )
  lines.push('')
  if (c.label === 'non-idle') {
    lines.push('**`non-idle`**: L0 numbers are read only as before/after A/B within this sitting')
    lines.push('(01 §6 M1 step 7), never as regression or gate evidence (16 §13.5). Reasons:')
    for (const reason of c.reasons) lines.push(`- ${reason}`)
  } else {
    lines.push('**`idle`**: every quiet-host condition of 16 §13.5 held over the whole row.')
  }
  lines.push('')
  lines.push(
    `- Commit \`${r.commit}\`${r.dirty ? ' (dirty)' : ''}; cargo profile \`${r.profile}\`; ${r.host.rustc}`,
  )
  lines.push(
    `- QoS ${r.qos} (effective: ${r.effectiveQos ?? 'unknown'}); data root \`${r.dataRoot}\``,
  )
  lines.push(
    `- ${r.reps} runs per target, interleaved: ${r.targets.map((t) => `\`${t.package}/${t.bench}\``).join(', ')}`,
  )
  lines.push(
    `- Load average (1 min) during the row: ${c.loadDuring === null ? 'not sampled' : `${f2(c.loadDuring.median)} (${f2(c.loadDuring.min)}–${f2(c.loadDuring.max)})`}`,
  )
  lines.push(...summarizePsChecks(c.psChecks))
  for (const n of r.notes) lines.push(`- ${n}`)
  lines.push('')
  lines.push(
    "Each value is the median, min and max over runs of criterion's per-run median point estimate; raw samples are in the JSON.",
  )
  lines.push('')
  lines.push('| Bench | Per iteration | Per element | Per-run medians |')
  lines.push('|---|---|---|---|')
  for (const s of r.summary) {
    const per = (x: Summary): string =>
      `${formatNs(x.median)} (${formatNs(x.min)}–${formatNs(x.max)})`
    lines.push(
      `| \`${s.id}\` | ${per(s.ns)} | ${s.nsPerElement === null ? '—' : `${per(s.nsPerElement)} / ${s.throughput!.kind === 'elements' ? 'element' : 'byte'} (${s.throughput!.n})`} | ${s.perRunMedianNs.map(formatNs).join(', ')} |`,
    )
  }
  lines.push('')
  return lines.join('\n')
}
