import {
  bigint,
  boolean,
  int,
  json,
  longtext,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/mysql-core'

/**
 * Mirror of the `backtests` table from the bot's `src/db/schema.ts`.
 *
 * Kept in sync manually — dashboard is read-only for this table. If the
 * source schema changes, mirror the relevant column here.
 */
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
  cmd: longtext('cmd'),
  comment: text('comment'),

  batchStats: json('batch_stats').$type<Record<string, unknown>>().notNull(),
  marketStats: json('market_stats').$type<unknown[]>().notNull(),
  chunkedBatchStats: json('chunked_batch_stats').$type<Record<string, unknown> | null>(),
  failedMarkets: json('failed_markets').$type<Array<{
    jobId?: string
    idx: number | null
    slug: string | null
    reason: string
  }> | null>(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
})
