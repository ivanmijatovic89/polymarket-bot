import {
  bigint,
  boolean,
  decimal,
  index,
  int,
  json,
  longtext,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core'

/**
 * Mirror of the bot's backtest result tables from `src/db/schema.ts`.
 *
 * Kept in sync manually — dashboard is read-only for these tables. If the
 * source schema changes, mirror the relevant columns here.
 */
export const backtestRuns = mysqlTable(
  'backtest_runs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().autoincrement(),
    batchUid: varchar('batch_uid', { length: 255 }).notNull(),
    status: mysqlEnum('status', ['completed', 'partial', 'failed']).notNull(),

    strategy: varchar('strategy', { length: 255 }).notNull(),
    params: json('params').$type<Record<string, unknown>>().notNull(),

    symbol: varchar('symbol', { length: 10 }),
    timeframe: varchar('timeframe', { length: 16 }),
    inputMode: varchar('input_mode', { length: 32 }),
    converter: varchar('converter', { length: 32 }),
    readFrom: varchar('read_from', { length: 16 }),
    slugs: json('slugs').$type<string[] | null>(),
    limit: int('limit'),
    random: boolean('random').default(false).notNull(),
    latest: boolean('latest').default(false).notNull(),

    baselineId: varchar('baseline_id', { length: 255 }),
    cmd: longtext('cmd'),
    comment: text('comment'),

    inputMarketsTotal: int('input_markets_total'),
    marketsPersisted: int('markets_persisted').notNull().default(0),
    failuresCount: int('failures_count').notNull().default(0),

    capitalInitial: decimal('capital_initial', { precision: 14, scale: 4 }).notNull(),
    capitalFinal: decimal('capital_final', { precision: 14, scale: 4 }).notNull(),
    pnlTotal: decimal('pnl_total', { precision: 14, scale: 4 }).notNull(),
    totalFeesPaid: decimal('total_fees_paid', { precision: 14, scale: 4 }).notNull(),
    qualitySystem: decimal('quality_system', { precision: 14, scale: 6 }),
    qualityTrade: decimal('quality_trade', { precision: 14, scale: 6 }),
    evPerMarketPlayed: decimal('ev_per_market_played', { precision: 14, scale: 4 }).notNull(),
    evPerMarketTotal: decimal('ev_per_market_total', { precision: 14, scale: 4 }).notNull(),

    marketsTotal: int('markets_total').notNull(),
    marketsSkipped: int('markets_skipped').notNull(),
    marketsNoInWindowActivity: int('markets_no_in_window_activity').notNull(),
    marketsFlatWithTrades: int('markets_flat_with_trades').notNull(),
    marketsPlayed: int('markets_played').notNull(),
    marketsWon: int('markets_won').notNull(),
    marketsLost: int('markets_lost').notNull(),

    winRate: decimal('win_rate', { precision: 10, scale: 6 }).notNull(),
    winRatePct: decimal('win_rate_pct', { precision: 10, scale: 4 }).notNull(),
    tradesTotal: int('trades_total').notNull(),
    tradesMaker: int('trades_maker').notNull(),
    tradesTaker: int('trades_taker').notNull(),

    pnlAvgWin: decimal('pnl_avg_win', { precision: 14, scale: 4 }).notNull(),
    pnlAvgLose: decimal('pnl_avg_lose', { precision: 14, scale: 4 }).notNull(),
    pnlMaxWin: decimal('pnl_max_win', { precision: 14, scale: 4 }).notNull(),
    pnlMaxLose: decimal('pnl_max_lose', { precision: 14, scale: 4 }).notNull(),
    streakMaxWin: int('streak_max_win').notNull(),
    streakMaxLose: int('streak_max_lose').notNull(),
    streakMaxWinPnl: decimal('streak_max_win_pnl', { precision: 14, scale: 4 }).notNull(),
    streakMaxLosePnl: decimal('streak_max_lose_pnl', { precision: 14, scale: 4 }).notNull(),
    streakMaxSkipped: int('streak_max_skipped').notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    batchUidUnique: unique('uniq_backtest_runs_batch_uid').on(t.batchUid),
    createdAtIdx: index('idx_backtest_runs_created_at').on(t.createdAt),
  }),
)

export const backtestRunMarkets = mysqlTable(
  'backtest_run_markets',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().autoincrement(),
    runId: bigint('run_id', { mode: 'number' }).notNull(),
    idx: int('idx').notNull(),
    marketId: varchar('market_id', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull(),
    marketStartMs: bigint('market_start_ms', { mode: 'number' }).notNull(),
    finalOutcome: mysqlEnum('final_outcome', ['UP', 'DOWN']).notNull(),
    skipReason: mysqlEnum('skip_reason', ['no_in_window_activity']),
    pnl: decimal('pnl', { precision: 14, scale: 4 }).notNull(),
    tradeCount: int('trade_count').notNull(),
    tradeAsMaker: int('trade_as_maker').notNull(),
    tradeAsTaker: int('trade_as_taker').notNull(),
    feesPaid: decimal('fees_paid', { precision: 14, scale: 4 }).notNull(),
    avgEntryPriceUp: decimal('avg_entry_price_up', { precision: 10, scale: 6 }),
    avgEntryPriceDown: decimal('avg_entry_price_down', { precision: 10, scale: 6 }),
    upShares: decimal('up_shares', { precision: 18, scale: 6 }).notNull(),
    downShares: decimal('down_shares', { precision: 18, scale: 6 }).notNull(),
    mergableShares: decimal('mergable_shares', { precision: 18, scale: 6 }).notNull(),
    cost: decimal('cost', { precision: 14, scale: 4 }).notNull(),
    splitCost: decimal('split_cost', { precision: 14, scale: 4 }).notNull(),
    intentMeta: json('intent_meta').$type<Array<Record<string, unknown>>>().notNull(),
    machineId: varchar('machine_id', { length: 32 }),
    startedAtMs: bigint('started_at_ms', { mode: 'number' }),
    finishedAtMs: bigint('finished_at_ms', { mode: 'number' }),
    durationMs: int('duration_ms'),
    eventsProcessed: int('events_processed'),
    eventsByType: json('events_by_type').$type<Record<string, number> | null>(),
    commitSha: varchar('commit_sha', { length: 64 }),
  },
  (t) => ({
    runIdxUnique: unique('uniq_backtest_run_markets_run_idx').on(t.runId, t.idx),
  }),
)

// Minimal mirror of the bot's telonex catalog tables — coverage queries
// read these directly. Source of truth: src/db/schema.ts (telonexMarkets,
// telonexMarketConversions). Keep only the columns needed by dashboard queries.
export const telonexMarkets = mysqlTable('telonex_markets', {
  id: bigint('id', { mode: 'number' }).primaryKey().autoincrement(),
  slug: varchar('slug', { length: 100 }).notNull(),
  symbol: varchar('symbol', { length: 10 }).notNull(),
  timeframe: varchar('timeframe', { length: 16 }).notNull(),
  marketStartMs: bigint('market_start_ms', { mode: 'number' }).notNull(),
  resultId: varchar('result_id', { length: 10 }),
  telonexStatus: varchar('telonex_status', { length: 20 }),
})

export const telonexMarketConversions = mysqlTable('telonex_market_conversions', {
  id: bigint('id', { mode: 'number' }).primaryKey().autoincrement(),
  marketId: bigint('market_id', { mode: 'number' }).notNull(),
  converter: varchar('converter', { length: 32 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  localPath: varchar('local_path', { length: 500 }),
  r2Url: varchar('r2_url', { length: 500 }),
})

export const backtestRunFailures = mysqlTable('backtest_run_failures', {
  id: bigint('id', { mode: 'number' }).primaryKey().autoincrement(),
  runId: bigint('run_id', { mode: 'number' }).notNull(),
  jobId: varchar('job_id', { length: 255 }),
  idx: int('idx'),
  slug: varchar('slug', { length: 255 }),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Per-segment stats (see src/db/schema.ts for the authoritative table
// definition + semantics).
export const backtestRunSegments = mysqlTable('backtest_run_segments', {
  id: bigint('id', { mode: 'number' }).primaryKey().autoincrement(),
  runId: bigint('run_id', { mode: 'number' }).notNull(),
  segmentKind: mysqlEnum('segment_kind', ['all', 'last_n', 'daily', 'weekly', 'monthly']).notNull(),
  segmentKey: varchar('segment_key', { length: 32 }).notNull(),
  segmentOrd: bigint('segment_ord', { mode: 'number' }).notNull(),
  fromMs: bigint('from_ms', { mode: 'number' }).notNull(),
  toMs: bigint('to_ms', { mode: 'number' }).notNull(),
  capitalInitial: decimal('capital_initial', { precision: 14, scale: 4 }).notNull(),
  capitalFinal: decimal('capital_final', { precision: 14, scale: 4 }).notNull(),
  pnlTotal: decimal('pnl_total', { precision: 14, scale: 4 }).notNull(),
  totalFeesPaid: decimal('total_fees_paid', { precision: 14, scale: 4 }).notNull(),
  qualitySystem: decimal('quality_system', { precision: 14, scale: 6 }),
  qualityTrade: decimal('quality_trade', { precision: 14, scale: 6 }),
  evPerMarketPlayed: decimal('ev_per_market_played', { precision: 14, scale: 4 }).notNull(),
  evPerMarketTotal: decimal('ev_per_market_total', { precision: 14, scale: 4 }).notNull(),
  marketsTotal: int('markets_total').notNull(),
  marketsSkipped: int('markets_skipped').notNull(),
  marketsNoInWindowActivity: int('markets_no_in_window_activity').notNull(),
  marketsFlatWithTrades: int('markets_flat_with_trades').notNull(),
  marketsPlayed: int('markets_played').notNull(),
  marketsWon: int('markets_won').notNull(),
  marketsLost: int('markets_lost').notNull(),
  winRate: decimal('win_rate', { precision: 10, scale: 6 }).notNull(),
  winRatePct: decimal('win_rate_pct', { precision: 10, scale: 4 }).notNull(),
  tradesTotal: int('trades_total').notNull(),
  tradesMaker: int('trades_maker').notNull(),
  tradesTaker: int('trades_taker').notNull(),
  pnlAvgWin: decimal('pnl_avg_win', { precision: 14, scale: 4 }).notNull(),
  pnlAvgLose: decimal('pnl_avg_lose', { precision: 14, scale: 4 }).notNull(),
  pnlMaxWin: decimal('pnl_max_win', { precision: 14, scale: 4 }).notNull(),
  pnlMaxLose: decimal('pnl_max_lose', { precision: 14, scale: 4 }).notNull(),
  streakMaxWin: int('streak_max_win').notNull(),
  streakMaxLose: int('streak_max_lose').notNull(),
  streakMaxWinPnl: decimal('streak_max_win_pnl', { precision: 14, scale: 4 }).notNull(),
  streakMaxLosePnl: decimal('streak_max_lose_pnl', { precision: 14, scale: 4 }).notNull(),
  streakMaxSkipped: int('streak_max_skipped').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
