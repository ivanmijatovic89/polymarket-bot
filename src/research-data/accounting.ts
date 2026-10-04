import { abs, decimal, SCALE, sum, units } from './decimal.js'
import type { Activity, FeedRow, Market, Position, WalletMarket } from './types.js'

/** A multiset comparison, not a unique event ID: identical fills can be genuine. */
export function tradeKey(row: FeedRow): string {
  return JSON.stringify([
    row.proxy_wallet.toLowerCase(),
    row.condition_id.toLowerCase(),
    row.token_id,
    row.transaction_hash.toLowerCase(),
    row.timestamp,
    row.side,
    decimal(units(row.size)),
    // The two feeds may format a ratio differently; cash is verified separately.
    Number(row.price).toFixed(6),
  ])
}

export function multisetDifference(left: FeedRow[], right: FeedRow[]): number {
  const counts = new Map<string, number>()
  for (const row of left) counts.set(tradeKey(row), (counts.get(tradeKey(row)) ?? 0) + 1)
  for (const row of right) counts.set(tradeKey(row), (counts.get(tradeKey(row)) ?? 0) - 1)
  return [...counts.values()].reduce((a, n) => a + Math.abs(n), 0)
}

/**
 * Conservative error bound for purchase-only WAC accounting rounded after each
 * fill. Native averages are order sensitive; cash sums are not. This bound is
 * used only for a closed, purchase-only lifecycle with reconciled cash/inventory.
 * It is not a tolerance for missing cash flows or balances.
 */
export function purchaseWacRoundingBound(activities: Activity[]): bigint | null {
  const byToken = new Map<string, { count: bigint; size: bigint }>()
  for (const a of activities) {
    if (a.type === 'REDEEM') continue
    if (a.type !== 'TRADE' || a.side !== 'BUY') return null
    const state = byToken.get(a.token_id) ?? { count: 0n, size: 0n }
    state.count++
    state.size += units(a.size)
    byToken.set(a.token_id, state)
  }
  return sum([...byToken.values()].map((s) => (s.count * s.size + SCALE - 1n) / SCALE + 100n))
}

/** Empirical native WAC model, used only to explain API differences. Cash PnL
 * remains the authoritative local result. Unsupported or negative inventories
 * deliberately have no model result. Same-second source order is not invented. */
export function modeledWacPnl(market: Market, activities: Activity[]): bigint | null {
  if (!market.resolved) return null
  const states = new Map(
    market.token_ids.map((token, i) => [
      token,
      {
        size: 0n,
        average: 0n,
        realized: 0n,
        payout: BigInt(market.payouts[i]!),
      },
    ]),
  )
  for (const activity of activities) {
    if (activity.type !== 'TRADE' && activity.type !== 'REDEEM') return null
    const cash = units(activity.usdc_size)
    let size = units(activity.size)
    let token = activity.token_id
    if (activity.type === 'REDEEM' && !states.has(token)) {
      const winners = [...states].filter(([, value]) => value.payout === SCALE)
      if (winners.length !== 1) return null
      token = winners[0]![0]
      size = cash
    }
    const state = states.get(token)
    if (!state || size < 0n || cash < 0n) return null
    if (activity.type === 'TRADE' && activity.side === 'BUY') {
      if (state.size + size === 0n) return null
      state.average = (state.average * state.size + cash * SCALE) / (state.size + size)
      state.size += size
    } else if (activity.type === 'REDEEM' || activity.side === 'SELL') {
      state.realized += cash - (state.average * size) / SCALE
      state.size -= size
      if (state.size < 0n) return null
    } else return null
  }
  return sum(
    [...states.values()].map(
      (state) => state.realized + (state.size * (state.payout - state.average)) / SCALE,
    ),
  )
}

export function accountWalletMarket(args: {
  market: Market
  wallet: string
  trades: FeedRow[]
  activities: Activity[]
  positions: Position[]
  fetched: boolean
}): WalletMarket {
  const { market, trades, activities, positions } = args
  const issues = new Set<string>()
  const notes = new Set<string>()
  if (!args.fetched) issues.add('wallet_fetch_incomplete')
  if (
    multisetDifference(
      trades,
      activities.filter((a) => a.type === 'TRADE'),
    )
  ) {
    issues.add('trade_activity_multiset_mismatch')
  }
  const amounts = { buy: 0n, sell: 0n, split: 0n, merge: 0n, redeem: 0n, reward: 0n }
  const balances = new Map(market.token_ids.map((token) => [token, 0n]))
  let legacyRedeem = false
  const payoutByToken = new Map(
    market.token_ids.map((token, i) => [token, BigInt(market.payouts[i] ?? 0)]),
  )
  for (const a of activities) {
    if (a.condition_id !== market.condition_id || a.proxy_wallet.toLowerCase() !== args.wallet) {
      throw new Error('Accounting received rows from another wallet or market')
    }
    const cash = units(a.usdc_size)
    const size = units(a.size)
    if (cash < 0n || size < 0n) issues.add('negative_unsigned_activity_amount')
    switch (a.type) {
      case 'TRADE': {
        if (!balances.has(a.token_id)) issues.add('unknown_trade_token')
        if (a.side === 'BUY') {
          amounts.buy += cash
          balances.set(a.token_id, (balances.get(a.token_id) ?? 0n) + size)
        } else if (a.side === 'SELL') {
          amounts.sell += cash
          balances.set(a.token_id, (balances.get(a.token_id) ?? 0n) - size)
        } else issues.add('unknown_trade_side')
        break
      }
      case 'SPLIT':
      case 'MERGE': {
        const direction = a.type === 'SPLIT' ? 1n : -1n
        amounts[a.type === 'SPLIT' ? 'split' : 'merge'] += cash
        if (abs(cash - size) > 1n) issues.add('collateral_amount_mismatch')
        for (const token of market.token_ids)
          balances.set(token, (balances.get(token) ?? 0n) + direction * size)
        break
      }
      case 'REDEEM': {
        amounts.redeem += cash
        if (balances.has(a.token_id)) {
          balances.set(a.token_id, (balances.get(a.token_id) ?? 0n) - size)
          const expectedCash = (size * (payoutByToken.get(a.token_id) ?? 0n)) / SCALE
          if (market.resolved && abs(expectedCash - cash) > 1n)
            issues.add('redemption_cash_mismatch')
        } else {
          legacyRedeem = true
          // Old combined redemption rows omit token identity. Only a unique
          // $1 winner lets cash determine its burned share count unambiguously.
          const winners = market.token_ids.filter((token) => payoutByToken.get(token) === SCALE)
          if (market.resolved && winners.length === 1) {
            const winner = winners[0]!
            balances.set(winner, (balances.get(winner) ?? 0n) - cash)
          } else issues.add('ambiguous_combined_redemption')
        }
        break
      }
      case 'REWARD':
      case 'MAKER_REBATE':
      case 'TAKER_REBATE':
        amounts.reward += cash
        break
      default:
        issues.add(`unsupported_activity:${a.type}`)
    }
  }
  const positionByToken = new Map<string, Position>()
  for (const p of positions) {
    if (p.condition_id !== market.condition_id || p.proxy_wallet.toLowerCase() !== args.wallet) {
      throw new Error('Accounting received another wallet position')
    }
    if (!balances.has(p.token_id)) issues.add('unknown_position_token')
    const previous = positionByToken.get(p.token_id)
    if (previous) {
      if (
        units(previous.current_size) === units(p.current_size) &&
        units(previous.total_pnl) === units(p.total_pnl)
      ) {
        // OPEN and CLOSED can both serve a resolved residual holding. Their
        // realized/unrealized split may differ, while total economics agrees.
        notes.add('overlapping_position_views')
        if (p.status !== 'CLOSED') positionByToken.set(p.token_id, p)
      } else issues.add('conflicting_position_snapshots')
    } else positionByToken.set(p.token_id, p)
  }
  let remainingValue = 0n
  for (const token of market.token_ids) {
    const balance = balances.get(token) ?? 0n
    const payout = payoutByToken.get(token) ?? 0n
    const position = positionByToken.get(token)
    if (balance < -1n) issues.add('unexplained_token_outflow')
    if (!position && activities.some((a) => a.token_id === token || a.type === 'SPLIT')) {
      issues.add('missing_position_snapshot')
    }
    if (position) {
      const servedBalance = units(position.current_size)
      // Served positions truncate to 4 decimals in the observed V2 contract.
      // A legacy combined redemption may also burn losing tokens without
      // publishing their individual amount; they have zero settlement value.
      const legacyLosingBurn =
        legacyRedeem && market.resolved && payout === 0n && servedBalance <= balance
      const closedLosingPosition =
        market.resolved &&
        payout === 0n &&
        position.status === 'CLOSED' &&
        servedBalance === 0n &&
        balance >= 0n
      if (abs(servedBalance - balance) > 100n) {
        if (legacyLosingBurn || closedLosingPosition) notes.add('zero_payout_balance_not_exposed')
        else issues.add('position_balance_mismatch')
      }
    }
    remainingValue += ((balance > 0n ? balance : 0n) * payout) / SCALE
  }
  const cash = amounts.sell + amounts.merge + amounts.redeem - amounts.buy - amounts.split
  const economic = market.resolved ? cash + remainingValue : null
  const uniquePositions = [...positionByToken.values()]
  const sourcePnl = uniquePositions.length
    ? sum(uniquePositions.map((p) => units(p.total_pnl)))
    : null
  const delta = economic !== null && sourcePnl !== null ? economic - sourcePnl : null
  let pnlStatus =
    delta === null
      ? 'unavailable'
      : abs(delta) <= 1n
        ? 'match'
        : abs(delta) <= BigInt(Math.max(1, uniquePositions.length)) * 200n
          ? 'rounding_compatible'
          : 'different'
  if (pnlStatus === 'different' && remainingValue === 0n) {
    const bound = purchaseWacRoundingBound(activities)
    if (bound !== null && abs(delta!) <= bound) pnlStatus = 'rounding_compatible'
  }
  const modeledPnl = pnlStatus === 'different' ? modeledWacPnl(market, activities) : null
  if (
    modeledPnl !== null &&
    sourcePnl !== null &&
    abs(modeledPnl - sourcePnl) <= BigInt(uniquePositions.length) * 200n
  ) {
    pnlStatus = 'rounding_compatible'
    notes.add('native_wac_reproduced')
  }
  if (pnlStatus === 'different') issues.add('api_pnl_unreconciled')
  if (sourcePnl === null) issues.add('missing_position_economics')
  return {
    wallet: args.wallet,
    condition_id: market.condition_id,
    slug: market.slug,
    market_start: market.market_start,
    trade_count: trades.length,
    activity_count: activities.length,
    buy_usdc: decimal(amounts.buy),
    sell_usdc: decimal(amounts.sell),
    split_usdc: decimal(amounts.split),
    merge_usdc: decimal(amounts.merge),
    redeem_usdc: decimal(amounts.redeem),
    cash_pnl_usdc: decimal(cash),
    unredeemed_value_usdc: market.resolved ? decimal(remainingValue) : null,
    economic_pnl_usdc: economic === null ? null : decimal(economic),
    rewards_usdc: decimal(amounts.reward),
    pnl_with_rewards_usdc: economic === null ? null : decimal(economic + amounts.reward),
    api_position_pnl_usdc: sourcePnl === null ? null : decimal(sourcePnl),
    api_pnl_difference_usdc: delta === null ? null : decimal(delta),
    modeled_api_pnl_usdc: modeledPnl === null ? null : decimal(modeledPnl),
    api_pnl_status: pnlStatus,
    quality: issues.size ? 'unresolved' : market.resolved ? 'complete' : 'pending_resolution',
    issues: [...issues].sort(),
    notes: [...notes].sort(),
  }
}
