/**
 * CLI for LLM subscription usage. Run from the repo root:
 *
 *     npm run llm-usage
 *
 * Providers: claudeUsage.ts, codexUsage.ts (accounts config: src/llm-usage/accounts.json).
 */

import { getUsage } from './usage'

function fmtReset(iso: string): string {
  const resets = new Date(iso)
  const minutes = Math.max(0, Math.floor((resets.getTime() - Date.now()) / 60_000))
  const left =
    minutes < 60
      ? `${minutes}m`
      : minutes < 48 * 60
        ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
        : `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
  const sameDay = resets.toDateString() === new Date().toDateString()
  const day = sameDay ? '' : resets.toLocaleDateString(undefined, { weekday: 'short' }) + ' '
  const time = resets.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  return `resets ${day}${time} (in ${left})`
}

async function main() {
  for (const acc of await getUsage()) {
    console.log(`── ${acc.account} ` + '─'.repeat(Math.max(1, 34 - acc.account.length)))
    if (acc.error) {
      console.log(`  ${acc.error}\n`)
      continue
    }
    if (acc.windows.length === 0) {
      console.log('  no rate-limit data returned\n')
      continue
    }
    for (const w of acc.windows) {
      const used =
        w.percentUsed === null
          ? '   ?     '
          : `${String(Math.round(w.percentUsed)).padStart(3)}% used`
      console.log(`  ${w.label.padEnd(22)}${used}   ${fmtReset(w.resetsAt)}`)
    }
    console.log()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
