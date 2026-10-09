/**
 * CLI of `npm run strategy:sync-lock -- --repo <package dir>` (31 §3 item 3).
 */
import { argValue, UsageError } from './cli.js'
import { syncLock } from './syncLock.js'

function main(argv: string[]): number {
  try {
    const repo = argValue(argv, '--repo')
    const known = argv.every(
      (a, i) => a === '--repo' || a.startsWith('--repo=') || argv[i - 1] === '--repo',
    )
    if (!repo || !known)
      throw new UsageError('usage: npm run strategy:sync-lock -- --repo <package dir>')
    const { packages, changed } = syncLock(repo)
    console.log(
      `[strategy:sync-lock] ${changed ? 'updated' : 'unchanged'}: ${repo}/Cargo.lock (${packages} packages, a subset of native/Cargo.lock)`,
    )
    return 0
  } catch (err) {
    console.error(`[strategy:sync-lock] ${err instanceof Error ? err.message : String(err)}`)
    return err instanceof UsageError ? 2 : 1
  }
}

process.exit(main(process.argv.slice(2)))
