// Arms of an L1 row (16 §13.3, §13.5 "interleaved ABBA across
// configurations"): `--arm bin=<path>,T=<n>[,qos=…][,tape-dir=<dir>][,label=X]`.

import path from 'node:path'

export const QOS_CLAMPS = ['default', 'utility', 'background'] as const
export type Qos = (typeof QOS_CLAMPS)[number]

export interface ArmSpec {
  label: string
  bin: string
  concurrency: number
  qos: Qos
  tapeDir: string | null
}

export class ArmError extends Error {
  override name = 'UsageError'
}

const ARM_KEYS = ['bin', 'T', 'qos', 'tape-dir', 'label']

/** Parses one `--arm` (R14: unknown or duplicate keys are errors). */
export function parseArm(spec: string, index: number): ArmSpec {
  const kv = new Map<string, string>()
  for (const part of spec.split(',')) {
    const i = part.indexOf('=')
    if (i <= 0) throw new ArmError(`--arm ${spec}: expected key=value pairs, got ${part}`)
    const k = part.slice(0, i)
    if (kv.has(k)) throw new ArmError(`--arm ${spec}: duplicate key ${k}`)
    kv.set(k, part.slice(i + 1))
  }
  const unknown = [...kv.keys()].filter((k) => !ARM_KEYS.includes(k))
  if (unknown.length > 0) throw new ArmError(`--arm ${spec}: unknown key(s) ${unknown.join(', ')}`)
  const bin = kv.get('bin')
  if (bin === undefined || bin === '') throw new ArmError(`--arm ${spec}: bin= is required`)
  const qos = (kv.get('qos') ?? 'utility') as Qos
  if (!QOS_CLAMPS.includes(qos)) {
    throw new ArmError(
      `--arm ${spec}: qos must be one of ${QOS_CLAMPS.join(', ')} (taskpolicy -c can only lower QoS)`,
    )
  }
  const label = kv.get('label') ?? String.fromCharCode(65 + index)
  if (!/^[A-Za-z0-9_-]{1,16}$/.test(label)) throw new ArmError(`--arm ${spec}: bad label ${label}`)
  const t = kv.get('T')
  if (t === undefined || !/^[1-9][0-9]*$/.test(t)) {
    throw new ArmError(`--arm ${spec}: T must be a positive integer`)
  }
  const tapeDir = kv.get('tape-dir')
  if (tapeDir === '') throw new ArmError(`--arm ${spec}: empty tape-dir`)
  return {
    label,
    bin: path.resolve(bin),
    concurrency: Number(t),
    qos,
    tapeDir: tapeDir === undefined ? null : path.resolve(tapeDir),
  }
}

/** Checks a set of arms: unique labels and no two identical configurations. */
export function checkArms(arms: readonly ArmSpec[]): void {
  if (arms.length === 0) throw new ArmError('give at least one --arm bin=<path>,T=<n>')
  if (new Set(arms.map((a) => a.label)).size !== arms.length) {
    throw new ArmError('arm labels must differ')
  }
  const key = (a: ArmSpec): string => JSON.stringify([a.bin, a.concurrency, a.qos, a.tapeDir])
  if (new Set(arms.map(key)).size !== arms.length) {
    throw new ArmError('two arms have the same configuration')
  }
}
