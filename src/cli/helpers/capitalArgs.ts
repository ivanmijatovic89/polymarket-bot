import { DEFAULT_STARTING_CAPITAL, validateStartingCapital } from '../../trading/capital.js'

export function parseStartingCapital(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '')
    throw new Error('--starting-capital requires a USDC amount')
  return validateStartingCapital(Number(raw))
}

/** Same engine configuration in live CLI and sequential/distributed backtests. */
export function resolveStartingCapital(argv: string[], env = process.env): number {
  let value: number | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--starting-capital') value = parseStartingCapital(argv[++i])
    else if (arg.startsWith('--starting-capital='))
      value = parseStartingCapital(arg.slice('--starting-capital='.length))
  }
  return (
    value ??
    (env.STARTING_CAPITAL === undefined
      ? DEFAULT_STARTING_CAPITAL
      : parseStartingCapital(env.STARTING_CAPITAL))
  )
}

export function inheritedStartingCapital(cmd: string | null): number {
  // Producers append the resolved value as the final argument, including env/default values.
  const match = /(?:^|\s)--starting-capital(?:=|\s+)([\d.eE+-]+)\s*$/.exec(cmd ?? '')
  if (!match)
    throw new Error(
      'Cannot extend a run without recorded --starting-capital; start a new funded run',
    )
  return parseStartingCapital(match[1])
}
