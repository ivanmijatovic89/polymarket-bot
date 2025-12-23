import type { UpDown15mSymbol } from './upDown15m.js'

export function parseUpDown15mSymbol(raw: string): UpDown15mSymbol | null {
  const s = raw.trim().toLowerCase()
  if (s === 'btc' || s === 'eth' || s === 'sol' || s === 'xrp') return s
  return null
}

export function requireUpDown15mSymbolFromEnv(args: {
  primaryEnv: string
  fallbackEnv?: string
  /** Name to mention in error messages (keeps existing script wording). */
  requiredName: string
  /** Script prefix for error messages, e.g. 'record-live'. */
  script: string
}): UpDown15mSymbol {
  const raw =
    process.env[args.primaryEnv] ?? (args.fallbackEnv ? process.env[args.fallbackEnv] : undefined)
  if (!raw) {
    throw new Error(`[${args.script}] ${args.requiredName} is required (BTC|ETH|SOL|XRP)`)
  }
  const sym = parseUpDown15mSymbol(raw)
  if (!sym) {
    throw new Error(
      `[${args.script}] invalid ${args.requiredName}=${raw} (expected BTC|ETH|SOL|XRP)`,
    )
  }
  return sym
}
