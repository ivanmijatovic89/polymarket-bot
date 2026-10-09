// Child process resource usage from macOS `/usr/bin/time -l -o <file>`
// (16 §11.1 BP-5: `/usr/bin/time -l` and `getrusage` for peak RSS).
// macOS prints `ru_maxrss` in bytes; times have 10 ms resolution, which the
// driver sums over markets (rounding errors average out over a set).

export interface ChildUsage {
  realMs: number
  userMs: number
  sysMs: number
  maxRssBytes: number
  /** `peak memory footprint` (bytes), when the OS reports it. */
  peakFootprintBytes: number | null
  instructions: number | null
  cycles: number | null
}

const TIMES =
  /^\s*([0-9]+(?:\.[0-9]+)?)\s+real\s+([0-9]+(?:\.[0-9]+)?)\s+user\s+([0-9]+(?:\.[0-9]+)?)\s+sys\s*$/m

function counter(text: string, label: string): number | null {
  const m = new RegExp(`^\\s*([0-9]+)\\s+${label}\\s*$`, 'm').exec(text)
  return m?.[1] === undefined ? null : Number(m[1])
}

const ms = (s: string): number => Math.round(Number(s) * 1000)

/** Parses the `-l` report; throws when the times or the max RSS are missing. */
export function parseTimeL(text: string): ChildUsage {
  const t = TIMES.exec(text)
  if (!t || t[1] === undefined || t[2] === undefined || t[3] === undefined) {
    throw new Error(
      `no "real/user/sys" line in /usr/bin/time output: ${JSON.stringify(text.slice(0, 200))}`,
    )
  }
  const maxRssBytes = counter(text, 'maximum resident set size')
  if (maxRssBytes === null) {
    throw new Error('no "maximum resident set size" line in /usr/bin/time -l output')
  }
  return {
    realMs: ms(t[1]),
    userMs: ms(t[2]),
    sysMs: ms(t[3]),
    maxRssBytes,
    peakFootprintBytes: counter(text, 'peak memory footprint'),
    instructions: counter(text, 'instructions retired'),
    cycles: counter(text, 'cycles elapsed'),
  }
}
