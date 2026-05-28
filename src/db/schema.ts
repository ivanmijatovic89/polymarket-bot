import {
  mysqlTable,
  text,
  longtext,
  varchar,
  decimal,
  timestamp,
  datetime,
  date,
  boolean,
  json,
  int,
  bigint,
  mysqlEnum,
  unique,
  index,
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

// PMXT dataset catalogue
export const pmxtDatasetCatalogue = mysqlTable('pmxt_dataset_catalogue', {
  id: int('id').primaryKey().autoincrement(),
  version: varchar('version', { length: 4 }).notNull(),
  filename: varchar('filename', { length: 100 }).notNull().unique(),
  url: varchar('url', { length: 255 }).notNull(),
  hourTs: datetime('hour_ts').notNull(),
  symbol: varchar('symbol', { length: 10 }).notNull(),
  status: mysqlEnum('status', [
    'pending',
    'downloading',
    'converting',
    'done',
    'master_done',
    'failed',
  ])
    .notNull()
    .default('pending'),
  outDir: varchar('out_dir', { length: 255 }),
  slugs: json('slugs').$type<string[]>(),
  windowsWritten: int('windows_written'),
  sourceSizeMb: decimal('source_size_mb', { precision: 10, scale: 2 }),
  error: text('error'),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// PMXT slug → conditionId resolution cache (avoids re-hitting Gamma)
export const pmxtSlugCache = mysqlTable('pmxt_slug_cache', {
  slug: varchar('slug', { length: 100 }).primaryKey(),
  symbol: varchar('symbol', { length: 10 }).notNull(),
  conditionId: varchar('condition_id', { length: 66 }).notNull(),
  tokenIds: json('token_ids').$type<string[]>().notNull(),
  windowStart: datetime('window_start').notNull(),
  resolvedAt: timestamp('resolved_at').defaultNow().notNull(),
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
  cmd: longtext('cmd'),
  comment: text('comment'),

  batchStats: json('batch_stats').$type<Record<string, unknown>>().notNull(),
  marketStats: json('market_stats').$type<unknown[]>().notNull(),
  chunkedBatchStats: json('chunked_batch_stats').$type<Record<string, unknown> | null>(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Telonex sync pipeline — see docs/telonex-sync-design.md
// ---------------------------------------------------------------------------

// Telonex catalog row + local pipeline state (Step 1 upload).
export const telonexMarkets = mysqlTable('telonex_markets', {
  id: bigint('id', { mode: 'number' }).primaryKey().autoincrement(),

  // Telonex catalog (full schema mirror)
  exchange: varchar('exchange', { length: 20 }).notNull(),
  marketId: varchar('market_id', { length: 66 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  eventId: varchar('event_id', { length: 100 }),
  eventSlug: varchar('event_slug', { length: 100 }),
  eventTitle: varchar('event_title', { length: 255 }),
  question: text('question'),
  description: text('description'),
  category: varchar('category', { length: 100 }),
  tags: json('tags').$type<string[]>(),
  outcome0: varchar('outcome_0', { length: 20 }),
  outcome1: varchar('outcome_1', { length: 20 }),
  assetId0: varchar('asset_id_0', { length: 80 }),
  assetId1: varchar('asset_id_1', { length: 80 }),
  telonexStatus: varchar('telonex_status', { length: 20 }),
  resultId: varchar('result_id', { length: 10 }),
  settledAtUs: bigint('settled_at_us', { mode: 'number' }),
  preparedAtUs: bigint('prepared_at_us', { mode: 'number' }),
  startDateUs: bigint('start_date_us', { mode: 'number' }),
  endDateUs: bigint('end_date_us', { mode: 'number' }),
  createdAtUs: bigint('created_at_us', { mode: 'number' }),
  resolutionSource: varchar('resolution_source', { length: 255 }),
  rulesUrl: varchar('rules_url', { length: 255 }),
  tradesFrom: date('trades_from'),
  tradesTo: date('trades_to'),
  quotesFrom: date('quotes_from'),
  quotesTo: date('quotes_to'),
  bookSnapshot5From: date('book_snapshot_5_from'),
  bookSnapshot5To: date('book_snapshot_5_to'),
  bookSnapshot25From: date('book_snapshot_25_from'),
  bookSnapshot25To: date('book_snapshot_25_to'),
  bookSnapshotFullFrom: date('book_snapshot_full_from'),
  bookSnapshotFullTo: date('book_snapshot_full_to'),
  onchainFillsFrom: date('onchain_fills_from'),
  onchainFillsTo: date('onchain_fills_to'),

  // Local pipeline state (Step 1)
  uploadStatus: mysqlEnum('upload_status', ['pending', 'processing', 'done', 'partial', 'failed'])
    .notNull()
    .default('pending'),
  filesUploaded: int('files_uploaded').notNull().default(0),
  lastError: text('last_error'),
  syncedAt: timestamp('synced_at').defaultNow().notNull(),
  processedAt: timestamp('processed_at'),
})

// Raw files uploaded to R2 (Step 1 output, one row per source parquet).
// Created lazily by the download-raw-files worker, not by sync.
export const telonexMarketFiles = mysqlTable(
  'telonex_market_files',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().autoincrement(),
    slug: varchar('slug', { length: 100 }).notNull(),
    channel: varchar('channel', { length: 40 }).notNull(),
    date: date('date').notNull(),
    assetId: varchar('asset_id', { length: 80 }).notNull(),
    r2Key: varchar('r2_key', { length: 255 }).notNull(),
    r2Etag: varchar('r2_etag', { length: 64 }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    status: mysqlEnum('status', ['uploaded', 'no_file', 'failed']).notNull(),
    attempts: int('attempts').notNull().default(0),
    lastError: text('last_error'),
    startedAt: timestamp('started_at'),
    uploadedAt: timestamp('uploaded_at'),
  },
  (t) => ({
    uniqFile: unique('uniq_telonex_market_files').on(t.slug, t.channel, t.date, t.assetId),
    slugIdx: index('idx_telonex_market_files_slug').on(t.slug),
  }),
)

// Converted parquet per (market, converter) — Step 2 output.
export const telonexMarketConversions = mysqlTable(
  'telonex_market_conversions',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().autoincrement(),
    marketId: bigint('market_id', { mode: 'number' }).notNull(),
    converter: varchar('converter', { length: 40 }).notNull(),
    status: mysqlEnum('status', ['pending', 'in_progress', 'done', 'failed'])
      .notNull()
      .default('pending'),
    r2Url: varchar('r2_url', { length: 255 }),
    localPath: varchar('local_path', { length: 255 }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    etag: varchar('etag', { length: 64 }),
    attempts: int('attempts').notNull().default(0),
    lastError: text('last_error'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
  },
  (t) => ({
    uniqConversion: unique('uniq_telonex_market_conversions').on(t.marketId, t.converter),
    marketIdx: index('idx_telonex_market_conversions_market').on(t.marketId),
  }),
)
