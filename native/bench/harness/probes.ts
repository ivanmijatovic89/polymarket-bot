// Host probes shared by the L0 and L1 drivers (16 §13.5): `ps` checks for
// other work, the CPU share of Redis and MySQL, and the effective QoS class a
// child process gets through a given wrapper. Read-only on the host.

import { execFileSync } from 'node:child_process'
import {
  findOtherWork,
  parseLsofCwd,
  parsePs,
  parsePsCpuTime,
  servicePids,
  type OtherWork,
  type PsCheck,
} from './conditions.js'
import type { EffectiveQos } from './report.js'

const run = (cmd: string, args: readonly string[]): string =>
  execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20 })

export function psRows(): ReturnType<typeof parsePs> {
  return parsePs(run('ps', ['-Ao', 'pid=,ppid=,args=']))
}

/** Other work outside the driver's tree, with each process's cwd when readable. */
export function otherWorkNow(selfPid: number): OtherWork[] {
  const work = findOtherWork(psRows(), selfPid)
  if (work.length === 0) return work
  let cwds = new Map<number, string>()
  try {
    cwds = parseLsofCwd(
      run('lsof', ['-a', '-d', 'cwd', '-Fn', '-p', work.map((w) => w.pid).join(',')]),
    )
  } catch {
    // lsof exits non-zero when a process ended meanwhile; cwd stays null.
  }
  return work.map((w) => ({ ...w, cwd: cwds.get(w.pid) ?? null }))
}

export function psCheck(selfPid: number, phase: PsCheck['phase'], tMs: number): PsCheck {
  return { tMs, phase, work: otherWorkNow(selfPid) }
}

export interface ServiceSample {
  name: string
  pid: number
  cpuMs: number
  pcpu: number
}

/** CPU time and current %CPU of redis-server and mysqld (16 §13.5). */
export function sampleServices(): ServiceSample[] {
  const svc = servicePids(psRows())
  if (svc.length === 0) return []
  const out: ServiceSample[] = []
  const text = run('ps', ['-o', 'pid=,time=,pcpu=', '-p', svc.map((s) => s.pid).join(',')])
  for (const line of text.split('\n')) {
    const m = /^\s*([0-9]+)\s+(\S+)\s+([0-9.]+)\s*$/.exec(line)
    if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) continue
    const pid = Number(m[1])
    const s = svc.find((x) => x.pid === pid)
    if (s !== undefined)
      out.push({ name: s.name, pid, cpuMs: parsePsCpuTime(m[2]), pcpu: Number(m[3]) })
  }
  return out
}

const QOS_NAMES: Record<number, string> = {
  0x21: 'user-interactive',
  0x19: 'user-initiated',
  0x15: 'default',
  0x11: 'utility',
  0x09: 'background',
  0x00: 'unspecified',
}

const PY_QOS = "import ctypes;print(ctypes.CDLL('/usr/lib/libSystem.B.dylib').qos_class_self())"

/**
 * The QoS class a child gets through `wrapper` (for example
 * `['/usr/sbin/taskpolicy', '-c', 'utility']`, or `[]`): a probe process
 * spawned exactly like `run` reports `qos_class_self()`. A clamp inherited
 * from the driver (a launchd Background parent, 16 §2.3) shows here too.
 */
export function effectiveQos(wrapper: readonly string[]): EffectiveQos {
  const method = `${[...wrapper, '/usr/bin/python3'].join(' ')}: qos_class_self()`
  try {
    const out = execFileSync(
      wrapper[0] ?? '/usr/bin/python3',
      [
        ...wrapper.slice(1),
        ...(wrapper.length > 0 ? ['/usr/bin/python3'] : []),
        '-I',
        '-c',
        PY_QOS,
      ],
      { encoding: 'utf8', timeout: 20_000 },
    ).trim()
    const raw = Number(out)
    if (!Number.isInteger(raw))
      return { className: null, raw: null, method: `${method}; unreadable output` }
    return { className: QOS_NAMES[raw] ?? `0x${raw.toString(16)}`, raw, method }
  } catch (e) {
    return {
      className: null,
      raw: null,
      method: `${method}; failed: ${(e as Error).message.split('\n')[0]}`,
    }
  }
}
