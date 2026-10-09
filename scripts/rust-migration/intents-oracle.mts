/** Independent pinned TypeScript intent/risk/cancellation oracle. */
import { readFileSync } from 'node:fs'
import { Portfolio } from '../../src/trading/Portfolio.js'
import { enforceRiskLimits } from '../../src/trading/riskLimits.js'
import {
  validateCancelScope,
  matchesCancelScope,
  resolveCancelBatch,
} from '../../src/trading/cancellation.js'
import type {
  AccountEvent,
  CancelBatchIntent,
  CancelMarketIntent,
  Intent,
  PortfolioSnapshot,
} from '../../src/strategy/Strategy.js'

type Input = {
  operation: 'risk' | 'scope' | 'cancel_batch'
  events?: AccountEvent[]
  intents?: Intent[]
  scope?: CancelMarketIntent
  orders?: { market?: string; assetId?: string }[]
  intent?: CancelBatchIntent
  nowMs?: number
  withoutPortfolio?: boolean
  realizedPnlTotal?: number
  limits?: Parameters<typeof enforceRiskLimits>[0]['limits']
  dryRun?: boolean
}
function probes(value: unknown) {
  const numericBits: Record<string, string> = {}
  const objectKeys: Record<string, string[]> = {}
  const visit = (node: unknown, path: string) => {
    if (typeof node === 'number') {
      const b = Buffer.alloc(8)
      b.writeDoubleBE(node)
      numericBits[path] = b.toString('hex')
      return
    }
    if (Array.isArray(node)) {
      node.forEach((child, index) => visit(child, `${path}/${index}`))
      return
    }
    if (node === null || typeof node !== 'object') return
    if (path.includes('/meta') || path.includes('/opaque')) objectKeys[path] = Object.keys(node)
    for (const [key, child] of Object.entries(node))
      visit(child, `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`)
  }
  visit(value, '')
  return { numericBits, objectKeys }
}
const document = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as {
  cases: { name: string; input: Input }[]
}
const results = document.cases.map(({ name, input }) => {
  const realNow = Date.now
  Date.now = () => 0
  let p: Portfolio
  try {
    p = new Portfolio()
  } finally {
    Date.now = realNow
  }
  for (const event of input.events ?? []) p.apply(event)
  const snapshot = {
    ...p.snapshot(),
    ...(input.realizedPnlTotal !== undefined ? { realizedPnlTotal: input.realizedPnlTotal } : {}),
  } as PortfolioSnapshot
  const portfolio = input.withoutPortfolio ? undefined : snapshot
  let result: unknown
  if (input.operation === 'risk') {
    const intents = input.intents!
    result = {
      decision: enforceRiskLimits({
        nowMs: input.nowMs ?? 1000,
        intents,
        ...(portfolio ? { portfolio } : {}),
        ...(input.limits ? { limits: input.limits } : {}),
      }),
      encodedIntents: intents,
      ...probes(intents),
    }
  } else if (input.operation === 'scope') {
    const scope = input.scope!
    const error = validateCancelScope(scope)
    result = {
      error,
      matches: input.orders!.map((order) => (error ? false : matchesCancelScope(order, scope))),
    }
  } else
    result = resolveCancelBatch(
      input.intent!,
      portfolio,
      input.nowMs ?? 1000,
      input.dryRun ?? false,
    )
  return { name, result }
})
process.stdout.write(JSON.stringify(results))
