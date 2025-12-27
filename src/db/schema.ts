import { mysqlTable, text, varchar, decimal, timestamp, boolean, json } from 'drizzle-orm/mysql-core'

// Markets table
export const markets = mysqlTable('markets', {
  id: varchar('id', { length: 255 }).primaryKey(), // Market ID from API (e.g., "996575")
  slug: varchar('slug', { length: 255 }).notNull().unique(), // Market slug (e.g., "btc-updown-15m-1766524500")
  dataset: text('dataset'),
  question: text('question').notNull(), // Market question/title
  conditionId: text('condition_id'), // Blockchain condition ID
  outcomes: json('outcomes').$type<string[]>().notNull(), // Array of outcome strings (e.g., ["Up", "Down"])
  outcomePrices: json('outcome_prices').$type<string[] | number[]>(), // Array of outcome prices (e.g., ["0", "1"] or [0, 1])
  resolvedOutcome: text('resolved_outcome'), // Winning outcome (e.g., "Up" or "Down") - null if not resolved yet
  endDate: timestamp('end_date'), // Market resolution end date
  startDate: timestamp('start_date'), // Market start date
  startDateIso: text('start_date_iso'), // ISO date string from API (e.g., "2024-01-01T00:00:00Z")
  umaResolutionStatus: text('uma_resolution_status'), // UMA resolution status (e.g., "resolved", "pending")
  umaResolutionStatuses: json('uma_resolution_statuses').$type<unknown>(), // UMA resolution statuses (JSON array/object)
  clobTokenIds: json('clob_token_ids').$type<string[]>(), // Array of CLOB token IDs for each outcome
  active: boolean('active').default(false).notNull(),
  closed: boolean('closed').default(false).notNull(),
  volume: decimal('volume'), // Trading volume
  rawJson: json('raw_json').$type<Record<string, unknown>>(), // Complete API response as JSON
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
