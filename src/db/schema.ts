import { pgTable, text, numeric, timestamp, boolean, jsonb } from 'drizzle-orm/pg-core'

// Markets table
export const markets = pgTable('markets', {
  id: text('id').primaryKey(), // Market ID from API (e.g., "996575")
  slug: text('slug').notNull().unique(), // Market slug (e.g., "btc-updown-15m-1766524500")
  question: text('question').notNull(), // Market question/title
  conditionId: text('condition_id'), // Blockchain condition ID
  outcomes: jsonb('outcomes').$type<string[]>().notNull(), // Array of outcome strings (e.g., ["Up", "Down"])
  resolvedOutcome: text('resolved_outcome'), // Winning outcome (e.g., "Up" or "Down") - null if not resolved yet
  endDate: timestamp('end_date'), // Market resolution end date
  startDate: timestamp('start_date'), // Market start date
  active: boolean('active').default(false).notNull(),
  closed: boolean('closed').default(false).notNull(),
  volume: numeric('volume'), // Trading volume
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
