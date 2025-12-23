export function installProcessCrashHandlers(args: {
  prefix: string
  exitOnUncaught?: boolean
}): void {
  process.on('unhandledRejection', (reason) => {
    console.error(`[${args.prefix}] unhandledRejection`, reason)
  })

  process.on('uncaughtException', (err) => {
    console.error(`[${args.prefix}] uncaughtException`, err)
    if (args.exitOnUncaught ?? true) process.exit(1)
  })
}

export function installSignalHandlers(args: {
  onSignal: (signal: 'SIGINT' | 'SIGTERM') => void
}): void {
  process.on('SIGINT', () => args.onSignal('SIGINT'))
  process.on('SIGTERM', () => args.onSignal('SIGTERM'))
}
