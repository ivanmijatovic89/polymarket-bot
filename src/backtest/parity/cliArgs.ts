/**
 * Minimal argv parsing shared by the parity CLIs (`--flag value`, `--flag=value`,
 * repeatable flags, boolean switches, positionals). Unknown flags are errors.
 */
export type ParsedArgv = {
  values: Map<string, string[]>
  switches: Set<string>
  positionals: string[]
}

export function parseArgv(
  argv: string[],
  spec: { values: readonly string[]; switches: readonly string[] },
): ParsedArgv {
  const values = new Map<string, string[]>()
  const switches = new Set<string>()
  const positionals: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (!a.startsWith('--')) {
      positionals.push(a)
      continue
    }
    const eq = a.indexOf('=')
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2)
    if (spec.switches.includes(name)) {
      if (eq > 0) throw new Error(`--${name} takes no value`)
      switches.add(name)
      continue
    }
    if (!spec.values.includes(name)) throw new Error(`unknown flag --${name}`)
    const value = eq > 0 ? a.slice(eq + 1) : argv[++i]
    if (value === undefined) throw new Error(`missing value for --${name}`)
    values.set(name, [...(values.get(name) ?? []), value])
  }
  return { values, switches, positionals }
}

export function one(p: ParsedArgv, name: string): string | undefined {
  const v = p.values.get(name)
  if (v && v.length > 1) throw new Error(`--${name} given more than once`)
  return v?.[0]
}

export function intArg(p: ParsedArgv, name: string, fallback: number): number {
  const raw = one(p, name)
  if (raw === undefined) return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a non-negative integer`)
  return n
}

/** `--param k=v` pairs (repeatable; later wins). Values stay strings — schemas coerce. */
export function paramArgs(p: ParsedArgv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const kv of p.values.get('param') ?? []) {
    const i = kv.indexOf('=')
    if (i <= 0) throw new Error(`invalid --param ${JSON.stringify(kv)} (expected key=value)`)
    out[kv.slice(0, i).trim()] = kv.slice(i + 1)
  }
  return out
}

export function dateMsArg(p: ParsedArgv, name: string): number | undefined {
  const raw = one(p, name)
  if (raw === undefined) return undefined
  const ms = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw)
  if (!Number.isFinite(ms)) throw new Error(`--${name}: invalid date ${JSON.stringify(raw)}`)
  return ms
}
