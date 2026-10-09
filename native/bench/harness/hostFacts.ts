// Host facts recorded with every benchmark (16 §2.3, §13.5): chip, core
// layout per performance level, caches, memory, macOS, toolchain, power.
// `collectHostFacts` takes the command runner as a parameter so the parsing
// and rendering stay testable without the host.

export interface PerfLevel {
  /** `hw.perflevelN` index (0 = fastest). */
  level: number
  name: string
  physicalCpu: number
  logicalCpu: number
  l1iBytes: number
  l1dBytes: number
  l2Bytes: number
  cpusPerL2: number
}

export interface HostFacts {
  /** Fleet name (worker-1, …), from `--host` or the hostname. */
  host: string
  hostname: string
  chip: string
  model: string
  perfLevels: PerfLevel[]
  logicalCpu: number
  physicalCpu: number
  memBytes: number
  cacheLineBytes: number
  pageBytes: number
  macos: { productVersion: string; build: string }
  /** `rustc --version`, run in `native/` so rust-toolchain.toml applies. */
  rustc: string
  cargo: string
  node: string
  powerSource: string | null
  lowPowerMode: boolean | null
}

export type CommandRunner = (cmd: string, args: readonly string[]) => string

/** Parses `sysctl` output lines `key: value`. */
export function parseSysctl(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of text.split('\n')) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    out.set(line.slice(0, i).trim(), line.slice(i + 1).trim())
  }
  return out
}

function need(m: Map<string, string>, key: string): string {
  const v = m.get(key)
  if (v === undefined || v === '') throw new Error(`sysctl ${key} missing`)
  return v
}

function needInt(m: Map<string, string>, key: string): number {
  const v = Number(need(m, key))
  if (!Number.isSafeInteger(v)) throw new Error(`sysctl ${key} is not an integer`)
  return v
}

/** Fleet label of a hostname (`Worker-1s-Mac-mini.local` → `worker-1`). */
export function hostLabel(hostname: string): string {
  const m = /(worker-[0-9]+|m1-ivan|m1-milan|milan-m1|m5-milan)/i.exec(hostname)
  return m?.[1] !== undefined
    ? m[1].toLowerCase()
    : (hostname.split('.')[0] ?? hostname).toLowerCase()
}

/** `pmset -g ps` first line → power source name (`AC Power`, `Battery Power`). */
export function parsePowerSource(text: string): string | null {
  return /drawing from '([^']+)'/.exec(text)?.[1] ?? null
}

/** `pmset -g` → Low Power Mode flag. */
export function parseLowPowerMode(text: string): boolean | null {
  const m = /^\s*lowpowermode\s+([01])\s*$/m.exec(text)
  return m?.[1] === undefined ? null : m[1] === '1'
}

const SYSCTL_KEYS = [
  'machdep.cpu.brand_string',
  'hw.model',
  'hw.nperflevels',
  'hw.logicalcpu',
  'hw.physicalcpu',
  'hw.memsize',
  'hw.cachelinesize',
  'hw.pagesize',
  'kern.osproductversion',
  'kern.osversion',
]

const PERF_FIELDS = [
  'name',
  'physicalcpu',
  'logicalcpu',
  'l1icachesize',
  'l1dcachesize',
  'l2cachesize',
  'cpusperl2',
]

export function collectHostFacts(
  run: CommandRunner,
  opts: { host?: string; hostname: string; node: string },
): HostFacts {
  const base = parseSysctl(run('sysctl', SYSCTL_KEYS))
  const levels = needInt(base, 'hw.nperflevels')
  const perfKeys: string[] = []
  for (let l = 0; l < levels; l++)
    for (const f of PERF_FIELDS) perfKeys.push(`hw.perflevel${l}.${f}`)
  const perf = parseSysctl(run('sysctl', perfKeys))
  const perfLevels: PerfLevel[] = []
  for (let l = 0; l < levels; l++) {
    const k = (f: string): string => `hw.perflevel${l}.${f}`
    perfLevels.push({
      level: l,
      name: need(perf, k('name')),
      physicalCpu: needInt(perf, k('physicalcpu')),
      logicalCpu: needInt(perf, k('logicalcpu')),
      l1iBytes: needInt(perf, k('l1icachesize')),
      l1dBytes: needInt(perf, k('l1dcachesize')),
      l2Bytes: needInt(perf, k('l2cachesize')),
      cpusPerL2: needInt(perf, k('cpusperl2')),
    })
  }
  const rustc = run('rustc', ['--version']).trim()
  if (!rustc.startsWith('rustc ')) throw new Error(`unexpected rustc --version output: ${rustc}`)
  let powerSource: string | null = null
  let lowPowerMode: boolean | null = null
  try {
    powerSource = parsePowerSource(run('pmset', ['-g', 'ps']))
    lowPowerMode = parseLowPowerMode(run('pmset', ['-g']))
  } catch {
    // Recorded as unknown; an unknown power state makes the run non-idle.
  }
  return {
    host: opts.host ?? hostLabel(opts.hostname),
    hostname: opts.hostname,
    chip: need(base, 'machdep.cpu.brand_string'),
    model: need(base, 'hw.model'),
    perfLevels,
    logicalCpu: needInt(base, 'hw.logicalcpu'),
    physicalCpu: needInt(base, 'hw.physicalcpu'),
    memBytes: needInt(base, 'hw.memsize'),
    cacheLineBytes: needInt(base, 'hw.cachelinesize'),
    pageBytes: needInt(base, 'hw.pagesize'),
    macos: {
      productVersion: need(base, 'kern.osproductversion'),
      build: need(base, 'kern.osversion'),
    },
    rustc,
    cargo: run('cargo', ['--version']).trim(),
    node: opts.node,
    powerSource,
    lowPowerMode,
  }
}

const KIB = 1024
const MIB = 1024 * 1024
const GIB = 1024 * 1024 * 1024

export function formatBytes(n: number): string {
  if (n >= GIB && n % GIB === 0) return `${n / GIB} GiB`
  if (n >= MIB && n % MIB === 0) return `${n / MIB} MiB`
  if (n >= KIB && n % KIB === 0) return `${n / KIB} KiB`
  if (n >= MIB) return `${(n / MIB).toFixed(1)} MiB`
  return `${n} B`
}

/** One-line chip and core summary, e.g. `Apple M4, 4P + 6E (10 logical)`. */
export function coreSummary(f: HostFacts): string {
  const parts = f.perfLevels.map((p) => `${p.physicalCpu}${p.name.charAt(0).toUpperCase()}`)
  return `${f.chip}, ${parts.join(' + ')} (${f.logicalCpu} logical)`
}

/** The host-facts page `native/bench/results/m1-host-facts-<date>-<host>.md`. */
export function renderHostFactsMarkdown(
  f: HostFacts,
  date: string,
  extra: readonly string[] = [],
): string {
  const rows = f.perfLevels.map(
    (p) =>
      `| ${p.level} | ${p.name} | ${p.physicalCpu} | ${p.logicalCpu} | ${formatBytes(p.l1iBytes)} | ${formatBytes(p.l1dBytes)} | ${formatBytes(p.l2Bytes)} | ${p.cpusPerL2} | ${p.cpusPerL2 > 0 ? p.physicalCpu / p.cpusPerL2 : 0} |`,
  )
  return [
    `# Host facts: ${f.host} (${date})`,
    '',
    `Recorded by \`scripts/native/bench-l1-host-facts.ts\` for 16 §2.3 (M1 step 7).`,
    'Every benchmark report of this host repeats the core line below (16 §13.5).',
    '',
    `- Host: ${f.host} (\`${f.hostname}\`), model \`${f.model}\``,
    `- Chip: ${coreSummary(f)}`,
    `- Memory: ${formatBytes(f.memBytes)} (\`hw.memsize\` ${f.memBytes})`,
    `- Cache line: ${f.cacheLineBytes} B; page size: ${formatBytes(f.pageBytes)}`,
    `- macOS ${f.macos.productVersion} (build ${f.macos.build})`,
    `- Toolchain: ${f.rustc}; ${f.cargo}; Node ${f.node}`,
    `- Power: ${f.powerSource ?? 'unknown'}; Low Power Mode ${f.lowPowerMode === null ? 'unknown' : f.lowPowerMode ? 'on' : 'off'}`,
    '',
    '## Core layout per performance level (`sysctl hw.perflevelN.*`)',
    '',
    '| Level | Name | Physical | Logical | L1i per core | L1d per core | L2 per cluster | CPUs per L2 | Clusters |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    ...extra,
  ].join('\n')
}
