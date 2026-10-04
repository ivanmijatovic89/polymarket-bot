import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { accountWalletMarket, multisetDifference } from './accounting.js'
import { decimal, units } from './decimal.js'
import type { Activity, FeedRow, Market, Position } from './types.js'

const market: Market = {
  slug: 'btc-updown-15m-1780272000',
  condition_id: 'condition',
  event_id: 'event',
  symbol: 'btc',
  timeframe: '15m',
  market_start: 1780272000,
  market_end: 1780272900,
  token_ids: ['up', 'down'],
  outcomes: ['Up', 'Down'],
  payouts: ['1000000', '0'],
  resolved: true,
  raw_json: '{}',
  resolution_json: '{}',
}
function activity(type: string, token: string, size: string, cash: string, side = ''): Activity {
  return {
    proxy_wallet: 'wallet',
    condition_id: market.condition_id,
    token_id: token,
    transaction_hash: 'tx',
    timestamp: market.market_start,
    side,
    size,
    price: '0.4',
    type,
    usdc_size: cash,
  }
}
function position(token: string, size: string, pnl: string): Position {
  return {
    proxy_wallet: 'wallet',
    condition_id: market.condition_id,
    token_id: token,
    current_size: size,
    realized_pnl: pnl,
    unrealized_pnl: '0',
    total_pnl: pnl,
    entry_fees_usdc: '0',
  }
}
function account(activities: Activity[], positions: Position[], inputMarket = market) {
  return accountWalletMarket({
    market: inputMarket,
    wallet: 'wallet',
    trades: activities.filter((a) => a.type === 'TRADE'),
    activities,
    positions,
    fetched: true,
  })
}

test('cash arithmetic is exact and rejects unavailable or over-precision quantities', () => {
  assert.equal(decimal(units(0.1) + units(0.2)), '0.300000')
  assert.equal(units('1e-6'), 1n)
  assert.equal(decimal(units('-123.000001')), '-123.000001')
  assert.throws(() => units(null))
  assert.throws(() => units('0.0000001'))
})

test('repeated fills remain distinct and one missing occurrence is detected', () => {
  const fill = activity('TRADE', 'up', '1', '.4', 'BUY')
  assert.equal(multisetDifference([fill, fill], [fill, fill]), 0)
  assert.equal(multisetDifference([fill, fill], [fill]), 1)
})

test('buy cash includes fees once; settlement value becomes redemption cash without changing profit', () => {
  const buy = activity('TRADE', 'up', '10', '4.1', 'BUY')
  const held = account([buy], [position('up', '10', '5.9')])
  const redeemed = account(
    [buy, activity('REDEEM', 'up', '10', '10')],
    [position('up', '0', '5.9')],
  )
  assert.equal(held.economic_pnl_usdc, '5.900000')
  assert.equal(redeemed.economic_pnl_usdc, held.economic_pnl_usdc)
  assert.equal(held.cash_pnl_usdc, '-4.100000')
  assert.equal(redeemed.unredeemed_value_usdc, '0.000000')
  assert.equal(redeemed.quality, 'complete')
})

test('split and merge cash legs are counted once; both token balances are maintained', () => {
  const rows = [
    activity('SPLIT', '', '10', '10'),
    activity('MERGE', '', '4', '4'),
    activity('TRADE', 'down', '6', '2.4', 'SELL'),
  ]
  const result = account(rows, [position('up', '6', '2.4'), position('down', '0', '0')])
  assert.equal(result.economic_pnl_usdc, '2.400000')
  assert.equal(result.quality, 'complete')
})

test('two redemption outcomes are not deduplicated by transaction hash', () => {
  const rows = [
    activity('SPLIT', '', '10', '10'),
    activity('REDEEM', 'up', '10', '10'),
    activity('REDEEM', 'down', '10', '0'),
  ]
  const result = account(rows, [position('up', '0', '5'), position('down', '0', '-5')])
  assert.equal(result.economic_pnl_usdc, '0.000000')
  assert.equal(result.activity_count, 3)
  assert.equal(result.quality, 'complete')
})

test('missing snapshots, unexplained token transfers and unknown activities prevent strict ranking', () => {
  const buy = activity('TRADE', 'up', '10', '4', 'BUY')
  assert.equal(account([buy], []).quality, 'unresolved')
  assert.ok(account([buy], [position('up', '5', '1')]).issues.includes('position_balance_mismatch'))
  assert.ok(
    account(
      [activity('TRADE', 'up', '10', '4', 'SELL')],
      [position('up', '0', '4')],
    ).issues.includes('unexplained_token_outflow'),
  )
  assert.ok(
    account([activity('CONVERSION', '', '10', '10')], []).issues.includes(
      'unsupported_activity:CONVERSION',
    ),
  )
})

test('unresolved markets have no final economic PnL; rewards stay separate', () => {
  const rows = [activity('TRADE', 'up', '10', '4', 'BUY'), activity('REWARD', '', '1', '1')]
  const result = account(rows, [position('up', '10', '6')])
  assert.equal(result.economic_pnl_usdc, '6.000000')
  assert.equal(result.pnl_with_rewards_usdc, '7.000000')
  assert.equal(
    account(rows, [position('up', '10', '6')], { ...market, resolved: false }).economic_pnl_usdc,
    null,
  )
})

test('overlapping OPEN/CLOSED position views contribute economics once', () => {
  const rows = [
    activity('TRADE', 'down', '2.25', '1.07412', 'BUY'),
    activity('TRADE', 'down', '2.14', '0.52758', 'SELL'),
  ]
  const closed = { ...position('down', '0.11', '-0.5465'), status: 'CLOSED' }
  const open = {
    ...position('down', '0.11', '-0.5465'),
    status: 'REDEEMABLE',
    realized_pnl: '-0.4960',
    unrealized_pnl: '-0.0505',
  }
  const result = account(rows, [closed, open])
  assert.equal(result.economic_pnl_usdc, '-0.546540')
  assert.equal(result.api_position_pnl_usdc, '-0.546500')
  assert.equal(result.quality, 'complete')
  assert.ok(result.notes.includes('overlapping_position_views'))
  assert.ok(
    account(rows, [closed, { ...open, total_pnl: '10' }]).issues.includes(
      'conflicting_position_snapshots',
    ),
  )
})

test('a synthetic zero CLOSED losing balance has no settlement value; a winning balance gap still fails', () => {
  const buy = activity('TRADE', 'down', '30.821427', '9.064949', 'BUY')
  const result = account([buy], [{ ...position('down', '0', '-9.0649'), status: 'CLOSED' }])
  assert.equal(result.economic_pnl_usdc, '-9.064949')
  assert.equal(result.quality, 'complete')
  assert.ok(result.notes.includes('zero_payout_balance_not_exposed'))
  const winning = account(
    [{ ...buy, token_id: 'up' }],
    [{ ...position('up', '0', '-9.0649'), status: 'CLOSED' }],
  )
  assert.ok(winning.issues.includes('position_balance_mismatch'))
})

test('live V2 regression: cash and rounded native WAC differ without missing trades or balances', async () => {
  const fixture = JSON.parse(
    await readFile(new URL('./fixtures/june-10-accounting.json', import.meta.url), 'utf8'),
  ) as {
    market: Market
    wallets: { wallet: string; trades: FeedRow[]; activities: Activity[]; positions: Position[] }[]
  }
  const expected = ['82.377961', '-100.446775']
  for (const [i, wallet] of fixture.wallets.entries()) {
    const result = accountWalletMarket({ market: fixture.market, ...wallet, fetched: true })
    assert.equal(result.economic_pnl_usdc, expected[i])
    assert.equal(result.api_pnl_status, 'rounding_compatible')
    assert.deepEqual(result.issues, [])
    assert.equal(result.quality, 'complete')
  }
})

test('live mixed buy/sell WAC explains rounding but does not excuse a larger API defect', async () => {
  const fixture = JSON.parse(
    await readFile(new URL('./fixtures/june-01-wac.json', import.meta.url), 'utf8'),
  ) as {
    examples: {
      market: Market
      wallet: string
      trades: FeedRow[]
      activities: Activity[]
      positions: Position[]
      expected_cash_pnl: string
    }[]
  }
  const [explained, unexplained] = fixture.examples.map((example) => {
    const result = accountWalletMarket({ ...example, fetched: true })
    assert.equal(result.cash_pnl_usdc, example.expected_cash_pnl)
    return result
  })
  assert.equal(explained!.quality, 'complete')
  assert.ok(explained!.notes.includes('native_wac_reproduced'))
  assert.equal(unexplained!.quality, 'unresolved')
  assert.ok(unexplained!.issues.includes('api_pnl_unreconciled'))
  assert.equal(unexplained!.economic_pnl_usdc, '7.306865')
})

test('live July trade/merge lifecycle reproduces native WAC without changing exact cash profit', async () => {
  const fixture = JSON.parse(
    await readFile(new URL('./fixtures/july-01-merge.json', import.meta.url), 'utf8'),
  ) as {
    market: Market
    wallet: string
    trades: FeedRow[]
    activities: Activity[]
    positions: Position[]
  }
  const result = accountWalletMarket({ ...fixture, fetched: true })
  assert.equal(result.cash_pnl_usdc, '22.611345')
  assert.equal(result.modeled_api_pnl_usdc, '22.617526')
  assert.equal(result.api_position_pnl_usdc, '22.617500')
  assert.equal(result.quality, 'complete')
  assert.ok(result.notes.includes('native_wac_reproduced'))
})

test('untouched open fee-exclusive native PnL is explained without double-deducting cash fees', () => {
  const buy = { ...activity('TRADE', 'down', '100', '1.0693', 'BUY'), price: '0.01' }
  const open = {
    ...position('down', '100', '-1'),
    status: 'REDEEMABLE',
    realized_pnl: '0',
    unrealized_pnl: '-1',
    entry_cost_usdc: '1',
    entry_fees_usdc: '0.0693',
    total_cost_usdc: '1.0693',
  }
  const result = account([buy], [open])
  assert.equal(result.economic_pnl_usdc, '-1.069300')
  assert.equal(result.api_position_pnl_usdc, '-1.000000')
  assert.equal(result.api_pnl_status, 'fee_basis_difference')
  assert.equal(result.quality, 'complete')
  const alreadyNet = account([buy], [{ ...open, total_pnl: '-1.0693', realized_pnl: '-0.0693' }])
  assert.equal(alreadyNet.economic_pnl_usdc, '-1.069300')
  assert.equal(alreadyNet.api_pnl_status, 'match')
  assert.equal(account([buy], [{ ...open, total_pnl: '-0.9' }]).quality, 'unresolved')
  assert.equal(account([buy], [{ ...open, status: 'CLOSED' }]).quality, 'unresolved')
})

test('legacy redemption need not expose an untraded losing split token; missing traded tokens still fail', () => {
  const rows = [
    activity('SPLIT', '', '40', '40'),
    activity('TRADE', 'up', '1.5625', '1.0252', 'BUY'),
    activity('REDEEM', '', '41.5625', '41.5625'),
  ]
  const result = account(rows, [{ ...position('up', '0', '0.5373'), status: 'CLOSED' }])
  assert.equal(result.economic_pnl_usdc, '0.537300')
  assert.equal(result.quality, 'complete')
  assert.ok(result.notes.includes('untraded_zero_payout_position_not_exposed'))
  assert.equal(
    account(rows, [{ ...position('down', '0', '0.5373'), status: 'CLOSED' }]).quality,
    'unresolved',
  )
})
