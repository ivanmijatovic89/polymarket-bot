function quoteInlineArg(raw: string): string {
  const s = String(raw).replace(/\r?\n/g, ' ')
  if (s.length === 0) return '""'
  // Keep common CLI tokens unquoted for readability.
  if (/^[A-Za-z0-9_./:=,@+-]+$/.test(s)) return s
  const escaped = s.replace(/([\\\"$`])/g, '\\$1')
  return `"${escaped}"`
}

function buildBacktestCmdInlineFromArgv(argv: string[]): string {
  const lifecycle = process.env.npm_lifecycle_event
  if (lifecycle) {
    const out: string[] = ['npm', 'run', lifecycle]
    if (argv.length > 0) out.push('--', ...argv)
    return out.map(quoteInlineArg).join(' ')
  }

  return ['node', ...process.argv.slice(1, 2), ...argv].map(quoteInlineArg).join(' ')
}

export function buildBacktestCmdInline(argv: string[], options?: { preferArgv?: boolean }): string {
  if (options?.preferArgv) return buildBacktestCmdInlineFromArgv(argv)

  const npmArgvRaw = process.env.npm_config_argv
  if (npmArgvRaw) {
    try {
      const parsed = JSON.parse(npmArgvRaw) as { original?: unknown; cooked?: unknown }
      const original = Array.isArray(parsed.original) ? (parsed.original as unknown[]) : null
      const cooked = Array.isArray(parsed.cooked) ? (parsed.cooked as unknown[]) : null
      const tokensAny = original ?? cooked
      const tokens = tokensAny
        ? tokensAny.filter((t): t is string => typeof t === 'string' && t.length > 0)
        : null

      if (tokens && tokens.length > 0) {
        // Typical `npm run backtest -- ...` => original/cooked begins with ["run","backtest",...]
        if (tokens[0] === 'run' && typeof tokens[1] === 'string' && tokens[1].length > 0) {
          const script = tokens[1]
          const rest = tokens.slice(2)
          const out: string[] = ['npm', 'run', script]
          if (rest.length > 0) {
            if (rest[0] !== '--') out.push('--')
            out.push(...rest)
          }
          return out.map(quoteInlineArg).join(' ')
        }
        // Fallback: still produce something meaningful.
        return ['npm', ...tokens].map(quoteInlineArg).join(' ')
      }
    } catch {
      // ignore
    }
  }

  return buildBacktestCmdInlineFromArgv(argv)
}
