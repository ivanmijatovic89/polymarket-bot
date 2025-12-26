import { pgTable, text, numeric, timestamp, integer, boolean } from 'drizzle-orm/pg-core'

// Markets table
export const markets = pgTable('markets', {
  id: text('id').primaryKey(), // market slug or condition ID
  symbol: text('symbol').notNull(), // BTC, ETH, SOL, XRP
  slug: text('slug').notNull(),
  assetSlug: text('asset_slug').notNull(),
  upAssetId: text('up_asset_id').notNull(),
  downAssetId: text('down_asset_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
