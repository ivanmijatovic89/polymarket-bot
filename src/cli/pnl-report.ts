import '../config/env.js'
import { Wallet } from 'ethers'
import { loadPolymarketConfigFromEnv } from '../polymarket/config.js'
import {
  fetchActivity,
  fetchPortfolioValue,
  type Activity,
} from '../polymarket/dataApi.js'

// ─────────────────────────────────────────────────────────────────────────────
// CLI Argument Parsing
// ─────────────────────────────────────────────────────────────────────────────

type CliArgs = {
  symbol?: string
  slug?: string
  limit: number
  json: boolean
  debug: boolean
  help: boolean
}

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = { limit: 50, json: false, debug: false, help: false }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--symbol' && argv[i + 1]) {
      args.symbol = argv[++i]?.toLowerCase()
    } else if (arg === '--slug' && argv[i + 1]) {
      args.slug = argv[++i]?.toLowerCase()
    } else if (arg === '--limit' && argv[i + 1]) {
      const n = parseInt(argv[++i] ?? '50', 10)
      args.limit = Number.isFinite(n) && n > 0 ? n : 50
    } else if (arg === '--json') {
      args.json = true
    } else if (arg === '--debug') {
      args.debug = true
    } else if (arg === '--help' || arg === '-h') {
      args.help = true
    }
  }

  return args
}

function printHelp(): void {
  console.log(`
Usage: npx tsx src/cli/pnl-report.ts [options]

Options:
  --symbol <sym>   Filter by symbol (e.g., btc, eth, sol)
  --slug <pattern> Filter by slug pattern (e.g., "btc-updown-15m")
  --limit <n>      Number of markets to show (default: 50)
  --json           Output as JSON instead of table
  --debug          Show debug info
  --help, -h       Show this help message

Examples:
  npx tsx src/cli/pnl-report.ts
  npx tsx src/cli/pnl-report.ts --symbol btc --limit 50
  npx tsx src/cli/pnl-report.ts --json
`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Address Resolution
// ─────────────────────────────────────────────────────────────────────────────

async function resolveWalletAddress(): Promise<string> {
  const cfg = loadPolymarketConfigFromEnv()

  if (cfg.clob.funder) {
    return cfg.clob.funder
  }

  if (cfg.privateKey) {
    const wallet = new Wallet(cfg.privateKey)
    return wallet.address
  }

  throw new Error(
    '[pnl-report] No wallet address found. Set CLOB_FUNDER or PRIVATE_KEY in environment.'
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Market PnL Calculation from Activity
// ─────────────────────────────────────────────────────────────────────────────

type MarketStatus = 'open' | 'closed' | 'redeemed'
type MarketResult = 'win' | 'loss' | 'skipped' | '-'

type MarketPnl = {
  slug: string
  conditionId: string
  title: string
  outcome: string
  // Activity breakdown
  trades: Activity[]
  splits: Activity[]
  merges: Activity[]
  redeems: Activity[]
  // Share tracking
  sharesBought: number     // Total shares bought
  sharesSold: number       // Total shares sold
  // Calculated values
  totalBought: number      // USDC spent on BUY trades
  totalSold: number        // USDC received from SELL trades
  splitCost: number        // USDC spent on SPLIT
  mergeProceeds: number    // USDC received from MERGE
  redeemProceeds: number   // USDC received from REDEEM
  // Net PnL
  netPnl: number
  // Status: open (still holding), closed (sold/merged out), redeemed (market resolved)
  status: MarketStatus
  // Result: win, loss, skipped (pnl=0), or - (still open)
  result: MarketResult
}

function computeMarketPnl(activities: Activity[]): Map<string, MarketPnl> {
  const bySlug = new Map<string, MarketPnl>()

  for (const a of activities) {
    const slug = a.slug ?? ''
    if (!slug) continue

    let market = bySlug.get(slug)
    if (!market) {
      market = {
        slug,
        conditionId: a.conditionId ?? '',
        title: a.title ?? slug,
        outcome: a.outcome ?? '',
        trades: [],
        splits: [],
        merges: [],
        redeems: [],
        sharesBought: 0,
        sharesSold: 0,
        totalBought: 0,
        totalSold: 0,
        splitCost: 0,
        mergeProceeds: 0,
        redeemProceeds: 0,
        netPnl: 0,
        status: 'open',
        result: '-',
      }
      bySlug.set(slug, market)
    }

    const usdcSize = a.usdcSize ?? 0
    const size = a.size ?? 0

    switch (a.type) {
      case 'TRADE':
        market.trades.push(a)
        if (a.side === 'BUY') {
          market.totalBought += usdcSize
          market.sharesBought += size
        } else if (a.side === 'SELL') {
          market.totalSold += usdcSize
          market.sharesSold += size
        }
        // Update outcome from latest trade
        if (a.outcome) market.outcome = a.outcome
        break
      case 'SPLIT':
        market.splits.push(a)
        market.splitCost += usdcSize
        break
      case 'MERGE':
        market.merges.push(a)
        market.mergeProceeds += usdcSize
        break
      case 'REDEEM':
        market.redeems.push(a)
        market.redeemProceeds += usdcSize
        break
    }
  }

  // Calculate net PnL and status for each market
  const now = Date.now()

  for (const market of bySlug.values()) {
    // PnL = (what we got back) - (what we spent)
    // Got back: SELL proceeds + MERGE proceeds + REDEEM proceeds
    // Spent: BUY cost + SPLIT cost
    const totalIn = market.totalSold + market.mergeProceeds + market.redeemProceeds
    const totalOut = market.totalBought + market.splitCost
    market.netPnl = totalIn - totalOut

    // Check if market is still active based on slug timestamp
    // Slug format: btc-updown-15m-<epochSeconds>
    // Market ends 15 minutes (900 seconds) after the epoch
    const slugMatch = market.slug.match(/-(\d{10})$/)
    const marketEpoch = slugMatch ? parseInt(slugMatch[1], 10) * 1000 : 0
    const marketEndTime = marketEpoch + 15 * 60 * 1000 // +15 minutes
    const isMarketStillActive = marketEpoch > 0 && now < marketEndTime

    // Determine status:
    // - "redeemed" if we have REDEEM activity AND pnl > 0 (only redeem winners)
    // - "open" if market is still active (not yet ended)
    // - "closed" if position was exited via SELL or MERGE after market ended
    if (market.redeems.length > 0 && market.netPnl > 0) {
      market.status = 'redeemed'
    } else if (isMarketStillActive) {
      // Market is still running - position is open regardless of sells
      market.status = 'open'
    } else if (market.merges.length > 0) {
      // Merge exits the position
      market.status = 'closed'
    } else if (market.sharesSold > 0 && market.sharesSold >= market.sharesBought * 0.95) {
      // Sold most/all shares (95% threshold to account for rounding)
      market.status = 'closed'
    } else {
      // Market ended but no redeem yet - waiting for resolution/redeem
      market.status = 'closed'
    }

    // Determine result based on PnL
    if (market.status === 'open') {
      market.result = '-'
    } else if (Math.abs(market.netPnl) < 0.01) {
      market.result = 'skipped'
    } else if (market.netPnl > 0) {
      market.result = 'win'
    } else {
      market.result = 'loss'
    }
  }

  return bySlug
}

// ─────────────────────────────────────────────────────────────────────────────
// Filtering
// ─────────────────────────────────────────────────────────────────────────────

function filterMarkets(markets: MarketPnl[], args: CliArgs): MarketPnl[] {
  let filtered = [...markets]

  if (args.symbol) {
    const sym = args.symbol.toLowerCase()
    filtered = filtered.filter(m => m.slug.toLowerCase().startsWith(`${sym}-`))
  }

  if (args.slug) {
    const pattern = args.slug.toLowerCase()
    filtered = filtered.filter(m => m.slug.toLowerCase().includes(pattern))
  }

  // Sort by slug (most recent first)
  filtered.sort((a, b) => b.slug.localeCompare(a.slug))

  return filtered.slice(0, args.limit)
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats
// ─────────────────────────────────────────────────────────────────────────────

type AggregateStats = {
  totalMarkets: number
  totalPnl: number
  totalBought: number
  totalSold: number
  totalSplitCost: number
  totalMergeProceeds: number
  totalRedeemProceeds: number
  marketsRedeemed: number
  marketsClosed: number
  marketsOpen: number
  winCount: number
  lossCount: number
  skippedCount: number
  winRate: number
}

function computeStats(markets: MarketPnl[]): AggregateStats {
  // Only count closed/redeemed markets in totals (exclude open positions)
  const closedMarkets = markets.filter(m => m.status !== 'open')

  const totalPnl = closedMarkets.reduce((sum, m) => sum + m.netPnl, 0)
  const totalBought = closedMarkets.reduce((sum, m) => sum + m.totalBought, 0)
  const totalSold = closedMarkets.reduce((sum, m) => sum + m.totalSold, 0)
  const totalSplitCost = closedMarkets.reduce((sum, m) => sum + m.splitCost, 0)
  const totalMergeProceeds = closedMarkets.reduce((sum, m) => sum + m.mergeProceeds, 0)
  const totalRedeemProceeds = closedMarkets.reduce((sum, m) => sum + m.redeemProceeds, 0)

  const marketsRedeemed = markets.filter(m => m.status === 'redeemed').length
  const marketsClosed = markets.filter(m => m.status === 'closed').length
  const marketsOpen = markets.filter(m => m.status === 'open').length

  // Count by result
  const winCount = markets.filter(m => m.result === 'win').length
  const lossCount = markets.filter(m => m.result === 'loss').length
  const skippedCount = markets.filter(m => m.result === 'skipped').length
  const decisive = winCount + lossCount
  const winRate = decisive > 0 ? winCount / decisive : 0

  return {
    totalMarkets: markets.length,
    totalPnl,
    totalBought,
    totalSold,
    totalSplitCost,
    totalMergeProceeds,
    totalRedeemProceeds,
    marketsRedeemed,
    marketsClosed,
    marketsOpen,
    winCount,
    lossCount,
    skippedCount,
    winRate,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Output Formatting
// ─────────────────────────────────────────────────────────────────────────────

function formatUsd(n: number): string {
  const sign = n >= 0 ? '' : '-'
  return `${sign}$${Math.abs(n).toFixed(2)}`
}

function formatPercent(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

function printTable(address: string, portfolioValue: number, markets: MarketPnl[], stats: AggregateStats): void {
  const RESET = '\x1b[0m'
  const GREEN = '\x1b[32m'
  const RED = '\x1b[31m'
  const CYAN = '\x1b[36m'
  const YELLOW = '\x1b[33m'
  const DIM = '\x1b[2m'

  console.log('')
  console.log(`${CYAN}=== PnL Report (from Activity) ===${RESET}`)
  console.log(`Address: ${address}`)
  console.log(`Portfolio Value: ${formatUsd(portfolioValue)}`)
  console.log('')

  if (markets.length === 0) {
    console.log('No markets found.')
    return
  }

  // Header
  const header = 'Market                                        Bought    Sold     Split    Merge   Redeem   Net PnL    Result   Status'
  const separator = '─'.repeat(125)

  console.log(header)
  console.log(separator)

  // Market rows
  for (const m of markets) {
    const slugPart = m.slug.length > 40 ? m.slug.slice(0, 37) + '...' : m.slug
    const marketCol = slugPart.padEnd(45)

    const boughtCol = m.totalBought > 0 ? formatUsd(m.totalBought).padStart(9) : '-'.padStart(9)
    const soldCol = m.totalSold > 0 ? formatUsd(m.totalSold).padStart(8) : '-'.padStart(8)
    const splitCol = m.splitCost > 0 ? formatUsd(m.splitCost).padStart(8) : '-'.padStart(8)
    const mergeCol = m.mergeProceeds > 0 ? formatUsd(m.mergeProceeds).padStart(8) : '-'.padStart(8)
    const redeemCol = m.redeemProceeds > 0 ? formatUsd(m.redeemProceeds).padStart(8) : '-'.padStart(8)

    // PnL color: green if positive, red if negative, no color if zero
    let pnlCol: string
    if (m.netPnl > 0.01) {
      pnlCol = `${GREEN}${formatUsd(m.netPnl).padStart(10)}${RESET}`
    } else if (m.netPnl < -0.01) {
      pnlCol = `${RED}${formatUsd(m.netPnl).padStart(10)}${RESET}`
    } else {
      pnlCol = formatUsd(m.netPnl).padStart(10)
    }

    // Result with color
    let resultStr: string
    switch (m.result) {
      case 'win':
        resultStr = `${GREEN}WIN${RESET}`.padEnd(17) // padEnd accounts for ANSI codes
        break
      case 'loss':
        resultStr = `${RED}LOSS${RESET}`.padEnd(17)
        break
      case 'skipped':
        resultStr = `${DIM}SKIP${RESET}`.padEnd(17)
        break
      default:
        resultStr = '-'.padEnd(8)
    }

    // Status with color
    let statusStr: string
    switch (m.status) {
      case 'redeemed':
        statusStr = `${YELLOW}redeemed${RESET}`
        break
      case 'closed':
        statusStr = `${DIM}closed${RESET}`
        break
      default:
        statusStr = 'open'
    }

    console.log(`${marketCol}${boughtCol}${soldCol}${splitCol}${mergeCol}${redeemCol}${pnlCol}  ${resultStr}${statusStr}`)
  }

  console.log(separator)

  // Total row
  const totalBoughtStr = formatUsd(stats.totalBought).padStart(9)
  const totalSoldStr = formatUsd(stats.totalSold).padStart(8)
  const totalSplitStr = formatUsd(stats.totalSplitCost).padStart(8)
  const totalMergeStr = formatUsd(stats.totalMergeProceeds).padStart(8)
  const totalRedeemStr = formatUsd(stats.totalRedeemProceeds).padStart(8)

  let totalPnlStr: string
  if (stats.totalPnl > 0.01) {
    totalPnlStr = `${GREEN}${formatUsd(stats.totalPnl).padStart(10)}${RESET}`
  } else if (stats.totalPnl < -0.01) {
    totalPnlStr = `${RED}${formatUsd(stats.totalPnl).padStart(10)}${RESET}`
  } else {
    totalPnlStr = formatUsd(stats.totalPnl).padStart(10)
  }

  console.log(`${'TOTAL'.padEnd(45)}${totalBoughtStr}${totalSoldStr}${totalSplitStr}${totalMergeStr}${totalRedeemStr}${totalPnlStr}`)
  console.log('')

  // Summary line 1: counts
  const countParts = [
    `Markets: ${stats.totalMarkets}`,
    `Open: ${stats.marketsOpen}`,
    `Closed: ${stats.marketsClosed + stats.marketsRedeemed}`,
  ]
  console.log(`${DIM}${countParts.join(' | ')}${RESET}`)

  // Summary line 2: results breakdown
  if (stats.winCount + stats.lossCount + stats.skippedCount > 0) {
    const resultParts = [
      `${GREEN}Win: ${stats.winCount}${RESET}`,
      `${RED}Loss: ${stats.lossCount}${RESET}`,
      `${DIM}Skipped: ${stats.skippedCount}${RESET}`,
      `Win rate: ${formatPercent(stats.winRate)}`,
    ]
    console.log(resultParts.join(' | '))
  }
  console.log('')
}

function printJson(address: string, portfolioValue: number, markets: MarketPnl[], stats: AggregateStats): void {
  const output = {
    address,
    portfolioValue,
    stats: {
      ...stats,
      totalPnl: Math.round(stats.totalPnl * 100) / 100,
      winRate: Math.round(stats.winRate * 1000) / 1000,
    },
    markets: markets.map(m => ({
      slug: m.slug,
      conditionId: m.conditionId,
      outcome: m.outcome,
      sharesBought: Math.round(m.sharesBought * 100) / 100,
      sharesSold: Math.round(m.sharesSold * 100) / 100,
      totalBought: Math.round(m.totalBought * 100) / 100,
      totalSold: Math.round(m.totalSold * 100) / 100,
      splitCost: Math.round(m.splitCost * 100) / 100,
      mergeProceeds: Math.round(m.mergeProceeds * 100) / 100,
      redeemProceeds: Math.round(m.redeemProceeds * 100) / 100,
      netPnl: Math.round(m.netPnl * 100) / 100,
      status: m.status,
      result: m.result,
      tradesCount: m.trades.length,
      splitsCount: m.splits.length,
      mergesCount: m.merges.length,
      redeemsCount: m.redeems.length,
    })),
  }

  console.log(JSON.stringify(output, null, 2))
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch all activities with pagination
// ─────────────────────────────────────────────────────────────────────────────

async function fetchAllActivities(address: string, debug = false, maxActivities = 5000): Promise<Activity[]> {
  const allActivities: Activity[] = []
  const pageSize = 500
  let offset = 0
  let page = 1

  while (allActivities.length < maxActivities) {
    if (debug) {
      console.log(`[debug] Fetching page ${page}, offset ${offset}...`)
    }

    // Don't use sortBy/sortDirection - API returns newest first by default
    // and those params seem to cause issues with pagination
    const batch = await fetchActivity({
      user: address,
      limit: pageSize,
      offset,
    })

    if (debug) {
      console.log(`[debug] Page ${page}: got ${batch.length} activities`)
      if (batch.length > 0) {
        console.log(`[debug] Page ${page} first timestamp: ${batch[0]?.timestamp}, slug: ${batch[0]?.slug}`)
      }
    }

    if (batch.length === 0) break

    allActivities.push(...batch)
    offset += batch.length
    page++

    // If we got less than pageSize, we've reached the end
    if (batch.length < pageSize) break
  }

  // Sort by timestamp descending (newest first) to ensure correct order
  allActivities.sort((a, b) => b.timestamp - a.timestamp)

  return allActivities
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2))

  if (args.help) {
    printHelp()
    return
  }

  const address = await resolveWalletAddress()
  console.log(`[pnl-report] Fetching activity for ${address}...`)

  // Fetch all activities with pagination + portfolio value
  const [activities, portfolioValue] = await Promise.all([
    fetchAllActivities(address, args.debug),
    fetchPortfolioValue(address),
  ])

  console.log(`[pnl-report] Found ${activities.length} activities`)

  if (args.debug && activities.length > 0) {
    console.log('[debug] First activity:', JSON.stringify(activities[0], null, 2))

    // Show activity type breakdown
    const byType = new Map<string, number>()
    for (const a of activities) {
      byType.set(a.type, (byType.get(a.type) ?? 0) + 1)
    }
    console.log('[debug] Activity breakdown:', Object.fromEntries(byType))
  }

  // Compute PnL per market from activities
  const marketPnlMap = computeMarketPnl(activities)
  const allMarkets = Array.from(marketPnlMap.values())

  // Filter and limit
  const filteredMarkets = filterMarkets(allMarkets, args)
  const stats = computeStats(filteredMarkets)

  // Output
  if (args.json) {
    printJson(address, portfolioValue, filteredMarkets, stats)
  } else {
    printTable(address, portfolioValue, filteredMarkets, stats)
  }
}

main().catch((err) => {
  console.error('[pnl-report] Error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
