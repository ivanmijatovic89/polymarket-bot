import {
  mysqlTable,
  text,
  varchar,
  decimal,
  timestamp,
  boolean,
  json,
  int,
  bigint,
} from 'drizzle-orm/mysql-core'

// Markets table
export const markets = mysqlTable('markets', {
  id: int('id').primaryKey().autoincrement(), // Auto-increment primary key
  polymarketId: varchar('polymarket_id', { length: 255 }).notNull().unique(), // Polymarket market ID (e.g., "996575")
  slug: varchar('slug', { length: 255 }).notNull().unique(), // Market slug (e.g., "btc-updown-15m-1766524500")
  symbol: varchar('symbol', { length: 10 }).notNull(), // Symbol extracted from folder path (e.g., "btc", "eth", "sol")
  dataset: text('dataset'),

  conditionId: text('condition_id'), // Blockchain condition ID
  outcomes: json('outcomes').$type<string[]>().notNull(), // Array of outcome strings (e.g., ["Up", "Down"])
  outcomePrices: json('outcome_prices').$type<string[] | number[]>(), // Array of outcome prices (e.g., ["0", "1"] or [0, 1])
  resolvedOutcome: text('resolved_outcome'), // Winning outcome (e.g., "Up" or "Down") - null if not resolved yet
  endDate: timestamp('end_date'), // Market resolution end date
  startDate: timestamp('start_date'), // Market start date
  startDateIso: text('start_date_iso'), // ISO date string from API (e.g., "2024-01-01T00:00:00Z")
  umaResolutionStatus: text('uma_resolution_status'), // UMA resolution status (e.g., "resolved", "pending")
  clobTokenIds: json('clob_token_ids').$type<string[]>(), // Array of CLOB token IDs for each outcome
  active: boolean('active').default(false).notNull(),
  closed: boolean('closed').default(false).notNull(),
  volume: decimal('volume'), // Trading volume
  question: text('question').notNull(), // Market question/title
  rawJson: json('raw_json').$type<Record<string, unknown>>(), // Complete API response as JSON
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Backtests table
export const backtests = mysqlTable('backtests', {
  id: bigint('id', { mode: 'number' }).primaryKey().autoincrement(),
  status: varchar('status', { length: 50 }),

  strategy: varchar('strategy', { length: 255 }).notNull(),
  params: json('params').$type<Record<string, unknown>>().notNull(),

  symbol: varchar('symbol', { length: 10 }),
  slugs: json('slugs').$type<string[] | null>(),
  limit: int('limit'),
  random: boolean('random').default(false).notNull(),
  latest: boolean('latest').default(false).notNull(),

  batchUid: varchar('batch_uid', { length: 255 }),
  baselineId: varchar('baseline_id', { length: 255 }),
  cmd: text('cmd'),
  comment: text('comment'),

  batchStats: json('batch_stats').$type<Record<string, unknown>>().notNull(),
  marketStats: json('market_stats').$type<unknown[]>().notNull(),
  chunkedBatchStats: json('chunked_batch_stats').$type<Record<string, unknown> | null>(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
})
