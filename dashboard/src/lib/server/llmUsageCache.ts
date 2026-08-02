import type { AccountUsage } from '@polymarket-bot/llm-usage'

export type CachedAccountUsage = AccountUsage & {
  staleError?: string
}

/**
 * Keeps the last successful value for each account. Provider errors are still
 * surfaced, but they do not replace usable data with an empty error result.
 */
export function createLastGoodUsageMerger() {
  const lastGood = new Map<string, AccountUsage>()

  return (fresh: AccountUsage[]): CachedAccountUsage[] =>
    fresh.map((account) => {
      if (!account.error) {
        lastGood.set(account.account, account)
        return account
      }

      const previous = lastGood.get(account.account)
      return previous ? { ...previous, staleError: account.error } : account
    })
}
